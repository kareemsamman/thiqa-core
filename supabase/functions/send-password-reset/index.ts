import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { buildEmailHtml, passwordResetEmailBody } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getSmtpSettings(adminClient: any) {
  const { data, error } = await adminClient
    .from("thiqa_platform_settings")
    .select("setting_key, setting_value")
    .in("setting_key", ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_sender_name"]);

  if (error) throw new Error("فشل في تحميل إعدادات SMTP");

  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => {
    map[r.setting_key] = r.setting_value || "";
  });

  return {
    host: map.smtp_host || Deno.env.get("THIQA_SMTP_HOST") || "smtp.hostinger.com",
    port: parseInt(map.smtp_port || Deno.env.get("THIQA_SMTP_PORT") || "465"),
    user: map.smtp_user || Deno.env.get("THIQA_SMTP_USER") || "",
    password: map.smtp_password || Deno.env.get("THIQA_SMTP_PASSWORD") || "",
    senderName: map.smtp_sender_name || "Thiqa Insurance",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const smtp = await getSmtpSettings(adminClient);
    if (!smtp.user || !smtp.password) {
      throw new Error("SMTP غير مُعد. يرجى إعداد إعدادات البريد من لوحة الإدارة.");
    }

    const { email, redirectTo } = await req.json();
    if (!email || !email.includes("@")) throw new Error("بريد إلكتروني غير صالح");

    const normalizedEmail = String(email).trim().toLowerCase();

    // Check if user signed up with Google only (no password set)
    const perPage = 200;
    let targetUser = null;
    for (let page = 1; page <= 50; page++) {
      const { data: usersData } = await adminClient.auth.admin.listUsers({ page, perPage });
      const found = usersData?.users?.find((u: any) => (u.email || "").toLowerCase() === normalizedEmail);
      if (found) { targetUser = found; break; }
      if (!usersData?.users || usersData.users.length < perPage) break;
    }

    if (targetUser) {
      const providers = targetUser.app_metadata?.providers || [];
      const hasPassword = providers.includes("email");
      const hasGoogle = providers.includes("google");
      if (hasGoogle && !hasPassword) {
        return new Response(
          JSON.stringify({ error: "هذا الحساب مسجل عبر Google. استخدم تسجيل الدخول بـ Google بدلاً من كلمة المرور." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: {
        redirectTo: redirectTo || `${supabaseUrl.replace(".supabase.co", ".lovable.app")}/reset-password`,
      },
    });

    if (linkError) {
      console.error("Generate link error:", linkError);
      return new Response(
        JSON.stringify({ success: true, message: "إذا كان البريد مسجلاً، سيتم إرسال رابط إعادة التعيين" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recoveryLink = linkData?.properties?.action_link;
    if (!recoveryLink) throw new Error("فشل في إنشاء رابط إعادة التعيين");

    const textContent = `لقد طلبت إعادة تعيين كلمة المرور الخاصة بك. استخدم هذا الرابط: ${recoveryLink}`;
    const htmlContent = buildEmailHtml({
      body: passwordResetEmailBody(recoveryLink),
      footerText: "إذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذه الرسالة. حسابك آمن ولن يتم إجراء أي تغيير.",
    });

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.password },
    });

    await transporter.sendMail({
      from: `"${smtp.senderName}" <${smtp.user}>`,
      to: normalizedEmail,
      subject: "إعادة تعيين كلمة المرور - Thiqa",
      text: textContent,
      html: htmlContent,
    });

    return new Response(
      JSON.stringify({ success: true, message: "تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Password reset error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "حدث خطأ غير متوقع" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
