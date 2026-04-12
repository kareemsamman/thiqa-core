import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { buildEmailHtml, smtpTestEmailBody } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { testEmail } = await req.json();

    if (!testEmail || !testEmail.includes("@")) {
      return new Response(
        JSON.stringify({ success: false, error: "البريد الإلكتروني غير صالح" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { data: rows, error: settingsError } = await supabase
      .from("thiqa_platform_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_sender_name"]);

    if (settingsError) {
      return new Response(
        JSON.stringify({ success: false, error: "فشل في تحميل إعدادات المنصة" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const settings: Record<string, string> = {};
    (rows || []).forEach((r: { setting_key: string; setting_value: string | null }) => {
      settings[r.setting_key] = r.setting_value || "";
    });

    const smtpHost = settings.smtp_host || "smtp.hostinger.com";
    const smtpPort = Number(settings.smtp_port) || 465;
    const smtpUser = settings.smtp_user;
    const smtpPassword = settings.smtp_password;
    const senderName = settings.smtp_sender_name || "Thiqa Insurance";

    if (!smtpUser || !smtpPassword) {
      return new Response(
        JSON.stringify({ success: false, error: "إعدادات SMTP غير مكتملة. يرجى حفظ البريد وكلمة المرور أولاً." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const textContent = `اختبار SMTP ناجح!\n\nتم إرسال هذه الرسالة من منصة ثقة للتأمين.\nSMTP Host: ${smtpHost}\nSMTP Port: ${smtpPort}`;
    const htmlContent = buildEmailHtml({
      body: smtpTestEmailBody(smtpHost, smtpPort),
    });

    try {
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
        from: `"${senderName}" <${smtpUser}>`,
        to: testEmail,
        subject: "اختبار إعدادات SMTP - منصة ثقة",
        text: textContent,
        html: htmlContent,
      });

      return new Response(
        JSON.stringify({ success: true, message: `تم إرسال بريد اختباري بنجاح إلى ${testEmail}` }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    } catch (smtpError: unknown) {
      console.error("SMTP error:", smtpError);
      const msg = smtpError instanceof Error ? smtpError.message : "خطأ غير معروف";
      return new Response(
        JSON.stringify({ success: false, error: `فشل الاتصال بـ SMTP: ${msg}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  } catch (error) {
    console.error("Error in test-platform-smtp:", error);
    return new Response(
      JSON.stringify({ success: false, error: "حدث خطأ غير متوقع" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
