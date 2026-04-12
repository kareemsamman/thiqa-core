import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import nodemailer from "npm:nodemailer@6.9.16";
import { buildEmailHtml, otpEmailBody } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailStartRequest {
  email: string;
}

function generateOTP(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, '0');
}

async function hashOTP(otp: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(otp);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email }: EmailStartRequest = await req.json();

    if (!email || !email.includes("@")) {
      return new Response(
        JSON.stringify({ success: false, error: "البريد الإلكتروني غير صالح" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const [profileResult, rateLimitResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, status, email, full_name, agent_id")
        .eq("email", normalizedEmail)
        .single(),
      supabase
        .from("otp_codes")
        .select("id")
        .eq("identifier", normalizedEmail)
        .eq("channel", "email")
        .gte("created_at", tenMinutesAgo)
    ]);

    const { data: existingProfile, error: profileError } = profileResult;
    const { data: recentOtps } = rateLimitResult;

    if (profileError || !existingProfile) {
      console.log("No profile found for email, creating pending profile:", normalizedEmail);

      const requestedName = normalizedEmail.split("@")[0];
      let userId: string | null = null;

      const { data: createdUserRes, error: createUserError } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: { full_name: requestedName },
      });

      if (createUserError) {
        console.error("Auth user create error:", createUserError);
        const { data: usersPage, error: listError } = await supabase.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });

        if (listError) {
          console.error("Auth list users error:", listError);
        } else {
          const found = usersPage?.users?.find(
            (u: any) => (u.email ?? "").toLowerCase() === normalizedEmail
          );
          userId = found?.id ?? null;
        }
      } else {
        userId = createdUserRes.user?.id ?? null;
      }

      if (!userId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "تعذر تسجيل الطلب حالياً. حاول لاحقاً أو تواصل مع المدير.",
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const { error: upsertError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: userId,
            email: normalizedEmail,
            full_name: requestedName,
            status: "pending",
          },
          { onConflict: "id" }
        );

      if (upsertError) {
        console.error("Error upserting pending profile:", upsertError);
        return new Response(
          JSON.stringify({
            success: false,
            error: "تعذر تسجيل الطلب حالياً. حاول لاحقاً أو تواصل مع المدير.",
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const ip_address = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
        || req.headers.get("cf-connecting-ip") 
        || req.headers.get("x-real-ip")
        || null;
      const user_agent = req.headers.get("user-agent") || null;

      supabase.from("login_attempts").insert({
        email: normalizedEmail,
        identifier: normalizedEmail,
        method: "email_otp",
        success: false,
        ip_address,
        user_agent,
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: "تم تسجيل طلبك. يرجى انتظار موافقة المدير للحصول على صلاحية الدخول.",
          pending: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (existingProfile.status === "blocked") {
      return new Response(
        JSON.stringify({ success: false, error: "تم حظر هذا الحساب. تواصل مع المدير." }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (existingProfile.status === "pending") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "حسابك قيد المراجعة. يرجى انتظار موافقة المدير.",
          pending: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (recentOtps && recentOtps.length >= 3) {
      return new Response(
        JSON.stringify({ success: false, error: "تم تجاوز الحد الأقصى للمحاولات. حاول لاحقاً." }),
        { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const agentId = existingProfile.agent_id;

    // Try agent-level auth settings first
    let authSettings: any = null;
    if (agentId) {
      const { data } = await supabase.from("auth_settings").select("*").eq("agent_id", agentId).limit(1).maybeSingle();
      authSettings = data;
    }

    // Check if email OTP is enabled (if agent has settings)
    if (authSettings && !authSettings.email_otp_enabled) {
      return new Response(
        JSON.stringify({ success: false, error: "تسجيل الدخول بالبريد غير مفعل. يرجى التواصل مع المدير لتفعيله." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get SMTP: agent settings → Thiqa platform settings → env vars → defaults
    let smtpHost = authSettings?.smtp_host;
    let smtpPort = authSettings?.smtp_port;
    let smtpUser = authSettings?.smtp_user;
    let smtpPassword = authSettings?.smtp_password;

    // Fallback to Thiqa platform SMTP if agent has no SMTP configured
    if (!smtpUser || !smtpPassword) {
      const { data: platformRows } = await supabase
        .from("thiqa_platform_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["smtp_host", "smtp_port", "smtp_user", "smtp_password"]);
      const platform: Record<string, string> = {};
      (platformRows || []).forEach((r: any) => { platform[r.setting_key] = r.setting_value || ""; });
      smtpHost = smtpHost || platform.smtp_host;
      smtpPort = smtpPort || (platform.smtp_port ? parseInt(platform.smtp_port) : null);
      smtpUser = smtpUser || platform.smtp_user;
      smtpPassword = smtpPassword || platform.smtp_password;
    }

    smtpHost = smtpHost || "smtp.hostinger.com";
    smtpPort = smtpPort || 465;

    if (!smtpUser || !smtpPassword) {
      return new Response(
        JSON.stringify({ success: false, error: "SMTP غير مكتمل. يرجى التواصل مع مدير المنصة." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const otp = generateOTP();
    const [otpHash] = await Promise.all([hashOTP(otp)]);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase
      .from("otp_codes")
      .insert({
        identifier: normalizedEmail,
        channel: "email",
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

    const subject = "رمز التحقق - ثقة للتأمين";
    const textContent = `رمز التحقق الخاص بك هو: ${otp}\r\n\r\nهذا الرمز صالح لمدة 5 دقائق فقط.\r\n\r\nإذا لم تطلب هذا الرمز، يرجى تجاهل هذه الرسالة.`;
    const htmlContent = buildEmailHtml({
      body: otpEmailBody(otp),
      footerText: "إذا لم تطلب هذا الرمز، يرجى تجاهل هذه الرسالة.",
    });

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      // Port 465 uses implicit TLS; everything else (587, 25, …) must
      // upgrade via STARTTLS before AUTH or Office 365 rejects with
      // "5.7.3 STARTTLS is required to send mail".
      secure: smtpPort === 465,
      requireTLS: smtpPort !== 465,
      auth: { user: smtpUser, pass: smtpPassword },
      tls: { minVersion: "TLSv1.2" },
    });

    await transporter.sendMail({
      from: `"ثقة للتأمين" <${smtpUser}>`,
      to: normalizedEmail,
      subject,
      text: textContent,
      html: htmlContent,
    });

    const ip_address = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
      || req.headers.get("cf-connecting-ip") 
      || req.headers.get("x-real-ip")
      || null;
    const user_agent = req.headers.get("user-agent") || null;

    supabase.from("login_attempts").insert({
      email: normalizedEmail,
      identifier: normalizedEmail,
      method: "email_otp",
      success: false,
      ip_address,
      user_agent,
    });

    return new Response(
      JSON.stringify({ success: true, message: "تم إرسال رمز التحقق" }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error) {
    console.error("Error in auth-email-start:", error);
    return new Response(
      JSON.stringify({ success: false, error: "حدث خطأ غير متوقع" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
