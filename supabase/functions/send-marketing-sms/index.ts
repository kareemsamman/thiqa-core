import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BATCH_SIZE = 200;

interface Recipient {
  clientId: string;
  phone: string;
  name: string;
}

interface RequestBody {
  title?: string;
  message?: string;
  imageUrl?: string;
  recipients?: Recipient[];
  // Batch continuation fields
  campaign_id?: string;
  batch_offset?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user is authenticated and is admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is admin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: RequestBody = await req.json();
    const { campaign_id, batch_offset = 0 } = body;

    // Resolve agent_id
    const { data: agentUser } = await supabase.from('agent_users').select('agent_id').eq('user_id', user.id).maybeSingle();
    const agentId = agentUser?.agent_id;

    // Get SMS settings for this agent
    const { data: smsSettings, error: settingsError } = await supabase
      .from('sms_settings')
      .select('*')
      .eq('agent_id', agentId)
      .maybeSingle();

    if (settingsError || !smsSettings) {
      return new Response(JSON.stringify({ error: 'SMS settings not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!smsSettings.is_enabled) {
      return new Response(JSON.stringify({ error: 'SMS service is disabled' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let currentCampaignId = campaign_id;
    let campaignMessage = body.message || '';

    // ── Mode A: New campaign (first call) ──
    if (!campaign_id) {
      const { title, message, imageUrl, recipients } = body;

      if (!title || !message || !recipients || recipients.length === 0) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      campaignMessage = message;
      console.log(`Starting marketing campaign: ${title} to ${recipients.length} recipients`);

      const { data: profile } = await supabase
        .from('profiles')
        .select('branch_id')
        .eq('id', user.id)
        .single();

      const { data: campaign, error: campaignError } = await supabase
        .from('marketing_sms_campaigns')
        .insert({
          title,
          message,
          image_url: imageUrl,
          recipients_count: recipients.length,
          status: 'sending',
          created_by_admin_id: user.id,
          branch_id: profile?.branch_id,
        })
        .select()
        .single();

      if (campaignError) throw campaignError;

      currentCampaignId = campaign.id;

      // Insert all recipients at once
      const recipientRecords = recipients.map(r => ({
        campaign_id: campaign.id,
        client_id: r.clientId,
        phone_number: r.phone,
        status: 'pending',
      }));

      await supabase.from('marketing_sms_recipients').insert(recipientRecords);
    } else {
      // ── Mode B: Resume / continuation ──
      // Fetch campaign message for logging
      const { data: existingCampaign } = await supabase
        .from('marketing_sms_campaigns')
        .select('message')
        .eq('id', campaign_id)
        .single();
      if (existingCampaign) campaignMessage = existingCampaign.message;
    }

    // ── Fetch the next batch of pending recipients ──
    const { data: pendingRecipients, error: fetchError } = await supabase
      .from('marketing_sms_recipients')
      .select('id, client_id, phone_number')
      .eq('campaign_id', currentCampaignId)
      .eq('status', 'pending')
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;

    if (!pendingRecipients || pendingRecipients.length === 0) {
      // No more pending – finalize campaign
      await finalizeCampaign(supabase, currentCampaignId!);
      return new Response(
        JSON.stringify({ success: true, campaignId: currentCampaignId, message: 'Campaign completed – no pending recipients' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing batch of ${pendingRecipients.length} for campaign ${currentCampaignId}`);

    // ── Send SMS to this batch ──
    let batchFailed = 0;
    const escapeXml = (str: string) =>
      str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    for (const recipient of pendingRecipients) {
      try {
        let phone = recipient.phone_number.replace(/\D/g, '');
        if (phone.startsWith('972')) phone = '0' + phone.slice(3);
        if (!phone.startsWith('0')) phone = '0' + phone;

        const dlr = crypto.randomUUID();
        const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?><sms><user><username>${escapeXml(smsSettings.sms_user)}</username></user><source>${escapeXml(smsSettings.sms_source)}</source><destinations><phone id="${dlr}">${escapeXml(phone)}</phone></destinations><message>${escapeXml(campaignMessage)}</message></sms>`;

        const smsResponse = await fetch('https://019sms.co.il/api', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/xml',
            'Authorization': `Bearer ${smsSettings.sms_token}`,
          },
          body: xmlPayload,
        });

        const responseText = await smsResponse.text();
        const statusMatch = responseText.match(/<status>(\d+)<\/status>/);
        const responseStatus = statusMatch ? parseInt(statusMatch[1]) : -1;
        const isAccepted = responseStatus === 0;

        await supabase
          .from('marketing_sms_recipients')
          .update({
            status: isAccepted ? 'sent' : 'failed',
            sent_at: new Date().toISOString(),
            dlr_id: dlr,
            dlr_status: isAccepted ? 'pending' : 'rejected',
            dlr_message: isAccepted ? null : responseText.slice(0, 500),
          })
          .eq('id', recipient.id);

        if (!isAccepted) batchFailed++;

        await supabase.from('sms_logs').insert({
          phone_number: phone,
          message: campaignMessage.slice(0, 500),
          status: isAccepted ? 'sent' : 'failed',
          sms_type: 'marketing',
          entity_type: 'campaign',
          entity_id: currentCampaignId,
          client_id: recipient.client_id || null,
        });

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error sending to ${recipient.phone_number}:`, error);
        batchFailed++;
        await supabase
          .from('marketing_sms_recipients')
          .update({
            status: 'failed',
            dlr_status: 'send_error',
            dlr_message: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('id', recipient.id);
      }
    }

    const batchSent = pendingRecipients.length - batchFailed;
    console.log(`Batch done: ${batchSent} sent, ${batchFailed} failed`);

    // ── Update campaign counts ──
    await updateCampaignCounts(supabase, currentCampaignId!);

    // ── Check if more pending recipients remain ──
    const { count: remainingCount } = await supabase
      .from('marketing_sms_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', currentCampaignId)
      .eq('status', 'pending');

    if (remainingCount && remainingCount > 0) {
      // Trigger next batch by calling self
      console.log(`${remainingCount} recipients remaining – triggering next batch`);
      const selfUrl = `${supabaseUrl}/functions/v1/send-marketing-sms`;
      fetch(selfUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ campaign_id: currentCampaignId }),
      }).catch(err => console.error('Error triggering next batch:', err));
    } else {
      await finalizeCampaign(supabase, currentCampaignId!);
    }

    return new Response(
      JSON.stringify({
        success: true,
        campaignId: currentCampaignId,
        batchSent,
        batchFailed,
        remaining: remainingCount || 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-marketing-sms:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function updateCampaignCounts(supabase: any, campaignId: string) {
  const { count: sentCount } = await supabase
    .from('marketing_sms_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'sent');

  const { count: failedCount } = await supabase
    .from('marketing_sms_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'failed');

  await supabase
    .from('marketing_sms_campaigns')
    .update({ sent_count: sentCount || 0, failed_count: failedCount || 0 })
    .eq('id', campaignId);
}

async function finalizeCampaign(supabase: any, campaignId: string) {
  await updateCampaignCounts(supabase, campaignId);
  await supabase
    .from('marketing_sms_campaigns')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', campaignId);
  console.log(`Campaign ${campaignId} finalized as completed`);
}
