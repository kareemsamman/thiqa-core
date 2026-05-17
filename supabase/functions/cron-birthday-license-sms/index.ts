import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { sendSms, normalizePhoneFor } from "../_shared/sms-sender.ts";
import { getAgentBranding } from "../_shared/agent-branding.ts";
import { appendSmsFooter } from "../_shared/sms-footer.ts";
import { checkUsageLimit, logUsage } from "../_shared/usage-limits.ts";

// Daily cron — fires once a day at ~14:00 Asia/Jerusalem (see the
// schedule migration). For every agent that opted in via their
// sms_settings row, fans out two campaigns:
//   1. birthday SMS to clients whose birth_date's MM-DD matches today
//   2. license expiry SMS to cars whose license_expiry is ~1 month out
//
// Both pull templates + the on/off flag from the agent's own
// sms_settings row, both honor the per-agent SMS quota (skipped sends
// don't consume any budget), and both write to automated_sms_log
// keyed by (sms_type, client_id|car_id, sent_for_date) so re-runs
// the same day are idempotent. The natural per-year dedupe for
// birthdays falls out for free: next year's sent_for_date is a new
// row, so the message goes out again.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AgentSmsRow {
  agent_id: string;
  birthday_sms_enabled: boolean | null;
  birthday_sms_template: string | null;
  license_expiry_sms_enabled: boolean | null;
  license_expiry_sms_template: string | null;
}

interface AgentRunStats {
  agent_id: string;
  birthday_sent: number;
  birthday_skipped_quota: number;
  birthday_skipped_dup: number;
  birthday_failed: number;
  license_sent: number;
  license_skipped_quota: number;
  license_skipped_dup: number;
  license_failed: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[cron-birthday-license-sms] Starting daily run...');

    // Pull every agent that opted in to EITHER campaign. The previous
    // version hardcoded .limit(1) and only ever served one tenant.
    const { data: enabledAgents, error: agentsErr } = await supabase
      .from('sms_settings')
      .select('agent_id, birthday_sms_enabled, birthday_sms_template, license_expiry_sms_enabled, license_expiry_sms_template')
      .or('birthday_sms_enabled.eq.true,license_expiry_sms_enabled.eq.true');

    if (agentsErr) {
      console.error('[cron-birthday-license-sms] Failed to list enabled agents:', agentsErr);
      throw agentsErr;
    }

    const rows = (enabledAgents ?? []).filter(r => !!r.agent_id) as AgentSmsRow[];
    console.log(`[cron-birthday-license-sms] ${rows.length} agent(s) have birthday/license SMS enabled`);

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const todayMonth = today.getMonth() + 1;
    const todayDay = today.getDate();
    const oneMonthFromNow = new Date(today);
    oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
    const minDate = new Date(oneMonthFromNow); minDate.setDate(minDate.getDate() - 1);
    const maxDate = new Date(oneMonthFromNow); maxDate.setDate(maxDate.getDate() + 1);
    const minDateStr = minDate.toISOString().split('T')[0];
    const maxDateStr = maxDate.toISOString().split('T')[0];

    const perAgent: AgentRunStats[] = [];
    for (const row of rows) {
      const stats = await processAgent(
        supabase, row, todayStr, todayMonth, todayDay, minDateStr, maxDateStr,
      );
      perAgent.push(stats);
    }

    const totals = perAgent.reduce(
      (acc, a) => ({
        birthday_sent: acc.birthday_sent + a.birthday_sent,
        birthday_skipped_quota: acc.birthday_skipped_quota + a.birthday_skipped_quota,
        license_sent: acc.license_sent + a.license_sent,
        license_skipped_quota: acc.license_skipped_quota + a.license_skipped_quota,
      }),
      { birthday_sent: 0, birthday_skipped_quota: 0, license_sent: 0, license_skipped_quota: 0 },
    );
    const duration = Date.now() - startTime;
    console.log(`[cron-birthday-license-sms] Done in ${duration}ms. agents=${rows.length} birthday_sent=${totals.birthday_sent} birthday_skipped_quota=${totals.birthday_skipped_quota} license_sent=${totals.license_sent} license_skipped_quota=${totals.license_skipped_quota}`);

    return new Response(
      JSON.stringify({
        success: true,
        agents_processed: rows.length,
        duration_ms: duration,
        ...totals,
        per_agent: perAgent,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[cron-birthday-license-sms] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function processAgent(
  supabase: any,
  row: AgentSmsRow,
  todayStr: string,
  todayMonth: number,
  todayDay: number,
  licenseMinDate: string,
  licenseMaxDate: string,
): Promise<AgentRunStats> {
  const agentId = row.agent_id;
  const stats: AgentRunStats = {
    agent_id: agentId,
    birthday_sent: 0, birthday_skipped_quota: 0, birthday_skipped_dup: 0, birthday_failed: 0,
    license_sent: 0, license_skipped_quota: 0, license_skipped_dup: 0, license_failed: 0,
  };

  const smsSettings = await resolveSmsSettings(supabase, agentId);
  if (!smsSettings || !smsSettings.is_enabled) {
    console.log(`[cron-birthday-license-sms] agent=${agentId}: SMS not configured/disabled, skipping`);
    return stats;
  }
  const branding = await getAgentBranding(supabase, agentId);

  // Per-agent quota — same RPC the renewal cron + manual sends use.
  // Compute remaining as (effective + credits) - used so topup credits
  // stack on top of the base monthly allowance.
  const quota = await checkUsageLimit(supabase, agentId, 'sms');
  const unlimited = quota.limit_type === 'unlimited';
  let remaining = unlimited
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, (quota.effective_limit ?? quota.limit) - quota.used);
  console.log(`[cron-birthday-license-sms] agent=${agentId}: quota_remaining=${unlimited ? '∞' : remaining}`);

  // ===== BIRTHDAY =====
  if (row.birthday_sms_enabled) {
    const { data: candidates } = await supabase
      .from('clients')
      .select('id, full_name, phone_number, birth_date')
      .eq('agent_id', agentId)
      .is('deleted_at', null)
      .not('phone_number', 'is', null)
      .not('birth_date', 'is', null);

    const todayMatches = (candidates ?? []).filter((c: any) => {
      if (!c.birth_date) return false;
      const d = new Date(c.birth_date);
      return d.getMonth() + 1 === todayMonth && d.getDate() === todayDay;
    });
    console.log(`[cron-birthday-license-sms] agent=${agentId}: ${todayMatches.length} birthday candidate(s) today`);

    const template = row.birthday_sms_template || 'كل عام وأنت بخير {client_name}! 🎉 عيد ميلاد سعيد من {company_name}';

    for (const client of todayMatches) {
      // Idempotency: skip if we already logged a send for this client
      // today. sent_for_date is a calendar date, so next year's run on
      // the same MM-DD gets a fresh row — natural per-year dedupe.
      const { data: existing } = await supabase
        .from('automated_sms_log')
        .select('id')
        .eq('sms_type', 'birthday')
        .eq('client_id', client.id)
        .eq('sent_for_date', todayStr)
        .maybeSingle();
      if (existing) {
        stats.birthday_skipped_dup++;
        continue;
      }

      if (remaining <= 0) {
        stats.birthday_skipped_quota++;
        // No log row, no quota debit. Tomorrow's run won't re-trigger
        // because the calendar will have moved past the birthday.
        continue;
      }

      const baseMessage = template
        .replace(/{client_name}/g, client.full_name || 'عميل')
        .replace(/{company_name}/g, branding.companyName || '');
      const message = appendSmsFooter(baseMessage, branding);
      const cleanPhone = normalizePhoneFor(smsSettings.provider, client.phone_number);

      let success = false;
      let errorMsg: string | null = null;
      try {
        const sendResult = await sendSms(smsSettings, client.phone_number, message);
        success = sendResult.success;
        errorMsg = sendResult.error ?? null;
      } catch (e) {
        success = false;
        errorMsg = e instanceof Error ? e.message : 'send error';
      }

      await supabase.from('automated_sms_log').insert({
        agent_id: agentId,
        sms_type: 'birthday',
        client_id: client.id,
        phone_number: cleanPhone,
        message,
        status: success ? 'sent' : 'failed',
        sent_for_date: todayStr,
        error_message: success ? null : errorMsg,
      });

      await supabase.from('sms_logs').insert({
        agent_id: agentId,
        phone_number: cleanPhone,
        message: message.slice(0, 500),
        status: success ? 'sent' : 'failed',
        sms_type: 'birthday',
        entity_type: 'client',
        entity_id: client.id,
        client_id: client.id,
        sent_at: new Date().toISOString(),
      });

      if (success) {
        await logUsage(supabase, agentId, 'sms');
        if (!unlimited) remaining -= 1;
        stats.birthday_sent++;
      } else {
        stats.birthday_failed++;
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // ===== LICENSE EXPIRY =====
  if (row.license_expiry_sms_enabled) {
    const { data: expiringCars } = await supabase
      .from('cars')
      .select(`
        id, car_number, license_expiry, client_id, agent_id,
        clients!inner(id, full_name, phone_number)
      `)
      .eq('agent_id', agentId)
      .is('deleted_at', null)
      .not('license_expiry', 'is', null)
      .gte('license_expiry', licenseMinDate)
      .lte('license_expiry', licenseMaxDate);

    console.log(`[cron-birthday-license-sms] agent=${agentId}: ${(expiringCars ?? []).length} car(s) with license expiring in ~1 month`);

    const template = row.license_expiry_sms_template || 'تنبيه: رخصة سيارتك {car_number} ستنتهي قريباً';

    for (const car of (expiringCars ?? [])) {
      const client = car.clients as any;
      if (!client?.phone_number) continue;

      const { data: existing } = await supabase
        .from('automated_sms_log')
        .select('id')
        .eq('sms_type', 'license_expiry')
        .eq('car_id', car.id)
        .eq('sent_for_date', car.license_expiry)
        .maybeSingle();
      if (existing) {
        stats.license_skipped_dup++;
        continue;
      }

      if (remaining <= 0) {
        stats.license_skipped_quota++;
        continue;
      }

      const baseMessage = template
        .replace(/{client_name}/g, client.full_name || 'عميل')
        .replace(/{car_number}/g, car.car_number || '')
        .replace(/{company_name}/g, branding.companyName || '');
      const message = appendSmsFooter(baseMessage, branding);
      const cleanPhone = normalizePhoneFor(smsSettings.provider, client.phone_number);

      let success = false;
      let errorMsg: string | null = null;
      try {
        const sendResult = await sendSms(smsSettings, client.phone_number, message);
        success = sendResult.success;
        errorMsg = sendResult.error ?? null;
      } catch (e) {
        success = false;
        errorMsg = e instanceof Error ? e.message : 'send error';
      }

      await supabase.from('automated_sms_log').insert({
        agent_id: agentId,
        sms_type: 'license_expiry',
        client_id: client.id,
        car_id: car.id,
        phone_number: cleanPhone,
        message,
        status: success ? 'sent' : 'failed',
        sent_for_date: car.license_expiry,
        error_message: success ? null : errorMsg,
      });

      await supabase.from('sms_logs').insert({
        agent_id: agentId,
        phone_number: cleanPhone,
        message: message.slice(0, 500),
        status: success ? 'sent' : 'failed',
        sms_type: 'license_expiry',
        entity_type: 'car',
        entity_id: car.id,
        client_id: client.id,
        sent_at: new Date().toISOString(),
      });

      if (success) {
        await logUsage(supabase, agentId, 'sms');
        if (!unlimited) remaining -= 1;
        stats.license_sent++;
      } else {
        stats.license_failed++;
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`[cron-birthday-license-sms] agent=${agentId}: birthday_sent=${stats.birthday_sent} birthday_quota_skipped=${stats.birthday_skipped_quota} license_sent=${stats.license_sent} license_quota_skipped=${stats.license_skipped_quota}`);
  return stats;
}
