// Support ticket SMTP notifications.
//
// Invoked by the client (agent and admin UIs) right after a ticket
// or message is inserted, OR after a status change. Reuses the same
// thiqa_platform_settings SMTP config that registration-otp-send,
// password-reset, etc. consume — single source of truth so an admin
// who rotates the SMTP password fixes every notification at once.
//
// Events:
//   ticket_created     — new ticket. To: support@getthiqa.com + agent
//                        admins of that agent (so the agent admin
//                        always knows when a worker opens a ticket).
//   message_added      — reply on an existing ticket. Recipients
//                        depend on whether the author is a Thiqa
//                        super-admin (→ creator + agent admins) or an
//                        agent-side user (→ support@ + agent admins).
//   status_changed     — admin marked the ticket open / in_progress /
//                        done / cancelled. To: creator + agent admins.
//
// The author is always excluded from the recipient list — nobody
// needs an email about something they just did.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "https://esm.sh/nodemailer@6.9.16";
import { buildEmailHtml } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  senderName: string;
}

async function getSmtpSettings(adminClient: any): Promise<SmtpSettings> {
  const { data } = await adminClient
    .from("thiqa_platform_settings")
    .select("setting_key, setting_value")
    .in("setting_key", ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_sender_name"]);
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { map[r.setting_key] = r.setting_value || ""; });
  return {
    host: map.smtp_host || Deno.env.get("THIQA_SMTP_HOST") || "smtp.hostinger.com",
    port: parseInt(map.smtp_port || Deno.env.get("THIQA_SMTP_PORT") || "465", 10),
    user: map.smtp_user || Deno.env.get("THIQA_SMTP_USER") || "",
    password: map.smtp_password || Deno.env.get("THIQA_SMTP_PASSWORD") || "",
    senderName: map.smtp_sender_name || "Thiqa Support",
  };
}

async function getSupportEmail(adminClient: any): Promise<string> {
  // Pull from thiqa_platform_settings if present so the address is
  // configurable; fall back to the address the admin asked for.
  const { data } = await adminClient
    .from("thiqa_platform_settings")
    .select("setting_value")
    .eq("setting_key", "support_email")
    .maybeSingle();
  return (data?.setting_value as string) || Deno.env.get("THIQA_SUPPORT_EMAIL") || "support@getthiqa.com";
}

function getAppBaseUrl(): string {
  return Deno.env.get("APP_BASE_URL") || "https://getthiqa.com";
}

const STATUS_LABEL_AR: Record<string, string> = {
  open: "مفتوح",
  in_progress: "قيد المعالجة",
  done: "تم",
  cancelled: "ملغى",
};

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ticketEmailBody(opts: {
  intro: string;
  ticketNumber: string;
  agentName: string;
  agentShortCode: string | null;
  subject: string;
  category: string | null;
  subcategory: string | null;
  latestMessage: string | null;
  status: string;
  link: string;
}): string {
  const meta: string[] = [];
  meta.push(`<tr><td style="padding:6px 0;color:#666;font-size:13px;width:120px;">رقم التذكرة</td><td style="padding:6px 0;color:#111;font-size:14px;font-weight:700;direction:ltr;text-align:right;">${escapeHtml(opts.ticketNumber)}</td></tr>`);
  meta.push(`<tr><td style="padding:6px 0;color:#666;font-size:13px;">الوكيل</td><td style="padding:6px 0;color:#111;font-size:14px;">${escapeHtml(opts.agentName)}${opts.agentShortCode ? ` <span style="color:#666;font-family:monospace;direction:ltr;display:inline-block;">(${escapeHtml(opts.agentShortCode)})</span>` : ""}</td></tr>`);
  meta.push(`<tr><td style="padding:6px 0;color:#666;font-size:13px;">الموضوع</td><td style="padding:6px 0;color:#111;font-size:14px;">${escapeHtml(opts.subject)}</td></tr>`);
  if (opts.category) {
    const catLine = opts.subcategory ? `${opts.category} / ${opts.subcategory}` : opts.category;
    meta.push(`<tr><td style="padding:6px 0;color:#666;font-size:13px;">الفئة</td><td style="padding:6px 0;color:#111;font-size:14px;">${escapeHtml(catLine)}</td></tr>`);
  }
  meta.push(`<tr><td style="padding:6px 0;color:#666;font-size:13px;">الحالة</td><td style="padding:6px 0;color:#111;font-size:14px;">${escapeHtml(STATUS_LABEL_AR[opts.status] || opts.status)}</td></tr>`);

  const messageBlock = opts.latestMessage ? `
    <div style="margin:24px 0 0;padding:16px 18px;background:#f8f9fa;border-radius:10px;text-align:right;">
      <p style="margin:0 0 6px;color:#999;font-size:11px;letter-spacing:.5px;text-transform:uppercase;">آخر رسالة</p>
      <p style="margin:0;color:#222;font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(opts.latestMessage)}</p>
    </div>` : "";

  return `
    <h2 style="margin:0 0 6px;color:#111;font-size:22px;font-weight:700;">${escapeHtml(opts.intro)}</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;text-align:right;">
      ${meta.join("\n")}
    </table>
    ${messageBlock}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 0;">
      <tr><td>
        <a href="${opts.link}" target="_blank" style="display:inline-block;background:#0f0f1a;color:#ffffff;text-decoration:none;padding:12px 36px;border-radius:10px;font-size:15px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif;">
          فتح التذكرة
        </a>
      </td></tr>
    </table>
  `;
}

interface RecipientPlan {
  to: string[];
  subject: string;
  intro: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Validate caller is authenticated. We don't strictly use their
    // identity for routing (recipients are derived from the ticket /
    // message rows), but we still require a JWT so the function isn't
    // an open relay.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace(/^Bearer /, "");
    const { data: userRes } = await adminClient.auth.getUser(token);
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "invalid auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ticket_id, message_id, event, new_status } = await req.json() as {
      ticket_id: string;
      message_id?: string;
      event: "ticket_created" | "message_added" | "status_changed";
      new_status?: string;
    };
    if (!ticket_id || !event) throw new Error("ticket_id and event are required");

    // Pull ticket + agent. Two queries instead of nested select to
    // sidestep the embedded-relation type quirks across supabase
    // versions.
    const { data: ticket } = await adminClient
      .from("support_tickets")
      .select("id, ticket_number, agent_id, subject, status, created_by_user_id, category_id, subcategory_id")
      .eq("id", ticket_id)
      .maybeSingle();
    if (!ticket) throw new Error("ticket not found");

    const { data: agent } = await adminClient
      .from("agents")
      .select("name, name_ar, short_code")
      .eq("id", ticket.agent_id)
      .maybeSingle();
    const agentName = agent?.name_ar || agent?.name || "—";
    const agentShortCode = (agent as any)?.short_code || null;

    // Categories — only fetched if present.
    let categoryName: string | null = null;
    let subcategoryName: string | null = null;
    const catIds: string[] = [];
    if (ticket.category_id) catIds.push(ticket.category_id);
    if (ticket.subcategory_id) catIds.push(ticket.subcategory_id);
    if (catIds.length > 0) {
      const { data: cats } = await adminClient
        .from("support_categories")
        .select("id, name_ar")
        .in("id", catIds);
      const cm: Record<string, string> = {};
      (cats || []).forEach((c: any) => { cm[c.id] = c.name_ar; });
      categoryName = ticket.category_id ? cm[ticket.category_id] || null : null;
      subcategoryName = ticket.subcategory_id ? cm[ticket.subcategory_id] || null : null;
    }

    // Latest message body — for ticket_created we want the first
    // message, for message_added we want the one just inserted, for
    // status_changed we don't bundle a message at all.
    let latestMessage: string | null = null;
    let authorIsAdmin = false;
    if (event === "ticket_created" || event === "message_added") {
      let q = adminClient
        .from("support_messages")
        .select("body, author_user_id, is_admin_reply, created_at");
      if (message_id) {
        q = q.eq("id", message_id);
      } else {
        q = q.eq("ticket_id", ticket_id).order("created_at", { ascending: false }).limit(1);
      }
      const { data: msgs } = await q;
      const msg = (msgs && msgs[0]) as any;
      if (msg) {
        latestMessage = msg.body;
        authorIsAdmin = !!msg.is_admin_reply;
      }
    }

    // ─── Recipient resolution ───
    const supportEmail = await getSupportEmail(adminClient);

    // Creator email
    const { data: creatorProfile } = await adminClient
      .from("profiles")
      .select("email, full_name")
      .eq("id", ticket.created_by_user_id)
      .maybeSingle();
    const creatorEmail = (creatorProfile as any)?.email || null;

    // Agent admins (user_roles role=admin agent_id=...) emails — they
    // get CCed on every event so the agent admin always sees what
    // their team is reporting and what Thiqa is replying.
    const { data: roleRows } = await adminClient
      .from("user_roles")
      .select("user_id")
      .eq("agent_id", ticket.agent_id)
      .eq("role", "admin");
    const adminUserIds = (roleRows || []).map((r: any) => r.user_id);
    let agentAdminEmails: string[] = [];
    if (adminUserIds.length > 0) {
      const { data: adminProfiles } = await adminClient
        .from("profiles")
        .select("email")
        .in("id", adminUserIds);
      agentAdminEmails = ((adminProfiles as any[]) || []).map((p) => p.email).filter(Boolean);
    }

    // Determine recipients per event.
    const recipients = new Set<string>();
    let plan: RecipientPlan;

    if (event === "ticket_created") {
      recipients.add(supportEmail);
      agentAdminEmails.forEach((e) => recipients.add(e));
      plan = {
        to: [],
        subject: `[${ticket.ticket_number}] تذكرة جديدة من ${agentName}`,
        intro: `تذكرة دعم جديدة من ${agentName}`,
      };
    } else if (event === "message_added") {
      if (authorIsAdmin) {
        // Admin replied → email creator + agent admins.
        if (creatorEmail) recipients.add(creatorEmail);
        agentAdminEmails.forEach((e) => recipients.add(e));
        plan = {
          to: [],
          subject: `[${ticket.ticket_number}] رد جديد من فريق ثقة`,
          intro: `رد جديد من فريق ثقة على تذكرتك`,
        };
      } else {
        // Agent / worker replied → email support + agent admins.
        recipients.add(supportEmail);
        agentAdminEmails.forEach((e) => recipients.add(e));
        plan = {
          to: [],
          subject: `[${ticket.ticket_number}] رد جديد من ${agentName}`,
          intro: `رد جديد على التذكرة من ${agentName}`,
        };
      }
    } else if (event === "status_changed") {
      if (creatorEmail) recipients.add(creatorEmail);
      agentAdminEmails.forEach((e) => recipients.add(e));
      const statusAr = STATUS_LABEL_AR[new_status || ticket.status] || ticket.status;
      plan = {
        to: [],
        subject: `[${ticket.ticket_number}] تحديث حالة التذكرة: ${statusAr}`,
        intro: `تم تحديث حالة تذكرتك إلى "${statusAr}"`,
      };
    } else {
      throw new Error(`unknown event: ${event}`);
    }

    // Drop the caller's own email so they don't get notified about
    // their own action.
    const callerEmail = userRes.user.email?.toLowerCase();
    if (callerEmail) {
      for (const e of Array.from(recipients)) {
        if (e.toLowerCase() === callerEmail) recipients.delete(e);
      }
    }

    plan.to = Array.from(recipients);
    if (plan.to.length === 0) {
      // Nothing to send (e.g. admin replied to a ticket where they
      // were also the only agent admin somehow). Still 200 so the
      // client doesn't see a noisy error.
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Send ───
    const smtp = await getSmtpSettings(adminClient);
    if (!smtp.user || !smtp.password) {
      console.error("[support-notify] SMTP not configured; skipping send");
      return new Response(JSON.stringify({ ok: false, error: "smtp not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const link = `${getAppBaseUrl()}/support/${ticket.id}`;
    const html = buildEmailHtml({
      body: ticketEmailBody({
        intro: plan.intro,
        ticketNumber: ticket.ticket_number,
        agentName,
        agentShortCode,
        subject: ticket.subject,
        category: categoryName,
        subcategory: subcategoryName,
        latestMessage,
        status: new_status || ticket.status,
        link,
      }),
      footerText: "هذه رسالة آلية من نظام الدعم. للرد، افتح التذكرة عبر الرابط أعلاه.",
    });

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      requireTLS: smtp.port !== 465,
      auth: { user: smtp.user, pass: smtp.password },
      tls: { minVersion: "TLSv1.2" },
    });

    await transporter.sendMail({
      from: `"${smtp.senderName}" <${smtp.user}>`,
      to: plan.to.join(", "),
      subject: plan.subject,
      text: `${plan.intro}\n\nرقم التذكرة: ${ticket.ticket_number}\nالوكيل: ${agentName}\nالموضوع: ${ticket.subject}\n${latestMessage ? `\n${latestMessage}\n` : ""}\nرابط التذكرة: ${link}`,
      html,
      // Mark every support email as high-priority so it surfaces with
      // the red "!" / Importance: High flag in Outlook / Gmail / etc.
      // nodemailer's `priority: 'high'` shorthand sets X-Priority: 1,
      // X-MSMail-Priority: High, and Importance: high in one go.
      priority: "high",
    });

    return new Response(JSON.stringify({ ok: true, sent: plan.to.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[support-notify]", err);
    return new Response(JSON.stringify({ error: err?.message || "internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
