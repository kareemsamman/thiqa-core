import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import { checkUsageLimit, logUsage } from "../_shared/usage-limits.ts";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { sendSms } from "../_shared/sms-sender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SmsStartRequest {
  phone: string;
}

// Generate a 4-digit OTP
function generateOTP(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 10000).padStart(4, '0');
}

// Hash OTP for storage
async function hashOTP(otp: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(otp);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Normalize phone for our DB lookup (Israeli local format).
// The SMS provider helper normalizes again to its own provider-specific
// format right before send.
function normalizePhone(phone: string): string {
  let normalized = phone.replace(/\D/g, '');
  if (normalized.startsWith('972')) {
    normalized = '0' + normalized.slice(3);
  }
  if (normalized.startsWith('+972')) {
    normalized = '0' + normalized.slice(4);
  }
  if (!normalized.startsWith('0') && normalized.length === 9) {
    normalized = '0' + normalized;
  }
  return normalized;
}

// Generate a random password
function generatePassword(): string {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// Pre-initialize Supabase client at module level to avoid cold start delay
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone }: SmsStartRequest = await req.json();

    if (!phone) {
      return new Response(
        JSON.stringify({ success: false, error: "رقم الهاتف مطلوب" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const normalizedPhone = normalizePhone(phone);

    if (normalizedPhone.length < 9 || normalizedPhone.length > 15) {
      return new Response(
        JSON.stringify({ success: false, error: "رقم الهاتف غير صالح" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // Fetch profile and rate limit in parallel first.
    //
    // Multiple profiles can share a phone number when the same number
    // got registered via the SMS-registration flow before being claimed
    // by an email/password user. `.single()` on that scenario throws
    // and silently dropped the request into the "create new pending"
    // branch, which broke OTP-2FA. Pull all matches and prefer the
    // active + agent-linked one, falling back to active, then pending.
    const [profilesResult, rateLimitResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, status, phone, full_name, agent_id")
        .eq("phone", normalizedPhone)
        .order("created_at", { ascending: true }),
      supabase
        .from("otp_codes")
        .select("id")
        .eq("identifier", normalizedPhone)
        .eq("channel", "sms")
        .gte("created_at", tenMinutesAgo)
    ]);

    const profiles = (profilesResult.data ?? []) as Array<{
      id: string; status: string; phone: string; full_name: string | null; agent_id: string | null;
    }>;
    const existingProfile =
      profiles.find((p) => p.status === "active" && p.agent_id) ??
      profiles.find((p) => p.status === "active") ??
      profiles.find((p) => p.status === "pending") ??
      null;
    const { data: recentOtps } = rateLimitResult;

    // Case 1: Profile exists
    if (existingProfile) {
      // Check if blocked
      if (existingProfile.status === "blocked") {
        return new Response(
          JSON.stringify({ success: false, error: "تم حظر هذا الحساب. تواصل مع المدير." }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Check if pending approval
      if (existingProfile.status === "pending") {
        console.log("Profile is pending approval:", normalizedPhone);
        return new Response(
          JSON.stringify({ 
            success: true, 
            pending: true,
            message: "طلبك قيد المراجعة. سيتم إبلاغك عند الموافقة." 
          }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // User is active - proceed with OTP
      console.log("Profile found and active, sending OTP:", normalizedPhone);
    } else {
      // Case 2: No profile - create new pending registration
      console.log("No profile found, creating pending registration:", normalizedPhone);

      const fakeEmail = `${normalizedPhone}@phone.local`;
      const tempPassword = generatePassword();

      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: fakeEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          phone: normalizedPhone,
          registration_method: 'sms'
        }
      });

      if (authError) {
        if (authError.message?.includes('already') || authError.message?.includes('duplicate')) {
          console.log("Auth user already exists for phone:", normalizedPhone);
          return new Response(
            JSON.stringify({ 
              success: true, 
              pending: true,
              message: "طلبك قيد المراجعة. سيتم إبلاغك عند الموافقة." 
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
        console.error("Auth user creation error:", authError);
        return new Response(
          JSON.stringify({ success: false, error: "فشل في إنشاء الحساب" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const { error: profileUpsertError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: authUser.user.id,
            email: fakeEmail,
            full_name: `مستخدم ${normalizedPhone}`,
            phone: normalizedPhone,
            status: "pending",
          },
          { onConflict: "id" }
        );

      if (profileUpsertError) {
        console.error("Profile creation error:", profileUpsertError);
        await supabase.auth.admin.deleteUser(authUser.user.id);
        return new Response(
          JSON.stringify({ success: false, error: "فشل في إنشاء الملف الشخصي" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Get IP and User-Agent from request
      const ip_address = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
        || req.headers.get("cf-connecting-ip") 
        || req.headers.get("x-real-ip")
        || null;
      const user_agent = req.headers.get("user-agent") || null;

      // Log in background (don't await)
      supabase.from("login_attempts").insert({
        email: fakeEmail,
        identifier: normalizedPhone,
        method: "sms_registration",
        success: true,
        user_id: authUser.user.id,
        ip_address,
        user_agent,
      });

      console.log("Created pending profile for phone:", normalizedPhone);

      return new Response(
        JSON.stringify({ 
          success: true, 
          pending: true,
          message: "تم تسجيل طلبك بنجاح. سيتم إبلاغك عند موافقة المدير." 
        }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Rate limit check (already fetched in parallel)
    if (recentOtps && recentOtps.length >= 3) {
      return new Response(
        JSON.stringify({ success: false, error: "تم تجاوز الحد الأقصى للمحاولات. حاول لاحقاً." }),
        { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Fetch auth settings using the profile's agent_id
    const agentId = existingProfile!.agent_id;
    let authSettingsQuery = supabase.from("auth_settings").select("*");
    if (agentId) {
      authSettingsQuery = authSettingsQuery.eq("agent_id", agentId);
    }
    const { data: authSettings, error: settingsError } = await authSettingsQuery.limit(1).single();

    // Auth settings check
    if (settingsError || !authSettings) {
      console.error("Auth settings error for agent:", agentId, settingsError);
      return new Response(
        JSON.stringify({ success: false, error: "خطأ في إعدادات المصادقة. يرجى التواصل مع المدير." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!authSettings.sms_otp_enabled) {
      return new Response(
        JSON.stringify({ success: false, error: "تسجيل الدخول بالرسائل النصية غير مفعل. يرجى التواصل مع المدير لتفعيله." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Resolve which SMS provider + creds to use. Priority:
    //   1. agent's sms_settings (HTD or 019, plus sender name)
    //   2. platform defaults (default_sms_provider + creds)
    // If neither path produces complete creds for the chosen
    // provider, resolveSmsSettings returns null.
    if (!agentId) {
      return new Response(
        JSON.stringify({ success: false, error: "لا يمكن تحديد الوكالة لهذا الحساب." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    const smsSettings = await resolveSmsSettings(supabase, agentId);
    if (!smsSettings) {
      return new Response(
        JSON.stringify({ success: false, error: "إعدادات الرسائل النصية غير مكتملة. يرجى التواصل مع المدير." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // SMS quota gate: each OTP send consumes one SMS from the agent's
    // monthly quota. If the agent is out of quota the client is told
    // to fall back to password login instead of OTP — Login.tsx
    // handles `error_code: "sms_quota_exhausted"` specifically.
    const quota = await checkUsageLimit(supabase, agentId, "sms");
    if (!quota.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "sms_quota_exhausted",
          error: "تم استنفاد رصيد الرسائل النصية. يرجى استخدام كلمة المرور.",
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate OTP
    const otp = generateOTP();
    const otpHash = await hashOTP(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Store OTP
    const { error: insertError } = await supabase
      .from("otp_codes")
      .insert({
        identifier: normalizedPhone,
        channel: "sms",
        otp_hash: otpHash,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("OTP insert error:", insertError);
      return new Response(
        JSON.stringify({ success: false, error: "فشل في إنشاء رمز التحقق" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Prepare SMS content
    const message = (authSettings.sms_message_template || "رمز التحقق الخاص بك هو: {code}")
      .replace(/{code}/g, otp);

    // Send SMS via the unified sender (HTD or 019 — picked by
    // resolveSmsSettings above). The helper handles provider-specific
    // phone normalization (HTD wants 972…, 019 wants 0…).
    const smsResult = await sendSms(smsSettings, normalizedPhone, message);

    if (!smsResult.success) {
      console.error("SMS send failed:", smsResult.error, "provider:", smsResult.provider);
      return new Response(
        JSON.stringify({ success: false, error: "فشل في إرسال الرسالة النصية" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Each successful OTP send counts +1 against the agent's monthly
    // SMS quota. Fire-and-forget — if bookkeeping fails it must not
    // block the user from receiving the code they're already getting.
    logUsage(supabase, agentId, "sms").catch((err) =>
      console.warn("[auth-sms-start] logUsage failed:", err),
    );

    // Get IP and User-Agent from request for OTP
    const ip_address_otp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
      || req.headers.get("cf-connecting-ip") 
      || req.headers.get("x-real-ip")
      || null;
    const user_agent_otp = req.headers.get("user-agent") || null;

    // Log in background (don't await)
    supabase.from("login_attempts").insert({
      email: normalizedPhone,
      identifier: normalizedPhone,
      method: "sms_otp",
      success: false,
      ip_address: ip_address_otp,
      user_agent: user_agent_otp,
    });

    return new Response(
      JSON.stringify({ success: true, message: "تم إرسال رمز التحقق" }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error) {
    console.error("Error in auth-sms-start:", error);
    return new Response(
      JSON.stringify({ success: false, error: "حدث خطأ غير متوقع" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
