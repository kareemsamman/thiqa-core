/**
 * change-agent-plan
 * =================
 * Fired when an agent confirms a plan switch from the upgrade popup or the
 * subscription page. Responsibilities:
 *   1. Validate the request (authenticated user, privacy accepted, target
 *      plan exists and is active).
 *   2. Decide switch_mode: a trial agent's selection writes to
 *      `agents.pending_plan` so the switch happens at trial end; a paid
 *      agent's selection updates `agents.plan` + `monthly_price` immediately.
 *   3. Insert a row into `plan_change_events` for audit + the /thiqa/plan-changes
 *      admin view.
 *   4. Email support@getthiqa.com with the change details so the Thiqa
 *      operations team sees every switch in their inbox too.
 *
 * Writes are scoped to the caller's own agent via the JWT — no agent_id in
 * the request body, so a compromised client can't rewrite another agent's plan.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "https://esm.sh/nodemailer@6.9.16";
import { buildEmailHtml } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPPORT_EMAIL = "support@getthiqa.com";

async function getSmtp(adminClient: any) {
  const { data } = await adminClient
    .from("thiqa_platform_settings")
    .select("setting_key, setting_value")
    .in("setting_key", ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_sender_name"]);
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { map[r.setting_key] = r.setting_value || ""; });
  return {
    host: map.smtp_host || Deno.env.get("THIQA_SMTP_HOST") || "smtp.hostinger.com",
    port: parseInt(map.smtp_port || Deno.env.get("THIQA_SMTP_PORT") || "465"),
    user: map.smtp_user || Deno.env.get("THIQA_SMTP_USER") || "",
    password: map.smtp_password || Deno.env.get("THIQA_SMTP_PASSWORD") || "",
    senderName: map.smtp_sender_name || "Thiqa Insurance",
  };
}

function fmtPrice(n: number): string {
  return `₪${(Number(n) || 0).toLocaleString("en")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const targetPlanKey: string = body.target_plan_key;
    const privacyAccepted: boolean = body.privacy_accepted === true;
    const notes: string | null = body.notes ?? null;
    const rawCycle = String(body.billing_cycle ?? "monthly").toLowerCase();
    const billingCycle: "monthly" | "yearly" = rawCycle === "yearly" ? "yearly" : "monthly";
    if (!targetPlanKey) throw new Error("target_plan_key مطلوب");
    if (!privacyAccepted) throw new Error("يجب الموافقة على سياسة الخصوصية");

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Resolve the caller's agent via the agent_users link.
    const { data: agentUser } = await adminClient
      .from("agent_users")
      .select("agent_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!agentUser?.agent_id) throw new Error("لم يتم العثور على الوكيل");

    const { data: agent } = await adminClient
      .from("agents")
      .select("id, name, name_ar, email, plan, monthly_price, subscription_status, trial_ends_at, pending_plan, billing_cycle")
      .eq("id", agentUser.agent_id)
      .single();
    if (!agent) throw new Error("لم يتم العثور على بيانات الوكيل");

    const { data: targetPlan } = await adminClient
      .from("subscription_plans")
      .select("plan_key, name, name_ar, monthly_price, yearly_price, users_limit, branches_limit, policies_limit, sms_limit, marketing_sms_limit, ai_limit")
      .eq("plan_key", targetPlanKey)
      .eq("is_active", true)
      .maybeSingle();
    if (!targetPlan) throw new Error("الحزمة المحددة غير متاحة");

    // Resolve the current plan (for audit + email comparison).
    const { data: currentPlan } = await adminClient
      .from("subscription_plans")
      .select("plan_key, name, name_ar, monthly_price")
      .eq("plan_key", agent.plan)
      .maybeSingle();

    // "Looks like a trial" semantically — covers status='trial' and the
    // legacy active+0price shape. But only defer the switch to trial-end
    // when the trial is *actually still running*. An agent whose
    // trial_ends_at is already in the past landed on /subscription-
    // expired and is asking to be reactivated NOW, so writing
    // pending_plan would do nothing (the sync trigger only fires on
    // plan UPDATE) and they'd stay locked out.
    const looksLikeTrial = agent.subscription_status === "trial" ||
      (Number(agent.monthly_price) === 0 && agent.subscription_status === "active");
    const trialEnd = agent.trial_ends_at ? new Date(agent.trial_ends_at) : null;
    const trialStillRunning = trialEnd ? trialEnd > new Date() : false;
    const isTrial = looksLikeTrial && trialStillRunning;
    const switchMode: "immediate" | "after_trial" = isTrial ? "after_trial" : "immediate";

    // Yearly pricing falls back to monthly_price × 12 if the plan
    // doesn't declare a yearly_price — that way a yearly toggle on
    // a legacy plan still charges a predictable amount.
    const yearlyPrice =
      targetPlan.yearly_price != null
        ? Number(targetPlan.yearly_price)
        : Number(targetPlan.monthly_price) * 12;
    const effectivePrice =
      billingCycle === "yearly" ? yearlyPrice / 12 : Number(targetPlan.monthly_price);

    const currentCycle = (agent.billing_cycle as "monthly" | "yearly") ?? "monthly";
    const sameTarget =
      agent.plan === targetPlan.plan_key && currentCycle === billingCycle;

    // "Already on this plan" guard — only fire when the agent has a
    // genuinely active paid subscription. Expired/paused/cancelled
    // agents picking the same plan are renewing, not no-op'ing, and
    // need to fall through to the immediate update path so the trigger
    // re-activates them.
    const isCurrentlyPaying =
      agent.subscription_status === "active" && Number(agent.monthly_price ?? 0) > 0;
    if (isCurrentlyPaying && sameTarget) {
      throw new Error("أنت بالفعل على هذه الحزمة");
    }
    if (isTrial && agent.pending_plan === targetPlan.plan_key && currentCycle === billingCycle) {
      throw new Error("هذه الحزمة مُختارة بالفعل كخطة ما بعد التجربة");
    }

    // Apply the switch. `monthly_price` stays stored as the monthly
    // rate even on yearly plans so the per-month displays elsewhere
    // (AgentPlanOverview etc.) keep working; yearly subscribers pay
    // monthly_price × 12 upfront at renewal instead.
    if (switchMode === "after_trial") {
      const { error: updErr } = await adminClient
        .from("agents")
        .update({
          pending_plan: targetPlan.plan_key,
          billing_cycle: billingCycle,
        })
        .eq("id", agent.id);
      if (updErr) throw new Error(updErr.message);
    } else {
      const { error: updErr } = await adminClient
        .from("agents")
        .update({
          plan: targetPlan.plan_key,
          monthly_price: effectivePrice,
          billing_cycle: billingCycle,
          pending_plan: null,
        })
        .eq("id", agent.id);
      if (updErr) throw new Error(updErr.message);
    }

    // Log first so a failing email send never blocks the audit trail.
    const { data: logRow } = await adminClient
      .from("plan_change_events")
      .insert({
        agent_id: agent.id,
        changed_by_user: user.id,
        from_plan: agent.plan,
        to_plan: targetPlan.plan_key,
        from_price: Number(agent.monthly_price ?? 0),
        to_price: Number(targetPlan.monthly_price ?? 0),
        switch_mode: switchMode,
        privacy_accepted: true,
        notes,
      })
      .select("id")
      .single();

    // Email support.
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const smtp = await getSmtp(adminClient);
      if (!smtp.user || !smtp.password) throw new Error("SMTP not configured");

      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.password },
      });

      const modeLabel = switchMode === "after_trial"
        ? "تفعيل بعد انتهاء الفترة التجريبية"
        : "تفعيل فوري";

      const cycleLabelAr = billingCycle === "yearly" ? "سنوي" : "شهري";
      const newTotalAr =
        billingCycle === "yearly"
          ? `${fmtPrice(yearlyPrice)} / سنة`
          : `${fmtPrice(Number(targetPlan.monthly_price))} / شهر`;

      const rows = [
        ["الوكالة", `${agent.name_ar || agent.name} (${agent.email})`],
        ["من", `${currentPlan?.name_ar || currentPlan?.name || agent.plan} — ${fmtPrice(Number(agent.monthly_price ?? 0))} / شهر (${currentCycle === "yearly" ? "سنوي" : "شهري"})`],
        ["إلى", `${targetPlan.name_ar || targetPlan.name} — ${newTotalAr}`],
        ["دورة الفوترة", cycleLabelAr],
        ["نوع التحويل", modeLabel],
        ["الحالة الحالية", agent.subscription_status],
        ["سياسة الخصوصية", "تمت الموافقة"],
      ];

      const tableHtml = `
        <h2 style="margin:0 0 16px;color:#111;font-size:20px;font-weight:700;">تغيير حزمة وكيل</h2>
        <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.7;">
          قام وكيل بتأكيد تغيير حزمته الآن. تفاصيل التحويل:
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;text-align:right;direction:rtl;">
          ${rows.map(([k, v]) => `
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;color:#777;width:35%;">${k}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;color:#111;font-weight:600;">${v}</td>
            </tr>
          `).join("")}
        </table>
        <p style="margin:24px 0 0;color:#888;font-size:12px;line-height:1.7;">
          معرّف الحدث: ${logRow?.id ?? "—"}
        </p>
      `;

      await transporter.sendMail({
        from: `"${smtp.senderName}" <${smtp.user}>`,
        to: SUPPORT_EMAIL,
        subject: `[Thiqa] تغيير حزمة: ${agent.name_ar || agent.name} → ${targetPlan.name_ar || targetPlan.name}`,
        html: buildEmailHtml({ body: tableHtml }),
      });
      emailSent = true;
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
      console.error("[change-agent-plan] email error:", emailError);
    }

    if (logRow?.id) {
      await adminClient
        .from("plan_change_events")
        .update({ email_sent: emailSent, email_error: emailError })
        .eq("id", logRow.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        switch_mode: switchMode,
        new_plan: targetPlan.plan_key,
        event_id: logRow?.id ?? null,
        email_sent: emailSent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع";
    console.error("[change-agent-plan] error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
