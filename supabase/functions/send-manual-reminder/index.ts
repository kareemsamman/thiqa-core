import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.88.0';
import { getAgentBranding, resolveAgentId } from "../_shared/agent-branding.ts";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { checkUsageLimit, limitReachedResponse, logUsage } from "../_shared/usage-limits.ts";

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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
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

    // Raw-fetch RPC helper that forwards the caller's JWT straight to
    // PostgREST. We avoid creating a second supabase-js client with
    // `global.headers.Authorization` because that path runs gotrue-js
    // JWT decoding locally, which blows up on ES256-signed tokens
    // with "Unsupported JWT algorithm ES256". Postgrest + the auth
    // server handle ES256 natively, so going through raw fetch is
    // safe.
    const rpcAsCaller = async (fn: string, params: Record<string, unknown>) => {
      const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`rpc ${fn} failed (${resp.status}): ${body}`);
      }
      return resp.json();
    };

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

    // Resolve caller's agent so we can enforce tenant isolation on the
    // client lookup below. Without this check the service-role client
    // would happily read any client row by id and let one agent SMS
    // another agent's customer.
    const callerAgentId = await resolveAgentId(supabase, user.id);
    if (!callerAgentId) {
      return new Response(
        JSON.stringify({ error: 'User is not associated with an agent' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get client info — scoped to caller's agent
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, full_name, phone_number, branch_id, agent_id')
      .eq('id', client_id)
      .eq('agent_id', callerAgentId)
      .maybeSingle();

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

    // Get SMS credentials for this agent (with Thiqa platform fallback)
    const tempAgentId = await resolveAgentId(supabase, user.id);
    const smsSettings = await resolveSmsSettings(supabase, tempAgentId);

    if (!smsSettings) {
      return new Response(
        JSON.stringify({ error: 'SMS service not enabled' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Enforce SMS quota
    const smsCheck = await checkUsageLimit(supabase, tempAgentId, "sms");
    if (!smsCheck.allowed) {
      return limitReachedResponse("sms", smsCheck, corsHeaders);
    }

    // Get company footer info from agent's SMS settings row
    const { data: agentSmsRow } = await supabase
      .from('sms_settings')
      .select('company_location, company_phone_links')
      .eq('agent_id', tempAgentId)
      .maybeSingle();

    const companyLocation = agentSmsRow?.company_location || '';
    const phoneLinks = (agentSmsRow?.company_phone_links as any[]) || [];
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

      // Fetch policy details for this client. Raw-fetch with the
      // caller's JWT so auth.uid() is populated inside the RPC
      // (is_active_user / can_access_branch gate on it).
      let policies: any[] = [];
      try {
        const rpcData = await rpcAsCaller('report_debt_policies_for_clients', {
          p_client_ids: [client_id],
        });
        policies = Array.isArray(rpcData) ? rpcData : [];
      } catch (err) {
        console.error('report_debt_policies_for_clients failed:', err);
      }

      // Build policy lines (max 5 to keep SMS short). Group by group_id so
      // packages appear as a single combined entry, ELZAMI is hidden unless
      // it has office_commission, and the commission is surfaced as a "+
      // عمولة مكتب" suffix instead of a standalone line.
      type DebtPolicy = {
        policy_type_parent: string;
        policy_type_child: string | null;
        car_number: string | null;
        insurance_price: number;
        office_commission: number;
        paid: number;
        group_id: string | null;
      };
      const allPolicies: DebtPolicy[] = (policies || []).map((p: any) => ({
        policy_type_parent: p.policy_type_parent,
        policy_type_child: p.policy_type_child,
        car_number: p.car_number,
        insurance_price: Number(p.insurance_price) || 0,
        office_commission: Number(p.office_commission) || 0,
        paid: Number(p.paid) || 0,
        group_id: p.group_id,
      }));

      const groups = new Map<string, DebtPolicy[]>();
      const standalone: DebtPolicy[] = [];
      for (const p of allPolicies) {
        if (p.group_id) {
          const list = groups.get(p.group_id) || [];
          list.push(p);
          groups.set(p.group_id, list);
        } else {
          standalone.push(p);
        }
      }

      const lines: string[] = [];

      // Package lines
      for (const items of groups.values()) {
        const nonElzami = items.filter((i) => i.policy_type_parent !== 'ELZAMI');
        const elzami = items.filter((i) => i.policy_type_parent === 'ELZAMI');
        const nonElzamiPrice = nonElzami.reduce((s, i) => s + i.insurance_price + i.office_commission, 0);
        const elzamiCommission = elzami.reduce((s, i) => s + i.office_commission, 0);
        const nonElzamiPaid = nonElzami.reduce((s, i) => s + i.paid, 0);
        const elzamiPaidTowardCommission = elzami.reduce(
          (s, i) => s + Math.max(0, i.paid - i.insurance_price),
          0,
        );
        const price = nonElzamiPrice + elzamiCommission;
        const paid = nonElzamiPaid + elzamiPaidTowardCommission;
        const remaining = Math.round(Math.max(0, price - paid));
        if (remaining <= 0) continue;
        const labels = nonElzami
          .map((i) => getPolicyTypeLabel(i.policy_type_parent, i.policy_type_child))
          .filter(Boolean)
          .join(' + ');
        const combined = labels + (elzamiCommission > 0 ? ' + عمولة مكتب' : '');
        const car = items[0].car_number || '';
        lines.push(`• ${combined}${car ? ` - ${car}` : ''} - ₪${remaining.toLocaleString('en-US')}`);
      }

      // Standalone lines (skip bare ELZAMI with no commission)
      for (const p of standalone) {
        const isElzami = p.policy_type_parent === 'ELZAMI';
        const commission = p.office_commission || 0;
        if (isElzami && commission === 0) continue;
        const price = isElzami ? commission : p.insurance_price + commission;
        const remaining = Math.round(Math.max(0, price - p.paid));
        if (remaining <= 0) continue;
        const typeLabel = isElzami
          ? 'عمولة مكتب'
          : getPolicyTypeLabel(p.policy_type_parent, p.policy_type_child) +
            (commission > 0 ? ' + عمولة مكتب' : '');
        const car = p.car_number || '';
        lines.push(`• ${typeLabel}${car ? ` - ${car}` : ''} - ₪${remaining.toLocaleString('en-US')}`);
      }

      const policyLines = lines.slice(0, 5).join('\n');

      // Build policy section only if there are policies with remaining balance
      const policySection = policyLines.length > 0 
        ? `\n\nالوثائق:\n${policyLines}` 
        : '';

      // Build final message with policy details and footer
      finalMessage = `مرحباً ${client.full_name}،

عليك تسديد المبلغ: ₪${totalRemaining.toLocaleString('en-US')}${policySection}

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

    // Track usage for quota enforcement
    await logUsage(supabase, tempAgentId, "sms");

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
