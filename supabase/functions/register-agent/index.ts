import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { buildEmailHtml, welcomeAgentEmailBody, newAgentAdminNotifyBody } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMAIL_EXISTS_REGEX = /already been registered|email_exists/i;

type AdminClient = ReturnType<typeof createClient>;

async function findAuthUserByEmail(adminClient: AdminClient, normalizedEmail: string) {
  const perPage = 200;

  for (let page = 1; page <= 50; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const found = data.users.find((u) => (u.email || "").toLowerCase() === normalizedEmail);
    if (found) return found;

    if (data.users.length < perPage) break;
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let adminClient: AdminClient | null = null;
  let createdAuthUserId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    adminClient = createClient(supabaseUrl, serviceKey);

    const { first_name, last_name, email, password, phone } = await req.json();

    if (!first_name || !last_name || !email || !password) {
      throw new Error("جميع الحقول مطلوبة");
    }

    if (password.length < 6) {
      throw new Error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const fullName = `${String(first_name).trim()} ${String(last_name).trim()}`;

    // Check if email verification is skipped
    const { data: skipSetting } = await adminClient
      .from("thiqa_platform_settings")
      .select("setting_value")
      .eq("setting_key", "skip_email_verification")
      .maybeSingle();

    const skipEmailVerification = skipSetting?.setting_value === "true";

    let userId: string | null = null;

    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: skipEmailVerification,
      user_metadata: { full_name: fullName },
    });

    if (createError) {
      if (!EMAIL_EXISTS_REGEX.test(createError.message || "")) {
        throw createError;
      }

      const { data: existingProfile, error: profileLookupError } = await adminClient
        .from("profiles")
        .select("id")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (profileLookupError) throw profileLookupError;

      if (existingProfile?.id) {
        throw new Error("هذا البريد الإلكتروني مسجل بالفعل. يرجى تسجيل الدخول.");
      }

      const existingAuthUser = await findAuthUserByEmail(adminClient, normalizedEmail);
      if (!existingAuthUser) {
        throw new Error("هذا البريد الإلكتروني مسجل بالفعل. يرجى تسجيل الدخول.");
      }

      userId = existingAuthUser.id;

      const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(userId, {
        password,
        email_confirm: skipEmailVerification,
        user_metadata: { full_name: fullName },
      });

      if (updateAuthError) throw updateAuthError;
    } else {
      userId = createdUser.user.id;
      createdAuthUserId = userId;
    }

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 35);

    const { data: agentData, error: agentError } = await adminClient
      .from("agents")
      .insert({
        name: fullName,
        name_ar: fullName,
        email: normalizedEmail,
        phone: phone?.trim() || null,
        plan: "basic",
        subscription_status: "active",
        subscription_expires_at: trialEnd.toISOString(),
        monthly_price: 0,
      })
      .select("id")
      .single();

    if (agentError) throw agentError;

    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: userId,
          email: normalizedEmail,
          full_name: fullName,
          phone: phone?.trim() || null,
          status: "active",
          agent_id: agentData.id,
          email_confirmed: skipEmailVerification,
        },
        { onConflict: "id" },
      );

    if (profileError) throw profileError;

    const { error: linkError } = await adminClient
      .from("agent_users")
      .upsert(
        {
          agent_id: agentData.id,
          user_id: userId,
        },
        { onConflict: "user_id" },
      );

    if (linkError) throw linkError;

    const { error: roleError } = await adminClient
      .from("user_roles")
      .upsert(
        {
          user_id: userId,
          role: "admin",
          agent_id: agentData.id,
        },
        { onConflict: "user_id,agent_id" },
      );

    if (roleError) {
      console.error("Role assignment error:", roleError);
    }

    const { error: otpError } = await adminClient.auth.admin.generateLink({
      type: "signup",
      email: normalizedEmail,
      password,
    });

    if (otpError) {
      console.error("OTP send error:", otpError);
    }

    // Send welcome email via SMTP
    try {
      const { data: smtpRows } = await adminClient
        .from("thiqa_platform_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_sender_name", "superadmin_email"]);

      const smtp: Record<string, string> = {};
      (smtpRows || []).forEach((r: any) => { smtp[r.setting_key] = r.setting_value || ""; });

      const smtpUser = smtp.smtp_user;
      const smtpPassword = smtp.smtp_password;

      if (smtpUser && smtpPassword) {
        const transporter = nodemailer.createTransport({
          host: smtp.smtp_host || "smtp.hostinger.com",
          port: Number(smtp.smtp_port) || 465,
          secure: (Number(smtp.smtp_port) || 465) === 465,
          auth: { user: smtpUser, pass: smtpPassword },
        });

        const htmlContent = buildEmailHtml({
          body: welcomeAgentEmailBody(fullName),
          footerText: "هذه الرسالة تم إرسالها تلقائياً عند إنشاء حسابك.",
        });

        await transporter.sendMail({
          from: `"${smtp.smtp_sender_name || "Thiqa Insurance"}" <${smtpUser}>`,
          to: normalizedEmail,
          subject: "=?UTF-8?B?" + btoa(unescape(encodeURIComponent("مرحباً بك في ثقة للتأمين! 🎉"))) + "?=",
          text: `مرحباً ${fullName}، تم إنشاء حسابك بنجاح على منصة ثقة للتأمين.`,
          html: htmlContent,
        });

        // Notify super admin
        const superAdminEmail = smtp.superadmin_email;
        if (superAdminEmail && superAdminEmail.includes("@")) {
          const adminHtml = buildEmailHtml({
            body: newAgentAdminNotifyBody(fullName, normalizedEmail, phone?.trim() || null),
            footerText: "إشعار تلقائي من منصة ثقة للتأمين.",
          });

          await transporter.sendMail({
            from: `"${smtp.smtp_sender_name || "Thiqa Insurance"}" <${smtpUser}>`,
            to: superAdminEmail,
            subject: "=?UTF-8?B?" + btoa(unescape(encodeURIComponent("وكيل جديد سجّل في المنصة 🆕"))) + "?=",
            text: `وكيل جديد: ${fullName} - ${normalizedEmail}`,
            html: adminHtml,
          });
        }
      }
    } catch (welcomeErr) {
      console.error("Welcome email error (non-blocking):", welcomeErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "تم تسجيل وكيل جديد بنجاح. لديك 35 يوم مجاناً بدون أي وسيلة دفع.",
        agent_id: agentData.id,
        user_id: userId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    if (createdAuthUserId && adminClient) {
      const { error: rollbackError } = await adminClient.auth.admin.deleteUser(createdAuthUserId);
      if (rollbackError) {
        console.error("Rollback auth user error:", rollbackError);
      }
    }

    console.error("Registration error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "حدث خطأ غير متوقع" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
