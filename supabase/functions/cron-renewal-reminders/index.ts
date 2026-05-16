import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { sendSms, normalizePhoneFor } from "../_shared/sms-sender.ts";
import { getAgentBranding } from "../_shared/agent-branding.ts";
import { appendSmsFooter } from "../_shared/sms-footer.ts";
import { checkUsageLimit, logUsage } from "../_shared/usage-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
};

function getDisplayLabel(parent: string, child: string | null): string {
  if (parent === 'THIRD_FULL' && child) {
    const childLabels: Record<string, string> = { THIRD: 'ثالث', FULL: 'شامل' };
    return childLabels[child] || child;
  }
  return POLICY_TYPE_LABELS[parent] || parent;
}

interface AgentSmsRow {
  agent_id: string;
  reminder_1month_template: string | null;
  reminder_1week_template: string | null;
  renewal_reminder_cooldown_days: number | null;
  renewal_reminder_1month_enabled: boolean | null;
  renewal_reminder_1week_enabled: boolean | null;
}

interface AgentStats {
  agent_id: string;
  sent: number;
  skipped_quota: number;
  skipped_other: number;
  errors: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log("[cron-renewal-reminders] Starting daily run...");

  try {
    // Pull every agent that has the auto-reminder switch turned on. Multi-tenant:
    // each agent has their own sms_settings row, templates, branding, quota.
    // The previous version hardcoded .limit(1) and only ever served one tenant.
    const { data: enabledAgents, error: agentsErr } = await supabase
      .from("sms_settings")
      .select("agent_id, reminder_1month_template, reminder_1week_template, renewal_reminder_cooldown_days, renewal_reminder_1month_enabled, renewal_reminder_1week_enabled")
      .eq("enable_auto_renewal_reminders", true);

    if (agentsErr) {
      console.error("[cron-renewal-reminders] Failed to list enabled agents:", agentsErr);
      throw agentsErr;
    }

    const rows = (enabledAgents ?? []).filter((r) => !!r.agent_id) as AgentSmsRow[];
    console.log(`[cron-renewal-reminders] ${rows.length} agent(s) have auto reminders enabled`);

    const perAgentStats: AgentStats[] = [];
    for (const row of rows) {
      const stats = await processAgent(supabase, row);
      perAgentStats.push(stats);
    }

    const totalSent = perAgentStats.reduce((s, a) => s + a.sent, 0);
    const totalQuotaSkipped = perAgentStats.reduce((s, a) => s + a.skipped_quota, 0);
    const totalSkippedOther = perAgentStats.reduce((s, a) => s + a.skipped_other, 0);
    const totalErrors = perAgentStats.reduce((s, a) => s + a.errors, 0);
    const duration = Date.now() - startTime;

    console.log(`[cron-renewal-reminders] Done in ${duration}ms. agents=${rows.length} sent=${totalSent} quota_skipped=${totalQuotaSkipped} other_skipped=${totalSkippedOther} errors=${totalErrors}`);

    return new Response(
      JSON.stringify({
        success: true,
        agents_processed: rows.length,
        sent_count: totalSent,
        quota_skipped_count: totalQuotaSkipped,
        skipped_count: totalSkippedOther,
        error_count: totalErrors,
        duration_ms: duration,
        per_agent: perAgentStats,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[cron-renewal-reminders] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: "An error occurred during processing. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processAgent(supabase: any, row: AgentSmsRow): Promise<AgentStats> {
  const agentId = row.agent_id;
  const stats: AgentStats = { agent_id: agentId, sent: 0, skipped_quota: 0, skipped_other: 0, errors: 0 };

  // Per-agent SMS provider + branding (with platform-default fallbacks via resolveSmsSettings).
  const smsSettings = await resolveSmsSettings(supabase, agentId);
  if (!smsSettings || !smsSettings.is_enabled) {
    console.log(`[cron-renewal-reminders] agent=${agentId}: SMS not configured/disabled, skipping`);
    return stats;
  }
  const branding = await getAgentBranding(supabase, agentId);

  // Per-agent quota: same RPC the /subscription bar and the manual sender use.
  // Compute remaining as (effective_limit + credits) - used so credits stack on
  // top of the base monthly allowance, matching checkUsageLimit's `allowed` rule.
  const quota = await checkUsageLimit(supabase, agentId, "sms");
  const unlimited = quota.limit_type === "unlimited";
  let remaining = unlimited
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, (quota.effective_limit ?? quota.limit) - quota.used);

  const template1Month = row.reminder_1month_template ||
    "مرحباً {client_name}، نذكرك بأن معاملة التأمين لسيارتك ({car_number}) ستنتهي بعد شهر تقريباً في تاريخ {end_date}.{price_line} يرجى التواصل معنا للتجديد.";
  const template1Week = row.reminder_1week_template ||
    "مرحباً {client_name}، تنبيه عاجل: معاملة التأمين لسيارتك ({car_number}) ستنتهي خلال أسبوع في تاريخ {end_date}.{price_line} يرجى التجديد قبل الانتهاء.";

  const cooldownDays = row.renewal_reminder_cooldown_days ?? 7;
  const cooldownDate = new Date();
  cooldownDate.setDate(cooldownDate.getDate() - cooldownDays);

  const oneMonthEnabled = row.renewal_reminder_1month_enabled !== false;
  const oneWeekEnabled = row.renewal_reminder_1week_enabled !== false;

  const today = new Date();
  const oneMonthMin = new Date(today); oneMonthMin.setDate(today.getDate() + 28);
  const oneMonthMax = new Date(today); oneMonthMax.setDate(today.getDate() + 32);
  const oneWeekMin = new Date(today); oneWeekMin.setDate(today.getDate() + 5);
  const oneWeekMax = new Date(today); oneWeekMax.setDate(today.getDate() + 9);

  // Fetch 1-week policies first — more urgent — then 1-month, scoped to this
  // agent. If quota runs out mid-loop, week reminders won't get starved by
  // month reminders sent earlier in the same run.
  const policies: any[] = [];
  if (oneWeekEnabled) {
    const { data } = await supabase
      .from("policies")
      .select(`
        id, end_date, policy_type_parent, policy_type_child,
        insurance_price, office_commission, branch_id,
        client:clients(id, full_name, phone_number),
        car:cars(car_number)
      `)
      .eq("agent_id", agentId)
      .gte("end_date", oneWeekMin.toISOString().split("T")[0])
      .lte("end_date", oneWeekMax.toISOString().split("T")[0])
      .eq("cancelled", false)
      .eq("transferred", false)
      .is("deleted_at", null);
    (data ?? []).forEach((p: any) => policies.push({ ...p, _reminderType: "1week" as const }));
  }
  if (oneMonthEnabled) {
    const { data } = await supabase
      .from("policies")
      .select(`
        id, end_date, policy_type_parent, policy_type_child,
        insurance_price, office_commission, branch_id,
        client:clients(id, full_name, phone_number),
        car:cars(car_number)
      `)
      .eq("agent_id", agentId)
      .gte("end_date", oneMonthMin.toISOString().split("T")[0])
      .lte("end_date", oneMonthMax.toISOString().split("T")[0])
      .eq("cancelled", false)
      .eq("transferred", false)
      .is("deleted_at", null);
    (data ?? []).forEach((p: any) => policies.push({ ...p, _reminderType: "1month" as const }));
  }

  console.log(`[cron-renewal-reminders] agent=${agentId}: ${policies.length} candidate policies, quota_remaining=${unlimited ? "∞" : remaining}`);

  for (const policy of policies) {
    const reminderType = policy._reminderType as "1month" | "1week";
    const client = policy.client;
    const car = policy.car;

    if (!client?.phone_number) {
      stats.skipped_other++;
      continue;
    }

    // Cooldown: don't re-send the same reminder type within cooldown window.
    const { data: existingReminder } = await supabase
      .from("policy_reminders")
      .select("id")
      .eq("policy_id", policy.id)
      .eq("reminder_type", `renewal_${reminderType}`)
      .gte("sent_at", cooldownDate.toISOString())
      .maybeSingle();
    if (existingReminder) {
      stats.skipped_other++;
      continue;
    }

    // Quota gate: if no room left, mark the policy as skipped-for-quota so the
    // renewals page can surface a badge, and move on. We DON'T break — later
    // policies might still be sendable if some had no phone (we never debited
    // the quota for them).
    if (remaining <= 0) {
      stats.skipped_quota++;
      await supabase
        .from("policy_renewal_tracking")
        .upsert(
          {
            policy_id: policy.id,
            renewal_status: "not_contacted",
            auto_reminder_skip_reason: "sms_quota_exhausted",
            auto_reminder_skip_at: new Date().toISOString(),
          },
          { onConflict: "policy_id" }
        );
      continue;
    }

    const endDate = new Date(policy.end_date).toLocaleDateString("en-GB", {
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    const policyType = getDisplayLabel(policy.policy_type_parent, policy.policy_type_child);
    const policyPrice = (policy.insurance_price || 0) + (policy.office_commission || 0);
    const policyCommission = policy.office_commission || 0;
    let priceLine = "";
    if (policyPrice > 0) {
      priceLine = ` السعر: ₪${policyPrice.toLocaleString("en-US")}.`;
      if (policyCommission > 0) {
        priceLine += ` عمولة المكتب: ₪${policyCommission.toLocaleString("en-US")}.`;
      }
    }

    const template = reminderType === "1week" ? template1Week : template1Month;
    const baseMessage = template
      .replace(/{client_name}/g, client.full_name || "عميل")
      .replace(/{car_number}/g, car?.car_number || "-")
      .replace(/{end_date}/g, endDate)
      .replace(/{policy_type}/g, policyType)
      .replace(/{price}/g, policyPrice > 0 ? `₪${policyPrice.toLocaleString("en-US")}` : "")
      .replace(/{commission}/g, policyCommission > 0 ? `₪${policyCommission.toLocaleString("en-US")}` : "")
      .replace(/{price_line}/g, priceLine);
    const message = appendSmsFooter(baseMessage, branding);
    const cleanPhone = normalizePhoneFor(smsSettings.provider, client.phone_number);

    try {
      const sendResult = await sendSms(smsSettings, client.phone_number, message);
      if (sendResult.success) {
        const { data: smsLog } = await supabase
          .from("sms_logs")
          .insert({
            branch_id: policy.branch_id || null,
            phone_number: cleanPhone,
            message,
            sms_type: reminderType === "1month" ? "reminder_1month" : "reminder_1week",
            status: "sent",
            client_id: client.id,
            policy_id: policy.id,
            sent_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        await supabase.from("policy_reminders").insert({
          policy_id: policy.id,
          reminder_type: `renewal_${reminderType}`,
          sms_log_id: smsLog?.id || null,
        });

        // Clear any prior skip badge on a successful send.
        await supabase.from("policy_renewal_tracking").upsert(
          {
            policy_id: policy.id,
            renewal_status: "sms_sent",
            reminder_sent_at: new Date().toISOString(),
            auto_reminder_skip_reason: null,
            auto_reminder_skip_at: null,
          },
          { onConflict: "policy_id" }
        );

        await logUsage(supabase, agentId, "sms");
        if (!unlimited) remaining -= 1;
        stats.sent++;
      } else {
        console.error(`[cron-renewal-reminders] agent=${agentId} policy=${policy.id}: SMS failed via ${sendResult.provider}: ${sendResult.error}`);
        stats.errors++;
      }
    } catch (err) {
      console.error(`[cron-renewal-reminders] agent=${agentId} policy=${policy.id} send error:`, err);
      stats.errors++;
    }
  }

  // If we shed any reminders because the agent ran out of SMS budget, drop a
  // single notification on each admin of that agent (de-duped per agent+day
  // by notify_agent_admins so re-running the same day is a no-op).
  if (stats.skipped_quota > 0) {
    const today = new Date().toISOString().split("T")[0];
    try {
      await supabase.rpc("notify_agent_admins", {
        p_agent_id: agentId,
        p_type: "sms_quota",
        p_title: "تم تخطّي تنبيهات تجديد بسبب انتهاء الحد الشهري للرسائل",
        p_message: `لم يتم إرسال ${stats.skipped_quota} تنبيه تجديد لأن الحد الشهري للرسائل النصية انتهى. قم بترقية الباقة أو شراء رصيد إضافي.`,
        p_link: "/subscription",
        p_entity_type: "renewal_quota_exhausted",
        p_dedup_key: `${agentId}:${today}`,
      });
    } catch (e: any) {
      // The RPC is shipped in the same migration as the skip columns. If we
      // ever hit a deployment where the function exists but the RPC doesn't,
      // just log — the per-policy skip badges on the renewals page still tell
      // the admin what happened.
      console.warn(`[cron-renewal-reminders] agent=${agentId}: notify_agent_admins RPC failed: ${e?.message ?? e}`);
    }
  }

  console.log(`[cron-renewal-reminders] agent=${agentId}: sent=${stats.sent} quota_skipped=${stats.skipped_quota} other_skipped=${stats.skipped_other} errors=${stats.errors}`);
  return stats;
}
