import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { buildEmailHtml } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type UsageType = "sms" | "ai_chat";

interface PurchaseRequest {
  usage_type: UsageType;
  extra_count: number;
}

const USAGE_LABEL: Record<UsageType, string> = {
  sms: "رسائل SMS",
  ai_chat: "المساعد الذكي (ثاقب)",
};

// Reasonable upper bound so a typo doesn't rack up a huge bill.
const MAX_OVERAGE_PER_PURCHASE = 5000;

function currentMonthPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function getSmtpSettings(adminClient: any) {
  const { data } = await adminClient
    .from("thiqa_platform_settings")
    .select("setting_key, setting_value")
    .in("setting_key", ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_sender_name"]);

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

async function getUnitPrice(adminClient: any, usageType: UsageType): Promise<number> {
  const key = usageType === "sms" ? "sms_overage_unit_price" : "ai_overage_unit_price";
  const fallback = usageType === "sms" ? 0.3 : 0.5;
  try {
    const { data } = await adminClient
      .from("thiqa_platform_settings")
      .select("setting_value")
      .eq("setting_key", key)
      .maybeSingle();
    const raw = data?.setting_value;
    if (!raw) return fallback;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authenticate the caller
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Resolve the agent this user belongs to
    const { data: agentUser } = await adminClient
      .from("agent_users")
      .select("agent_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const agentId = agentUser?.agent_id;
    if (!agentId) {
      return new Response(
        JSON.stringify({ error: "Agent not found for this user" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Only admins of the agency can purchase on behalf of the agency
    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("agent_id", agentId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      return new Response(
        JSON.stringify({ error: "فقط مديرو الوكالة يمكنهم شراء باقات إضافية" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse body
    const body: PurchaseRequest = await req.json();
    const usageType = body.usage_type;
    const extraCount = Number(body.extra_count);

    if (usageType !== "sms" && usageType !== "ai_chat") {
      return new Response(
        JSON.stringify({ error: "نوع الخدمة غير صالح" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!Number.isFinite(extraCount) || extraCount <= 0) {
      return new Response(
        JSON.stringify({ error: "يجب تحديد عدد صحيح موجب" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (extraCount > MAX_OVERAGE_PER_PURCHASE) {
      return new Response(
        JSON.stringify({
          error: `الحد الأقصى للشراء هو ${MAX_OVERAGE_PER_PURCHASE} في المرة الواحدة. لكميات أكبر تواصل مع الإدارة.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const unitPrice = await getUnitPrice(adminClient, usageType);
    const totalAmount = Math.round(extraCount * unitPrice * 100) / 100;
    const period = currentMonthPeriod();

    // Insert the overage row
    const { data: overageRow, error: insertErr } = await adminClient
      .from("agent_usage_overages")
      .insert({
        agent_id: agentId,
        usage_type: usageType,
        period,
        extra_count: extraCount,
        unit_price: unitPrice,
        total_amount: totalAmount,
        purchased_by: user.id,
      })
      .select("id, created_at")
      .single();

    if (insertErr) {
      console.error("[purchase-usage-overage] insert failed:", insertErr);
      throw new Error("فشل في تسجيل عملية الشراء");
    }

    // Fetch agent info for the email
    const { data: agent } = await adminClient
      .from("agents")
      .select("name, name_ar, email, phone")
      .eq("id", agentId)
      .maybeSingle();

    // Purchaser info
    const { data: profile } = await adminClient
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle();

    // Send email notification to all super admins. Swallow any email failures
    // so they don't block the purchase itself (the row is already committed).
    try {
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
            auth: { user: smtp.user, pass: smtp.password },
          });

          const agencyName = agent?.name_ar || agent?.name || "وكيل غير معروف";
          const purchaserName = profile?.full_name || profile?.email || user.email || "مستخدم";

          const body = `
            <h2 style="margin: 0 0 16px; font-size: 20px; color: #111;">طلب باقة إضافية جديد</h2>
            <p style="margin: 0 0 24px; color: #555; font-size: 14px; line-height: 1.7;">
              قام أحد وكلاء ثقة بإضافة رصيد جديد لخدمة مدفوعة. التفاصيل أدناه — المبلغ يجب أن يُضاف إلى فاتورته الشهرية للفترة الحالية.
            </p>

            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tbody>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666; width: 40%;">الوكيل</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; font-weight: 600;">${agencyName}</td>
                </tr>
                ${agent?.email ? `
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666;">بريد الوكيل</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; direction: ltr; text-align: right;">${agent.email}</td>
                </tr>
                ` : ''}
                ${agent?.phone ? `
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666;">هاتف الوكيل</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; direction: ltr; text-align: right;">${agent.phone}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666;">قام بالشراء</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee;">${purchaserName}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666;">الخدمة</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; font-weight: 600;">${USAGE_LABEL[usageType]}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666;">الكمية المضافة</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; font-weight: 600;">${extraCount.toLocaleString()}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666;">السعر للوحدة</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee;">₪${unitPrice.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; color: #666;">الفترة</td>
                  <td style="padding: 12px 0; border-bottom: 1px solid #eee; direction: ltr; text-align: right;">${period}</td>
                </tr>
                <tr>
                  <td style="padding: 16px 0; color: #111; font-size: 15px; font-weight: 700;">المبلغ المستحق</td>
                  <td style="padding: 16px 0; color: #0b66c3; font-size: 18px; font-weight: 800;">₪${totalAmount.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <div style="margin-top: 24px; padding: 16px; background: #f0f7ff; border-radius: 8px; font-size: 13px; color: #334;">
              يرجى إضافة هذا المبلغ إلى فاتورة الوكيل للشهر الحالي. الباقة مفعّلة تلقائياً ومتاحة للاستخدام فوراً من قبل الوكيل.
            </div>
          `;

          await transporter.sendMail({
            from: `"${smtp.senderName}" <${smtp.user}>`,
            to: recipients.join(", "),
            subject: `[ثقة] شراء باقة إضافية - ${agencyName} (₪${totalAmount.toFixed(2)})`,
            html: buildEmailHtml({
              body,
              footerText: `معرف العملية: ${overageRow?.id || "—"}`,
            }),
          });
        } else {
          console.warn("[purchase-usage-overage] SMTP not configured, skipping email");
        }
      }
    } catch (emailErr) {
      console.error("[purchase-usage-overage] email notification failed:", emailErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        overage_id: overageRow?.id,
        extra_count: extraCount,
        unit_price: unitPrice,
        total_amount: totalAmount,
        period,
        message: `تم إضافة ${extraCount} ${usageType === "sms" ? "رسالة" : "محادثة"} بنجاح. المبلغ ₪${totalAmount.toFixed(2)} سيُضاف إلى فاتورتك الشهرية.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[purchase-usage-overage] fatal:", error);
    return new Response(
      JSON.stringify({ error: error.message || "حدث خطأ غير متوقع" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
