import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// DLR status mapping from 019sms docs
function getDlrStatusInfo(status: number): { label: string; isFinal: boolean; isDelivered: boolean } {
  switch (status) {
    case -1: return { label: 'sent_no_confirmation', isFinal: false, isDelivered: false };
    case 0:
    case 102: return { label: 'delivered', isFinal: true, isDelivered: true };
    case 1:
    case 3:
    case 5:
    case 6: return { label: 'failed', isFinal: true, isDelivered: false };
    case 2: return { label: 'timeout', isFinal: true, isDelivered: false };
    case 4: return { label: 'failed_cellular', isFinal: true, isDelivered: false };
    case 7: return { label: 'no_balance', isFinal: true, isDelivered: false };
    case 14: return { label: 'failed_store_forward', isFinal: true, isDelivered: false };
    case 15: return { label: 'kosher_number', isFinal: true, isDelivered: false };
    case 16: return { label: 'no_send_permission', isFinal: true, isDelivered: false };
    case 17: return { label: 'blocked_marketing', isFinal: true, isDelivered: false };
    case 18: return { label: 'invalid_message', isFinal: true, isDelivered: false };
    case 101:
    case 105:
    case 106:
    case 107: return { label: 'not_delivered', isFinal: true, isDelivered: false };
    case 103: return { label: 'expired', isFinal: true, isDelivered: false };
    case 104: return { label: 'deleted', isFinal: true, isDelivered: false };
    case 108: return { label: 'rejected', isFinal: true, isDelivered: false };
    case 201: return { label: 'blocked_by_request', isFinal: true, isDelivered: false };
    case 747: return { label: 'out_of_coverage', isFinal: true, isDelivered: false };
    case 998: return { label: 'no_permission', isFinal: true, isDelivered: false };
    case 999: return { label: 'unknown_error', isFinal: true, isDelivered: false };
    default:
      if (status >= 109 && status <= 132) return { label: 'not_delivered', isFinal: true, isDelivered: false };
      return { label: `unknown_${status}`, isFinal: false, isDelivered: false };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Optional: specific campaign_id from body (for manual check)
    let campaignId: string | null = null;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        campaignId = body.campaign_id || null;
      } catch { /* no body = cron mode */ }
    }

    // Auth check only for manual (non-cron) calls
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get SMS settings for API credentials
    const { data: smsSettings } = await supabase
      .from('sms_settings')
      .select('*')
      .single();

    if (!smsSettings) {
      return new Response(JSON.stringify({ error: 'SMS settings not configured' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get recipients that need DLR checking
    let query = supabase
      .from('marketing_sms_recipients')
      .select('id, campaign_id, dlr_id, phone_number')
      .not('dlr_id', 'is', null)
      .in('dlr_status', ['pending', 'sent_no_confirmation'])
      .order('sent_at', { ascending: true })
      .limit(500);

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data: recipients, error: recipError } = await query;
    if (recipError) throw recipError;

    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No pending DLRs', checked: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Checking DLR for ${recipients.length} recipients`);

    // Group by campaign for efficient batch queries
    const byCampaign = new Map<string, typeof recipients>();
    for (const r of recipients) {
      const arr = byCampaign.get(r.campaign_id) || [];
      arr.push(r);
      byCampaign.set(r.campaign_id, arr);
    }

    const escapeXml = (str: string) =>
      str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    let totalChecked = 0;
    let totalDelivered = 0;
    let totalFailed = 0;

    // Process each batch of DLR IDs (max 1000 per API call)
    const allDlrIds = recipients.map(r => r.dlr_id!);
    const batchSize = 500;

    for (let i = 0; i < allDlrIds.length; i += batchSize) {
      const batch = allDlrIds.slice(i, i + batchSize);
      const batchRecipients = recipients.slice(i, i + batchSize);

      // Build DLR request XML
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const formatDate = (d: Date) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(2);
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return `${dd}/${mm}/${yy} ${hh}:${min}`;
      };

      const externalIds = batch.map(id => `<external_id>${escapeXml(id)}</external_id>`).join('');
      const dlrXml = `<?xml version="1.0" encoding="UTF-8"?><dlr><user><username>${escapeXml(smsSettings.sms_user)}</username></user><transactions>${externalIds}</transactions><from>${formatDate(weekAgo)}</from><to>${formatDate(now)}</to></dlr>`;

      console.log(`Querying DLR for ${batch.length} IDs`);

      const dlrResponse = await fetch('https://019sms.co.il/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Authorization': `Bearer ${smsSettings.sms_token}`,
        },
        body: dlrXml,
      });

      const dlrText = await dlrResponse.text();
      console.log(`DLR response length: ${dlrText.length}`);

      // Parse DLR response - extract transactions
      const transactionRegex = /<transaction>[\s\S]*?<external_id>(.*?)<\/external_id>[\s\S]*?<status>(\d+)<\/status>[\s\S]*?<\/transaction>/g;
      const dlrResults = new Map<string, number>();
      let match;
      while ((match = transactionRegex.exec(dlrText)) !== null) {
        dlrResults.set(match[1], parseInt(match[2]));
      }

      console.log(`Found ${dlrResults.size} DLR results`);

      // Update each recipient with DLR status
      for (const r of batchRecipients) {
        const dlrStatusCode = dlrResults.get(r.dlr_id!);
        if (dlrStatusCode !== undefined) {
          const info = getDlrStatusInfo(dlrStatusCode);
          
          const newStatus = info.isDelivered ? 'delivered' : (info.isFinal ? 'failed' : 'sent');
          
          await supabase
            .from('marketing_sms_recipients')
            .update({
              status: newStatus,
              dlr_status: info.label,
              dlr_message: `Status code: ${dlrStatusCode}`,
              dlr_checked_at: new Date().toISOString(),
            })
            .eq('id', r.id);

          if (info.isDelivered) totalDelivered++;
          else if (info.isFinal) totalFailed++;
          totalChecked++;
        }
      }
    }

    // Update campaign counts
    const campaignIds = [...byCampaign.keys()];
    for (const cid of campaignIds) {
      // Count statuses
      const { count: deliveredCount } = await supabase
        .from('marketing_sms_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', cid)
        .eq('status', 'delivered');

      const { count: failedCount } = await supabase
        .from('marketing_sms_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', cid)
        .eq('status', 'failed');

      await supabase
        .from('marketing_sms_campaigns')
        .update({
          delivered_count: deliveredCount || 0,
          dlr_failed_count: failedCount || 0,
          last_dlr_check_at: new Date().toISOString(),
        })
        .eq('id', cid);
    }

    console.log(`DLR check complete: ${totalChecked} checked, ${totalDelivered} delivered, ${totalFailed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        checked: totalChecked,
        delivered: totalDelivered,
        failed: totalFailed,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in check-sms-delivery:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
