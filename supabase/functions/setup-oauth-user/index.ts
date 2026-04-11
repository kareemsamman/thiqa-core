import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { buildEmailHtml, welcomeAgentEmailBody, newAgentAdminNotifyBody } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Get the authenticated user from the request JWT
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("غير مصرح");

    // Try to extract user from the JWT token directly using admin client
    // This is more reliable than creating an anon client right after OAuth redirect
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
    
    if (userError || !user) {
      console.error("getUser error:", userError?.message);
      throw new Error("فشل في التحقق من المستخدم");
    }

    const userId = user.id;
    const userEmail = (user.email || "").trim().toLowerCase();
    const fullName = user.user_metadata?.full_name || user.user_metadata?.name || userEmail.split("@")[0];

    if (!userEmail) throw new Error("البريد الإلكتروني غير متوفر");

    // Check if user already has a profile with an agent
    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id, agent_id")
      .eq("id", userId)
      .maybeSingle();

    if (existingProfile?.agent_id) {
      return new Response(
        JSON.stringify({ success: true, message: "الحساب مُعد بالفعل", already_setup: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Block super admin emails from self-registering as agents
    const { data: saCheck } = await adminClient
      .from("thiqa_super_admins")
      .select("email")
      .eq("email", userEmail)
      .maybeSingle();
    if (saCheck) {
      return new Response(
        JSON.stringify({ success: true, message: "مدير المنصة لا يحتاج إلى وكالة", already_setup: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if an agent already exists with this email (e.g. created by super admin)
    const { data: existingAgent } = await adminClient
      .from("agents")
      .select("id")
      .eq("email", userEmail)
      .maybeSingle();

    let agentId: string;

    if (existingAgent) {
      agentId = existingAgent.id;
    } else {
      // Create new agent with 35-day free trial
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 35);

      const { data: agentData, error: agentError } = await adminClient
        .from("agents")
        .insert({
          name: fullName,
          name_ar: fullName,
          email: userEmail,
          plan: "basic",
          subscription_status: "active",
          subscription_expires_at: trialEnd.toISOString(),
          monthly_price: 0,
        })
        .select("id")
        .single();

      if (agentError) throw agentError;
      agentId = agentData.id;
    }

    // Upsert profile with agent_id
    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: userId,
          email: userEmail,
          full_name: fullName,
          status: "active",
          agent_id: agentId,
          email_confirmed: true,
        },
        { onConflict: "id" }
      );

    if (profileError) throw profileError;

    // Link user to agent
    const { error: linkError } = await adminClient
      .from("agent_users")
      .upsert(
        { agent_id: agentId, user_id: userId },
        { onConflict: "user_id" }
      );

    if (linkError) throw linkError;

    // Assign admin role
    const { error: roleError } = await adminClient
      .from("user_roles")
      .upsert(
        { user_id: userId, role: "admin", agent_id: agentId },
        { onConflict: "user_id,agent_id" }
      );

    if (roleError) console.error("Role assignment error:", roleError);

    // Initialize feature flags for trial (all features enabled)
    await adminClient.rpc("set_features_for_plan", {
      p_agent_id: agentId,
      p_plan: "trial",
    }).then(({ error: featErr }) => {
      if (featErr) console.error("Feature flags init error:", featErr);
    });

    // Initialize SMS settings (enabled, uses platform defaults until agent overrides)
    await adminClient.from("sms_settings").upsert({
      agent_id: agentId,
      provider: "019",
      sms_user: "",
      sms_token: "",
      sms_source: "",
      is_enabled: true,
    }, { onConflict: "agent_id" }).then(({ error: smsErr }) => {
      if (smsErr) console.error("SMS settings init error:", smsErr);
    });

    // Initialize auth settings
    await adminClient.from("auth_settings").upsert({
      agent_id: agentId,
      email_otp_enabled: true,
      sms_otp_enabled: false,
    }, { onConflict: "agent_id" }).then(({ error: authErr }) => {
      if (authErr) console.error("Auth settings init error:", authErr);
    });

    // Send welcome email + notify super admins (non-blocking)
    try {
      const { data: smtpRows } = await adminClient
        .from("thiqa_platform_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_sender_name"]);

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
          to: userEmail,
          subject: "=?UTF-8?B?" + btoa(unescape(encodeURIComponent("مرحباً بك في ثقة للتأمين! 🎉"))) + "?=",
          text: `مرحباً ${fullName}، تم إنشاء حسابك بنجاح على منصة ثقة للتأمين.`,
          html: htmlContent,
        });

        const { data: superAdmins } = await adminClient
          .from("thiqa_super_admins")
          .select("email");
        const adminEmails = (superAdmins || [])
          .map((sa: any) => sa.email)
          .filter((e: string) => e && e.includes("@"));

        if (adminEmails.length > 0) {
          const adminHtml = buildEmailHtml({
            body: newAgentAdminNotifyBody(fullName, userEmail, null),
            footerText: "إشعار تلقائي من منصة ثقة للتأمين.",
          });

          await transporter.sendMail({
            from: `"${smtp.smtp_sender_name || "Thiqa Insurance"}" <${smtpUser}>`,
            to: adminEmails.join(","),
            subject: "=?UTF-8?B?" + btoa(unescape(encodeURIComponent("وكيل جديد سجّل في المنصة (Google) 🆕"))) + "?=",
            text: `وكيل جديد: ${fullName} - ${userEmail} (تسجيل عبر Google)`,
            html: adminHtml,
          });
        }
      }
    } catch (emailErr) {
      console.error("Welcome email error (non-blocking):", emailErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "تم إعداد حسابك بنجاح. لديك 35 يوم مجاناً!",
        agent_id: agentId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("setup-oauth-user error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "حدث خطأ غير متوقع" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
