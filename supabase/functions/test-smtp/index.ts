import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { buildEmailHtml, smtpTestEmailBody } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const { data: authSettings, error: settingsError } = await supabase
      .from("auth_settings")
      .select("*")
      .limit(1)
      .single();

    if (settingsError || !authSettings) {
      return new Response(
        JSON.stringify({ success: false, error: "خطأ في تحميل إعدادات المصادقة" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const smtpHost = authSettings.smtp_host || "smtp.hostinger.com";
    const smtpPort = authSettings.smtp_port || 465;
    const smtpUser = authSettings.smtp_user;
    const smtpPassword = authSettings.smtp_password;

    if (!smtpUser || !smtpPassword) {
      return new Response(
        JSON.stringify({ success: false, error: "إعدادات SMTP غير مكتملة. يرجى إدخال اسم المستخدم وكلمة المرور." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const textContent = `اختبار SMTP ناجح!\n\nتم إرسال هذه الرسالة بنجاح من نظام ثقة للتأمين.\nSMTP Host: ${smtpHost}\nSMTP Port: ${smtpPort}`;
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
        from: `"Thiqa Insurance" <${smtpUser}>`,
        to: testEmail,
        subject: "اختبار إعدادات SMTP - ثقة للتأمين",
        text: textContent,
        html: htmlContent,
      });

      return new Response(
        JSON.stringify({ success: true, message: `تم إرسال بريد اختباري بنجاح إلى ${testEmail}` }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    } catch (smtpError: unknown) {
      console.error("SMTP error:", smtpError);
      const errorMessage = smtpError instanceof Error ? smtpError.message : "Unknown SMTP error";
      return new Response(
        JSON.stringify({ success: false, error: `فشل الاتصال بـ SMTP: ${errorMessage}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  } catch (error) {
    console.error("Error in test-smtp:", error);
    return new Response(
      JSON.stringify({ success: false, error: "حدث خطأ غير متوقع" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
