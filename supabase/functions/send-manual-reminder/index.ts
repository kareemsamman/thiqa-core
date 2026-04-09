import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAgentBranding, resolveAgentId } from "../_shared/agent-branding.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ManualReminderRequest {
  client_id: string;
  policy_id?: string;
  message?: string;
  sms_type?: string;
}

// Helper to get policy type label in Arabic
const POLICY_TYPE_LABELS: Record<string, string> = {
  'ELZAMI': 'إلزامي',
  'THIRD_FULL': 'ثالث/شامل',
  'THIRD_ONLY': 'طرف ثالث',
  'ROAD_SERVICE': 'خدمات طريق',
  'ACCIDENT_FEE_EXEMPTION': 'إعفاء رسوم',
};

const getPolicyTypeLabel = (parent: string | null, child: string | null): string => {
  if (!parent) return 'وثيقة';
  const parentLabel = POLICY_TYPE_LABELS[parent] || parent;
  if (child && parent === 'THIRD_FULL') {
    return child === 'FULL' ? 'شامل' : child === 'THIRD' ? 'ثالث' : parentLabel;
  }
  return parentLabel;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is active
    const { data: profile } = await supabase
      .from('profiles')
      .select('status, branch_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'User not authorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { client_id, policy_id, message, sms_type }: ManualReminderRequest = await req.json();

    if (!client_id) {
      return new Response(
        JSON.stringify({ error: 'client_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get client info
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, full_name, phone_number, branch_id')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: 'Client not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clientPhone = client.phone_number;
    if (!clientPhone) {
      return new Response(
        JSON.stringify({ error: 'Client has no phone number' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get SMS settings for this agent
    const tempAgentId = await resolveAgentId(supabase, user.id);
    const { data: smsSettings, error: settingsError } = await supabase
      .from('sms_settings')
      .select('*')
      .eq('agent_id', tempAgentId)
      .maybeSingle();

    if (settingsError || !smsSettings?.is_enabled) {
      return new Response(
        JSON.stringify({ error: 'SMS service not enabled' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get company footer info from SMS settings
    const companyLocation = smsSettings.company_location || '';
    const phoneLinks = (smsSettings.company_phone_links as any[]) || [];
    const phones = phoneLinks.map((p: any) => p.phone).filter(Boolean).join(' | ');

    // Fetch dynamic branding
    const agentId = await resolveAgentId(supabase, user.id);
    const branding = await getAgentBranding(supabase, agentId);

    // Build message
    let finalMessage = message || '';
    
    if (!finalMessage) {
      // Use unified get_client_balance RPC for accurate total
      const { data: balanceData, error: balanceError } = await supabase.rpc(
        'get_client_balance',
        { p_client_id: client_id }
      );

      if (balanceError) {
        console.error('Error fetching client balance:', balanceError);
        return new Response(
          JSON.stringify({ error: 'Unable to load balance data. Please try again.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const balance = balanceData?.[0];
      const totalRemaining = Math.round(Number(balance?.total_remaining) || 0);

      if (totalRemaining <= 0) {
        return new Response(
          JSON.stringify({ error: 'No remaining balance for this client' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch policy details for this client
      const { data: policies } = await supabase.rpc(
        'report_debt_policies_for_clients',
        { p_client_ids: [client_id] }
      );

      // Build policy lines (max 5 to keep SMS short)
      const policyLines = (policies || [])
        .filter((p: any) => (p.remaining || 0) > 0)
        .map((p: any) => {
          const typeLabel = getPolicyTypeLabel(p.policy_type_parent, p.policy_type_child);
          const car = p.car_number || '';
          const remaining = Math.round(p.remaining || 0);
          return `• ${typeLabel}${car ? ` - ${car}` : ''} - ₪${remaining.toLocaleString()}`;
        })
        .slice(0, 5)
        .join('\n');

      // Build policy section only if there are policies with remaining balance
      const policySection = policyLines.length > 0 
        ? `\n\nالوثائق:\n${policyLines}` 
        : '';

      // Build final message with policy details and footer
      finalMessage = `مرحباً ${client.full_name}،

عليك تسديد المبلغ: ₪${totalRemaining.toLocaleString()}${policySection}

${branding.companyName}`;

      // Add location if available
      if (companyLocation) {
        finalMessage += `\n📍 ${companyLocation}`;
      }

      // Add phones if available
      if (phones) {
        finalMessage += `\n📞 ${phones}`;
      }
    }

    // Send SMS
    const smsResult = await sendSms(smsSettings, clientPhone, finalMessage);

    // Log the SMS
    const { error: logError } = await supabase
      .from('sms_logs')
      .insert({
        branch_id: client.branch_id,
        client_id: client.id,
        policy_id: policy_id || null,
        phone_number: clientPhone,
        message: finalMessage,
        sms_type: sms_type || 'payment_request',
        status: smsResult.success ? 'sent' : 'failed',
        error_message: smsResult.error || null,
        sent_at: smsResult.success ? new Date().toISOString() : null,
        created_by: user.id,
      });

    if (logError) {
      console.error('Error logging SMS:', logError);
    }

    if (!smsResult.success) {
      return new Response(
        JSON.stringify({ error: smsResult.error || 'Failed to send SMS' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'SMS sent successfully',
        phone: clientPhone,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    // Log full error details server-side for debugging
    console.error('Error in send-manual-reminder:', error);
    
    // Return generic error message to client - never expose internal details
    return new Response(
      JSON.stringify({ error: 'Unable to send reminder at this time. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function sendSms(
  settings: any,
  phone: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const { sms_user, sms_token, sms_source } = settings;

  if (!sms_user || !sms_token || !sms_source) {
    return { success: false, error: 'SMS settings incomplete' };
  }

  const escapeXml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  let cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.startsWith('972')) {
    cleanPhone = '0' + cleanPhone.substring(3);
  }

  const dlr = crypto.randomUUID();
  const smsXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sms>` +
    `<user><username>${escapeXml(sms_user)}</username></user>` +
    `<source>${escapeXml(sms_source)}</source>` +
    `<destinations><phone id="${dlr}">${escapeXml(cleanPhone)}</phone></destinations>` +
    `<message>${escapeXml(message)}</message>` +
    `</sms>`;

  console.log(`Sending SMS to ${cleanPhone}`);

  const smsResponse = await fetch('https://019sms.co.il/api', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sms_token}`,
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: smsXml,
  });

  const smsResult = await smsResponse.text();

  const extractTag = (xml: string, tag: string) => {
    const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    return match?.[1]?.trim() ?? null;
  };

  const status = extractTag(smsResult, 'status');
  const apiMessage = extractTag(smsResult, 'message');

  if (!smsResponse.ok || status !== '0') {
    return { success: false, error: apiMessage || `SMS API error (status=${status})` };
  }

  return { success: true };
}
