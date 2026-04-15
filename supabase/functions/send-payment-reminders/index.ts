import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { getAgentBranding, type AgentBranding } from "../_shared/agent-branding.ts";
import { appendSmsFooter } from "../_shared/sms-footer.ts";
import { checkUsageLimit, logUsage } from "../_shared/usage-limits.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting payment reminders check...');

    // Get agent-level SMS settings row (for templates and feature flags)
    const { data: agentSmsRow } = await supabase
      .from('sms_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    // Get SMS credentials (with Thiqa platform fallback)
    const smsSettings = await resolveSmsSettings(supabase, agentSmsRow?.agent_id);

    if (!smsSettings || !agentSmsRow?.enable_auto_reminders) {
      console.log('SMS or auto reminders not enabled');
      return new Response(
        JSON.stringify({ success: true, message: 'Auto reminders disabled', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const today = new Date();
    const in1Month = new Date(today);
    in1Month.setMonth(in1Month.getMonth() + 1);
    const in1Week = new Date(today);
    in1Week.setDate(in1Week.getDate() + 7);

    const todayStr = today.toISOString().split('T')[0];
    const in1MonthStr = in1Month.toISOString().split('T')[0];

    console.log(`Checking policies expiring before ${in1MonthStr}`);

    // Get policies that need reminders with their remaining balance
    const { data: policies, error: policiesError } = await supabase
      .from('policies')
      .select(`
        id,
        policy_number,
        end_date,
        insurance_price,
        branch_id,
        client_id,
        agent_id,
        clients!inner(id, full_name, phone_number),
        policy_payments(amount, refused)
      `)
      .eq('cancelled', false)
      .is('deleted_at', null)
      .gte('end_date', todayStr)
      .lte('end_date', in1MonthStr);

    if (policiesError) {
      console.error('Error fetching policies:', policiesError);
      throw policiesError;
    }

    console.log(`Found ${policies?.length || 0} policies expiring within 1 month`);

    // Get existing reminders to avoid duplicates
    const policyIds = policies?.map(p => p.id) || [];
    const { data: existingReminders } = await supabase
      .from('policy_reminders')
      .select('policy_id, reminder_type')
      .in('policy_id', policyIds);

    const reminderSet = new Set(
      existingReminders?.map(r => `${r.policy_id}_${r.reminder_type}`) || []
    );

    const notifications: any[] = [];
    const smsLogs: any[] = [];
    const remindersToInsert: any[] = [];
    let sentCount = 0;
    let skippedQuota = 0;

    // Per-agent quota cache — resolve each agent's SMS budget once per run and
    // decrement locally as we send, so we don't re-query `agent_usage_log`
    // for every policy.
    const agentQuotaCache = new Map<string, { remaining: number; unlimited: boolean }>();
    const getAgentQuota = async (agentId: string) => {
      let cached = agentQuotaCache.get(agentId);
      if (!cached) {
        const check = await checkUsageLimit(supabase, agentId, "sms");
        cached = {
          remaining:
            check.limit_type === "unlimited"
              ? Number.MAX_SAFE_INTEGER
              : Math.max(0, check.limit - check.used),
          unlimited: check.limit_type === "unlimited",
        };
        agentQuotaCache.set(agentId, cached);
      }
      return cached;
    };

    // Per-agent branding cache — each policy's owner/phones footer is
    // fetched once and reused across all reminders sent to their clients.
    const agentBrandingCache = new Map<string | null, AgentBranding>();
    const getBranding = async (agentId: string | null) => {
      let cached = agentBrandingCache.get(agentId);
      if (!cached) {
        cached = await getAgentBranding(supabase, agentId);
        agentBrandingCache.set(agentId, cached);
      }
      return cached;
    };

    for (const policy of policies || []) {
      const client = policy.clients as any;
      const clientPhone = client?.phone_number;
      if (!clientPhone) continue;

      // Enforce per-agent SMS quota (best-effort: if policy lacks an agent_id,
      // skip the check since we can't attribute the send).
      const policyAgentId = (policy as any).agent_id as string | null;
      if (policyAgentId) {
        const quota = await getAgentQuota(policyAgentId);
        if (quota.remaining <= 0) {
          skippedQuota++;
          console.log(`[payment-reminders] Skipping policy ${policy.id}: agent ${policyAgentId} SMS quota exhausted`);
          continue;
        }
      }

      // Calculate remaining balance
      const totalPaid = (policy.policy_payments || [])
        .filter((p: any) => !p.refused)
        .reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      const remaining = policy.insurance_price - totalPaid;

      // Skip if fully paid
      if (remaining <= 0) continue;

      const endDate = new Date(policy.end_date);
      const daysUntilExpiry = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Determine reminder type
      let reminderType: string | null = null;
      let template: string | null = null;

      if (daysUntilExpiry <= 7 && !reminderSet.has(`${policy.id}_1week`)) {
        reminderType = '1week';
        template = agentSmsRow.reminder_1week_template;
      } else if (daysUntilExpiry <= 30 && daysUntilExpiry > 7 && !reminderSet.has(`${policy.id}_1month`)) {
        reminderType = '1month';
        template = agentSmsRow.reminder_1month_template;
      }

      if (!reminderType || !template) continue;

      // Format message + append the owning agent's footer (owner + phones).
      const baseMessage = template
        .replace(/\{\{client_name\}\}/g, client.full_name || 'عميل')
        .replace(/\{\{policy_number\}\}/g, policy.policy_number || policy.id.substring(0, 8))
        .replace(/\{\{remaining_amount\}\}/g, remaining.toFixed(0))
        .replace(/\{\{days_until_expiry\}\}/g, daysUntilExpiry.toString());
      const branding = await getBranding(policyAgentId);
      const message = appendSmsFooter(baseMessage, branding);

      // Send SMS
      try {
        const smsResult = await sendSms(smsSettings, clientPhone, message);

        const smsLogId = crypto.randomUUID();
        smsLogs.push({
          id: smsLogId,
          branch_id: policy.branch_id,
          client_id: client.id,
          policy_id: policy.id,
          phone_number: clientPhone,
          message,
          sms_type: reminderType === '1month' ? 'reminder_1month' : 'reminder_1week',
          status: smsResult.success ? 'sent' : 'failed',
          error_message: smsResult.error || null,
          sent_at: smsResult.success ? new Date().toISOString() : null,
        });

        if (smsResult.success) {
          remindersToInsert.push({
            policy_id: policy.id,
            reminder_type: reminderType,
            sms_log_id: smsLogId,
          });
          sentCount++;
          if (policyAgentId) {
            const quota = agentQuotaCache.get(policyAgentId);
            if (quota) quota.remaining -= 1;
            await logUsage(supabase, policyAgentId, "sms");
          }
        }

        // Create notification for admins
        const { data: activeUsers } = await supabase
          .from('profiles')
          .select('id, branch_id')
          .eq('status', 'active');

        for (const user of activeUsers || []) {
          if (user.branch_id && user.branch_id !== policy.branch_id) continue;
          
          notifications.push({
            user_id: user.id,
            type: 'reminder',
            title: reminderType === '1week' ? 'تذكير قبل أسبوع' : 'تذكير قبل شهر',
            message: `تم إرسال تذكير للعميل ${client.full_name} - متبقي ${remaining.toFixed(0)} شيكل`,
            link: '/policies',
            entity_type: 'policy',
            entity_id: policy.id,
          });
        }

      } catch (smsError: any) {
        console.error(`Failed to send SMS to ${clientPhone}:`, smsError);
        smsLogs.push({
          branch_id: policy.branch_id,
          client_id: client.id,
          policy_id: policy.id,
          phone_number: clientPhone,
          message,
          sms_type: reminderType === '1month' ? 'reminder_1month' : 'reminder_1week',
          status: 'failed',
          error_message: smsError.message,
        });
      }
    }

    // Insert all SMS logs
    if (smsLogs.length > 0) {
      const { error: logError } = await supabase
        .from('sms_logs')
        .insert(smsLogs);
      if (logError) console.error('Error inserting SMS logs:', logError);
    }

    // Insert reminders
    if (remindersToInsert.length > 0) {
      const { error: reminderError } = await supabase
        .from('policy_reminders')
        .upsert(remindersToInsert, { onConflict: 'policy_id,reminder_type' });
      if (reminderError) console.error('Error inserting reminders:', reminderError);
    }

    // Insert notifications
    if (notifications.length > 0) {
      const { error: notifError } = await supabase
        .from('notifications')
        .insert(notifications);
      if (notifError) console.error('Error inserting notifications:', notifError);
    }

    console.log(`Sent ${sentCount} reminders`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sent ${sentCount} payment reminders`,
        sent: sentCount,
        skipped_quota: skippedQuota,
        total_checked: policies?.length || 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in send-payment-reminders:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
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

  // Normalize phone
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
  console.log('019sms response:', smsResult);

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
