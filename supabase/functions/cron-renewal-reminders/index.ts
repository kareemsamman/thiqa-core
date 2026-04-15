import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { getAgentBranding } from "../_shared/agent-branding.ts";
import { appendSmsFooter } from "../_shared/sms-footer.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let sentCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("[cron-renewal-reminders] Starting automatic renewal reminders...");

    // Get agent-level SMS settings row (for templates and feature flags)
    const { data: agentSmsRow } = await supabase
      .from("sms_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    // Get SMS credentials (with Thiqa platform fallback)
    const smsSettings = await resolveSmsSettings(supabase, agentSmsRow?.agent_id);
    const branding = await getAgentBranding(supabase, agentSmsRow?.agent_id || null);

    if (!smsSettings) {
      console.log("[cron-renewal-reminders] SMS service disabled or not configured");
      return new Response(
        JSON.stringify({ success: false, message: "SMS service disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!agentSmsRow?.enable_auto_renewal_reminders) {
      console.log("[cron-renewal-reminders] Auto renewal reminders disabled");
      return new Response(
        JSON.stringify({ success: false, message: "Auto renewal reminders disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const template1Month = agentSmsRow?.reminder_1month_template ||
      "مرحباً {client_name}، نذكرك بأن وثيقة التأمين لسيارتك ({car_number}) ستنتهي بعد شهر تقريباً في تاريخ {end_date}.{price_line} يرجى التواصل معنا للتجديد.";
    const template1Week = agentSmsRow?.reminder_1week_template ||
      "مرحباً {client_name}، تنبيه عاجل: وثيقة التأمين لسيارتك ({car_number}) ستنتهي خلال أسبوع في تاريخ {end_date}.{price_line} يرجى التجديد قبل الانتهاء.";

    const cooldownDays = agentSmsRow?.renewal_reminder_cooldown_days || 7;
    const cooldownDate = new Date();
    cooldownDate.setDate(cooldownDate.getDate() - cooldownDays);

    // Find policies expiring in ~30 days (28-32 days) for 1 month reminder
    const today = new Date();
    const oneMonthFromNow = new Date(today);
    oneMonthFromNow.setDate(today.getDate() + 30);
    const oneMonthMin = new Date(today);
    oneMonthMin.setDate(today.getDate() + 28);
    const oneMonthMax = new Date(today);
    oneMonthMax.setDate(today.getDate() + 32);

    // Find policies expiring in ~7 days (5-9 days) for 1 week reminder
    const oneWeekMin = new Date(today);
    oneWeekMin.setDate(today.getDate() + 5);
    const oneWeekMax = new Date(today);
    oneWeekMax.setDate(today.getDate() + 9);

    // Fetch policies for 1 month reminder
    const { data: policiesOneMonth } = await supabase
      .from("policies")
      .select(`
        id,
        end_date,
        policy_type_parent,
        policy_type_child,
        insurance_price,
        office_commission,
        client:clients(id, full_name, phone_number),
        car:cars(car_number)
      `)
      .gte("end_date", oneMonthMin.toISOString().split('T')[0])
      .lte("end_date", oneMonthMax.toISOString().split('T')[0])
      .eq("cancelled", false)
      .eq("transferred", false)
      .is("deleted_at", null);

    // Fetch policies for 1 week reminder
    const { data: policiesOneWeek } = await supabase
      .from("policies")
      .select(`
        id,
        end_date,
        policy_type_parent,
        policy_type_child,
        insurance_price,
        office_commission,
        client:clients(id, full_name, phone_number),
        car:cars(car_number)
      `)
      .gte("end_date", oneWeekMin.toISOString().split('T')[0])
      .lte("end_date", oneWeekMax.toISOString().split('T')[0])
      .eq("cancelled", false)
      .eq("transferred", false)
      .is("deleted_at", null);

    console.log(`[cron-renewal-reminders] Found ${policiesOneMonth?.length || 0} policies for 1-month reminder`);
    console.log(`[cron-renewal-reminders] Found ${policiesOneWeek?.length || 0} policies for 1-week reminder`);

    // Helper to send SMS
    const sendSms = async (
      policy: any, 
      template: string, 
      reminderType: '1month' | '1week'
    ): Promise<boolean> => {
      const client = policy.client;
      const car = policy.car;

      if (!client?.phone_number) {
        console.log(`[cron-renewal-reminders] Policy ${policy.id}: No phone number, skipping`);
        skipCount++;
        return false;
      }

      // Check cooldown - look for recent reminders of this type
      const { data: existingReminder } = await supabase
        .from("policy_reminders")
        .select("id, sent_at")
        .eq("policy_id", policy.id)
        .eq("reminder_type", `renewal_${reminderType}`)
        .gte("sent_at", cooldownDate.toISOString())
        .maybeSingle();

      if (existingReminder) {
        console.log(`[cron-renewal-reminders] Policy ${policy.id}: Already sent ${reminderType} reminder recently, skipping`);
        skipCount++;
        return false;
      }

      // Build message
      const endDate = new Date(policy.end_date).toLocaleDateString('en-GB', {
        year: 'numeric', month: '2-digit', day: '2-digit'
      });
      const policyType = getDisplayLabel(policy.policy_type_parent, policy.policy_type_child);

      // Price / commission line — only rendered when there's something to
      // show, so agents who don't use {price_line} or {commission} don't
      // see stray punctuation in their messages.
      const policyPrice = (policy.insurance_price || 0) + (policy.office_commission || 0);
      const policyCommission = policy.office_commission || 0;
      let priceLine = '';
      if (policyPrice > 0) {
        priceLine = ` السعر: ₪${policyPrice.toLocaleString('en-US')}.`;
        if (policyCommission > 0) {
          priceLine += ` عمولة المكتب: ₪${policyCommission.toLocaleString('en-US')}.`;
        }
      }

      const baseMessage = template
        .replace(/{client_name}/g, client.full_name || 'عميل')
        .replace(/{car_number}/g, car?.car_number || '-')
        .replace(/{end_date}/g, endDate)
        .replace(/{policy_type}/g, policyType)
        .replace(/{price}/g, policyPrice > 0 ? `₪${policyPrice.toLocaleString('en-US')}` : '')
        .replace(/{commission}/g, policyCommission > 0 ? `₪${policyCommission.toLocaleString('en-US')}` : '')
        .replace(/{price_line}/g, priceLine);
      const message = appendSmsFooter(baseMessage, branding);

      // Normalize phone
      let cleanPhone = client.phone_number.replace(/[^0-9]/g, "");
      if (cleanPhone.startsWith("972")) {
        cleanPhone = "0" + cleanPhone.substring(3);
      }

      // Send SMS via 019sms
      const escapeXml = (value: string) =>
        value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;").replace(/'/g, "&apos;");

      const dlr = crypto.randomUUID();
      const smsXml = `<?xml version="1.0" encoding="UTF-8"?>` +
        `<sms>` +
        `<user><username>${escapeXml(smsSettings.sms_user || "")}</username></user>` +
        `<source>${escapeXml(smsSettings.sms_source || "")}</source>` +
        `<destinations><phone id="${dlr}">${escapeXml(cleanPhone)}</phone></destinations>` +
        `<message>${escapeXml(message)}</message>` +
        `</sms>`;

      try {
        const smsResponse = await fetch("https://019sms.co.il/api", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${smsSettings.sms_token}`,
            "Content-Type": "application/xml; charset=utf-8",
          },
          body: smsXml,
        });

        const smsResult = await smsResponse.text();
        const extractTag = (xml: string, tag: string) => {
          const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
          return match?.[1]?.trim() ?? null;
        };
        const status = extractTag(smsResult, "status");

        if (status === "0") {
          // Log SMS
          const { data: smsLog } = await supabase
            .from("sms_logs")
            .insert({
              branch_id: policy.branch_id || null,
              phone_number: cleanPhone,
              message: message,
              sms_type: reminderType === '1month' ? 'reminder_1month' : 'reminder_1week',
              status: 'sent',
              client_id: client.id,
              policy_id: policy.id,
              sent_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          // Record reminder sent
          await supabase
            .from("policy_reminders")
            .insert({
              policy_id: policy.id,
              reminder_type: `renewal_${reminderType}`,
              sms_log_id: smsLog?.id || null,
            });

          // Update renewal tracking
          await supabase
            .from("policy_renewal_tracking")
            .upsert({
              policy_id: policy.id,
              renewal_status: 'sms_sent',
              reminder_sent_at: new Date().toISOString(),
            }, { onConflict: 'policy_id' });

          console.log(`[cron-renewal-reminders] Sent ${reminderType} reminder to ${cleanPhone} for policy ${policy.id}`);
          sentCount++;
          return true;
        } else {
          console.error(`[cron-renewal-reminders] SMS failed for policy ${policy.id}: status=${status}`);
          errorCount++;
          return false;
        }
      } catch (err) {
        console.error(`[cron-renewal-reminders] Error sending SMS for policy ${policy.id}:`, err);
        errorCount++;
        return false;
      }
    };

    // Process 1 month reminders
    if (agentSmsRow?.renewal_reminder_1month_enabled !== false) {
      for (const policy of (policiesOneMonth || [])) {
        await sendSms(policy, template1Month, '1month');
      }
    }

    // Process 1 week reminders  
    if (agentSmsRow?.renewal_reminder_1week_enabled !== false) {
      for (const policy of (policiesOneWeek || [])) {
        await sendSms(policy, template1Week, '1week');
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[cron-renewal-reminders] Completed in ${duration}ms: sent=${sentCount}, skipped=${skipCount}, errors=${errorCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        sent_count: sentCount,
        skip_count: skipCount,
        error_count: errorCount,
        duration_ms: duration,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    // Log full error details server-side for debugging
    console.error("[cron-renewal-reminders] Fatal error:", error);
    
    // Return generic error message to client - never expose internal details
    return new Response(
      JSON.stringify({ error: "An error occurred during processing. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
