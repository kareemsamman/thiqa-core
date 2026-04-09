import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * SMS phone verification for agent onboarding.
 *
 * Actions:
 *   save_settings  — save SMS credentials (user, token, source)
 *   start_verify   — send a test SMS to the source number to verify it works
 *   check_status   — return current verification status
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Get agent_id for this user
    const { data: agentUser } = await adminClient
      .from("agent_users")
      .select("agent_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!agentUser?.agent_id) throw new Error("لا يوجد وكيل مرتبط بهذا الحساب");

    const agentId = agentUser.agent_id;
    const body = await req.json();
    const { action } = body;

    // ═══ SAVE SETTINGS ═══
    // ═══ SAVE ALL SETTINGS (Thiqa admin) ═══
    if (action === "save_settings") {
      const { sms_user, sms_token, sms_source } = body;

      const { data: existing } = await adminClient
        .from("sms_settings")
        .select("id")
        .eq("agent_id", agentId)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await adminClient.from("sms_settings").update({
          sms_user: sms_user || null,
          sms_token: sms_token || null,
          sms_source: sms_source || null,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await adminClient.from("sms_settings").insert({
          agent_id: agentId,
          provider: "019sms",
          sms_user: sms_user || null,
          sms_token: sms_token || null,
          sms_source: sms_source || null,
          is_enabled: false,
          sms_verification_status: "not_verified",
        });
        if (error) throw error;
      }

      return jsonResponse({ success: true, message: "تم حفظ الإعدادات" });
    }

    // ═══ SAVE SOURCE ONLY (Agent self-service) ═══
    if (action === "save_source") {
      const { sms_source } = body;
      if (!sms_source) throw new Error("يرجى إدخال رقم المصدر");

      const { data: existing } = await adminClient
        .from("sms_settings")
        .select("id")
        .eq("agent_id", agentId)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await adminClient.from("sms_settings").update({
          sms_source,
          sms_verification_status: "not_verified",
          sms_verification_message: null,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await adminClient.from("sms_settings").insert({
          agent_id: agentId,
          provider: "019sms",
          sms_source,
          is_enabled: false,
          sms_verification_status: "not_verified",
        });
        if (error) throw error;
      }

      return jsonResponse({ success: true, message: "تم حفظ رقم المصدر" });
    }

    // ═══ START VERIFICATION ═══
    if (action === "start_verify") {
      // Get current settings
      const { data: settings } = await adminClient
        .from("sms_settings")
        .select("*")
        .eq("agent_id", agentId)
        .maybeSingle();

      if (!settings) throw new Error("يرجى حفظ إعدادات SMS أولاً");
      if (!settings.sms_user || !settings.sms_token || !settings.sms_source) {
        throw new Error("يرجى تعبئة جميع حقول SMS (اسم المستخدم، التوكن، رقم المصدر)");
      }

      // Update status to pending
      await adminClient.from("sms_settings").update({
        sms_verification_status: "pending",
        sms_verification_message: "جاري إرسال رسالة التحقق...",
        updated_at: new Date().toISOString(),
      }).eq("id", settings.id);

      // Send a test SMS via 019
      const testMessage = `رمز التحقق من ثقة: ${Math.floor(1000 + Math.random() * 9000)}. هذه رسالة اختبار لتفعيل خدمة SMS.`;

      const escapeXml = (v: string) =>
        v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

      // Normalize phone
      let cleanPhone = settings.sms_source.replace(/[^0-9]/g, "");
      if (cleanPhone.startsWith("972")) cleanPhone = "0" + cleanPhone.substring(3);

      const dlr = crypto.randomUUID();
      const smsXml =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<sms>` +
        `<user><username>${escapeXml(settings.sms_user)}</username></user>` +
        `<source>${escapeXml(settings.sms_source)}</source>` +
        `<destinations><phone id="${dlr}">${escapeXml(cleanPhone)}</phone></destinations>` +
        `<message>${escapeXml(testMessage)}</message>` +
        `</sms>`;

      console.log(`[sms-verify-phone] Sending test SMS to ${cleanPhone}`);

      const smsResponse = await fetch("https://019sms.co.il/api", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.sms_token}`,
          "Content-Type": "application/xml; charset=utf-8",
        },
        body: smsXml,
      });

      const responseText = await smsResponse.text();
      console.log(`[sms-verify-phone] 019 response: ${responseText}`);

      // Parse response — 019 returns XML with status
      const statusMatch = responseText.match(/<status>(\d+)<\/status>/);
      const statusCode = statusMatch ? parseInt(statusMatch[1]) : -1;

      if (statusCode === 0 || smsResponse.ok) {
        // Success — mark as verified
        await adminClient.from("sms_settings").update({
          sms_verification_status: "verified",
          sms_verification_message: "تم التحقق بنجاح — الرقم جاهز لإرسال الرسائل",
          sms_verified_at: new Date().toISOString(),
          is_enabled: true,
          updated_at: new Date().toISOString(),
        }).eq("id", settings.id);

        return jsonResponse({
          success: true,
          status: "verified",
          message: "تم إرسال رسالة التحقق بنجاح! تم تفعيل خدمة SMS.",
        });
      } else {
        // Failed
        const errorMsg = responseText.match(/<message>(.*?)<\/message>/)?.[1] || responseText.slice(0, 200);
        await adminClient.from("sms_settings").update({
          sms_verification_status: "failed",
          sms_verification_message: `فشل: ${errorMsg}`,
          updated_at: new Date().toISOString(),
        }).eq("id", settings.id);

        return jsonResponse({
          success: false,
          status: "failed",
          message: `فشل إرسال الرسالة: ${errorMsg}`,
        });
      }
    }

    // ═══ CHECK STATUS ═══
    if (action === "check_status") {
      const { data: settings } = await adminClient
        .from("sms_settings")
        .select("sms_user, sms_token, sms_source, is_enabled, sms_verification_status, sms_verification_message, sms_verified_at")
        .eq("agent_id", agentId)
        .maybeSingle();

      return jsonResponse({
        success: true,
        settings: settings || {
          sms_user: null,
          sms_token: null,
          sms_source: null,
          is_enabled: false,
          sms_verification_status: "not_verified",
          sms_verification_message: null,
          sms_verified_at: null,
        },
      });
    }

    throw new Error("Invalid action");
  } catch (error: any) {
    console.error("[sms-verify-phone] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function jsonResponse(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
