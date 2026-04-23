// request-addon-purchase — agent admin can buy a catalog addon
// (extra_user, extra_branch, extra_ai, extra_sms, extra_marketing_sms,
// onboarding, data_migration) directly from the /subscription page.
//
// The request is created as an agent_addons row with
// status='pending_approval'. It does NOT count toward quotas until a
// Thiqa super admin flips it to 'active' from the agent detail page.
// An email notification is sent to all super admins at request time.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type AddonType =
  | "extra_user"
  | "extra_branch"
  | "extra_ai"
  | "extra_sms"
  | "extra_marketing_sms"
  | "onboarding"
  | "data_migration";

interface RequestBody {
  addon_type: AddonType;
  quantity?: number;
}

// setting_key for each addon's default unit price.
const PRICE_KEYS: Record<AddonType, string> = {
  extra_user: "addon_extra_user_price",
  extra_branch: "addon_extra_branch_price",
  extra_ai: "addon_extra_ai_price",
  extra_sms: "addon_extra_sms_price",
  extra_marketing_sms: "addon_extra_marketing_sms_price",
  onboarding: "addon_onboarding_price",
  data_migration: "addon_data_migration_price",
};

// Fallbacks if a platform setting hasn't been seeded yet.
const PRICE_FALLBACK: Record<AddonType, number> = {
  extra_user: 30,
  extra_branch: 120,
  extra_ai: 50,
  extra_sms: 50,
  extra_marketing_sms: 50,
  onboarding: 200,
  data_migration: 450,
};

const BILLING_CYCLE: Record<AddonType, "monthly" | "one_time"> = {
  extra_user: "monthly",
  extra_branch: "monthly",
  extra_ai: "monthly",
  extra_sms: "monthly",
  extra_marketing_sms: "monthly",
  onboarding: "one_time",
  data_migration: "one_time",
};

const LABEL_AR: Record<AddonType, string> = {
  extra_user: "مستخدم إضافي",
  extra_branch: "فرع إضافي",
  extra_ai: "باقة AI",
  extra_sms: "باقة SMS",
  extra_marketing_sms: "باقة SMS تسويقية",
  onboarding: "إعداد أولي",
  data_migration: "هجرة بيانات",
};

const MAX_QUANTITY = 50;

async function getSmtpSettings(client: any) {
  const { data } = await client
    .from("thiqa_platform_settings")
    .select("setting_key, setting_value")
    .in("setting_key", [
      "smtp_host",
      "smtp_port",
      "smtp_user",
      "smtp_password",
      "smtp_sender_name",
    ]);
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

async function getUnitPrice(client: any, type: AddonType): Promise<number> {
  const key = PRICE_KEYS[type];
  try {
    const { data } = await client
      .from("thiqa_platform_settings")
      .select("setting_value")
      .eq("setting_key", key)
      .maybeSingle();
    const raw = data?.setting_value;
    if (!raw) return PRICE_FALLBACK[type];
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : PRICE_FALLBACK[type];
  } catch {
    return PRICE_FALLBACK[type];
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid auth" }, 401);

    // Caller must be an admin with an agent_id.
    const { data: profile } = await adminClient
      .from("profiles")
      .select("id, full_name, email, agent_id, status")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.status !== "active" || !profile.agent_id) {
      return json({ error: "Forbidden" }, 403);
    }
    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);

    const body = (await req.json()) as RequestBody;
    const type = body.addon_type;
    if (!type || !(type in PRICE_KEYS)) {
      return json({ error: "Invalid addon_type" }, 400);
    }
    const quantity = Math.max(1, Math.min(MAX_QUANTITY, Math.floor(body.quantity ?? 1)));

    const unitPrice = await getUnitPrice(adminClient, type);
    const billing = BILLING_CYCLE[type];

    // Don't queue duplicate pending requests for the same addon.
    const { data: existingPending } = await adminClient
      .from("agent_addons")
      .select("id")
      .eq("agent_id", profile.agent_id)
      .eq("addon_type", type)
      .eq("status", "pending_approval")
      .maybeSingle();
    if (existingPending) {
      return json(
        { error: "لديك طلب قيد المراجعة لهذه الإضافة. يرجى انتظار الرد من فريق ثقة." },
        409,
      );
    }

    const { data: inserted, error: insertError } = await adminClient
      .from("agent_addons")
      .insert({
        agent_id: profile.agent_id,
        addon_type: type,
        quantity,
        unit_price: unitPrice,
        billing_cycle: billing,
        starts_at: new Date().toISOString().slice(0, 10),
        status: "pending_approval",
        requested_by_user_id: user.id,
        requested_at: new Date().toISOString(),
        created_by: user.id,
      })
      .select()
      .single();

    if (insertError || !inserted) {
      console.error("[request-addon-purchase] insert failed:", insertError);
      return json({ error: insertError?.message || "Failed to create request" }, 500);
    }

    // Notify super admins by email. Don't block the success response on
    // email failures — the row is already committed.
    try {
      const { data: agent } = await adminClient
        .from("agents")
        .select("name, name_ar, email, phone")
        .eq("id", profile.agent_id)
        .maybeSingle();
      const { data: superAdmins } = await adminClient
        .from("thiqa_super_admins")
        .select("email, name");
      const recipients = (superAdmins || [])
        .map((s: any) => String(s.email || "").trim())
        .filter((e: string) => e && e.includes("@") && !e.endsWith("@phone.local"));

      if (recipients.length > 0) {
        const smtp = await getSmtpSettings(adminClient);
        if (smtp.user && smtp.password) {
          const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.port === 465,
            requireTLS: smtp.port !== 465,
            auth: { user: smtp.user, pass: smtp.password },
            tls: { minVersion: "TLSv1.2" },
          });

          const agencyName = agent?.name_ar || agent?.name || "وكيل غير معروف";
          const purchaserName = profile?.full_name || profile?.email || user.email || "مستخدم";
          const label = LABEL_AR[type];
          const total = quantity * unitPrice;
          const cycleLabel = billing === "monthly" ? "شهري" : "مرة واحدة";

          const html = `
            <h2 style="margin:0 0 16px;font-size:20px;color:#111;">طلب إضافة جديد قيد المراجعة</h2>
            <p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.7;">
              قام ${purchaserName} (وكالة ${agencyName}) بطلب شراء إضافة. يرجى مراجعة الطلب من صفحة إدارة الوكيل في منصة ثقة.
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tbody>
                <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;width:40%;">الوكيل</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:600;">${agencyName}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;">الإضافة</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:600;">${label}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;">الكمية</td><td style="padding:10px 0;border-bottom:1px solid #eee;">${quantity}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;">سعر الوحدة</td><td style="padding:10px 0;border-bottom:1px solid #eee;">₪${unitPrice}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;">نوع الفوترة</td><td style="padding:10px 0;border-bottom:1px solid #eee;">${cycleLabel}</td></tr>
                <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;">الإجمالي</td><td style="padding:10px 0;border-bottom:1px solid #eee;font-weight:700;font-size:16px;">₪${total.toLocaleString()}</td></tr>
                <tr><td style="padding:10px 0;color:#666;">طلبه</td><td style="padding:10px 0;">${purchaserName}</td></tr>
              </tbody>
            </table>
          `;

          await transporter.sendMail({
            from: `"${smtp.senderName}" <${smtp.user}>`,
            to: recipients.join(", "),
            subject: `طلب إضافة جديد — ${agencyName}`,
            html,
          }).catch((e) => console.error("[request-addon-purchase] email send failed:", e));
        }
      }
    } catch (e) {
      console.error("[request-addon-purchase] notification block failed:", e);
    }

    return json({
      success: true,
      request_id: inserted.id,
      addon_type: type,
      quantity,
      unit_price: unitPrice,
      total: quantity * unitPrice,
      billing_cycle: billing,
    }, 201);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    console.error("[request-addon-purchase] fatal:", error);
    return json({ error }, 500);
  }
});
