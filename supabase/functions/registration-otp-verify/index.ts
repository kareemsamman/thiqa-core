import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function hashOTP(otp: string): Promise<string> {
  const data = new TextEncoder().encode(otp);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { email, code, skip } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail) throw new Error("البريد الإلكتروني مطلوب");

    // If skip mode (auto-confirm without OTP)
    if (skip === true) {
      const { data: skipSetting, error: skipSettingError } = await adminClient
        .from("thiqa_platform_settings")
        .select("setting_value")
        .eq("setting_key", "skip_email_verification")
        .maybeSingle();

      if (skipSettingError) {
        throw new Error("تعذر قراءة إعدادات المنصة");
      }

      if (skipSetting?.setting_value !== "true") {
        throw new Error("تخطي تفعيل البريد الإلكتروني غير مفعل");
      }

      const { data: profile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("email", normalizedEmail)
        .single();

      if (!profile) throw new Error("لم يتم العثور على الحساب.");

      await adminClient.auth.admin.updateUserById(profile.id, { email_confirm: true });
      await adminClient.from("profiles").update({ email_confirmed: true }).eq("id", profile.id);

      return new Response(
        JSON.stringify({ success: true, message: "تم تفعيل الحساب بنجاح" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!code) throw new Error("الرمز مطلوب");
    const codeHash = await hashOTP(String(code).trim());

    // Find valid OTP
    const { data: otpRecord, error: otpError } = await adminClient
      .from("otp_codes")
      .select("*")
      .eq("identifier", normalizedEmail)
      .eq("channel", "registration")
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (otpError || !otpRecord) {
      throw new Error("لا يوجد رمز صالح. اطلب رمزاً جديداً.");
    }

    if (otpRecord.attempts >= otpRecord.max_attempts) {
      await adminClient.from("otp_codes").update({ used_at: new Date().toISOString() }).eq("id", otpRecord.id);
      throw new Error("تم تجاوز الحد الأقصى للمحاولات. اطلب رمزاً جديداً.");
    }

    // Increment attempts
    await adminClient.from("otp_codes").update({ attempts: otpRecord.attempts + 1 }).eq("id", otpRecord.id);

    if (otpRecord.otp_hash !== codeHash) {
      const remaining = otpRecord.max_attempts - otpRecord.attempts - 1;
      throw new Error(`رمز التحقق غير صحيح. ${remaining} محاولات متبقية.`);
    }

    // Mark OTP as used
    await adminClient.from("otp_codes").update({ used_at: new Date().toISOString() }).eq("id", otpRecord.id);

    // Confirm the user's email in auth
    // Find the profile first
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (!profile) {
      throw new Error("لم يتم العثور على الحساب.");
    }

    // Confirm email in auth system
    const { error: confirmError } = await adminClient.auth.admin.updateUserById(profile.id, {
      email_confirm: true,
    });

    if (confirmError) {
      console.error("Email confirm error:", confirmError);
      throw new Error("فشل في تأكيد البريد الإلكتروني");
    }

    // Update profile to mark as email confirmed
    await adminClient.from("profiles").update({ email_confirmed: true }).eq("id", profile.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "تم تأكيد البريد الإلكتروني بنجاح! يمكنك الآن تسجيل الدخول.",
        user_id: profile.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Registration OTP verify error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "حدث خطأ غير متوقع" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
