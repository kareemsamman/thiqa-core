// Public support contact form → support_tickets row + emails.
//
// Fired by the form on /faq. Anyone (logged in or not) can call this
// — no JWT required — so input is treated as untrusted: server-side
// validation, lightweight per-IP rate limiting, sanitised HTML body.
//
// Side effects on a successful submission:
//   1. Insert a `support_tickets` row with source='public', no agent
//      and no creator_user, but contact_name + contact_email set so
//      the admin reply path (support-notify) can route email back.
//   2. Insert the initial `support_messages` row with both `body`
//      (plain-text, used by the existing thread UI) and `body_html`
//      (the visual-editor output, sent in confirmation/notification
//      emails).
//   3. Send a notification email to support@getthiqa.com (or the
//      configured support_email) with the ticket meta and body.
//   4. Send a Thiqa-branded confirmation email to the submitter so
//      they know we received the request and will follow up.
//
// Errors are JSON-shaped with a stable `error` field; the form maps
// codes to Arabic messages.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "https://esm.sh/nodemailer@6.9.16";
import { buildEmailHtml } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SubmitPayload {
  name?: string;
  email?: string;
  category?: string;          // free-text category label (Arabic)
  body?: string;              // plain-text body (the editor outputs both)
  body_html?: string;         // sanitised HTML body
  honeypot?: string;          // hidden field; if non-empty → silent reject
}

// ── Per-IP throttle (in-memory). Edge function instances are short
// lived but a single instance handling burst traffic from a single
// abuser still benefits from the limiter. Window: 5 submissions / 10
// minutes per IP. Resets when the instance recycles.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const ipHits = new Map<string, number[]>();

function ipFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "anonymous";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (ipHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return true;
  recent.push(now);
  ipHits.set(ip, recent);
  return false;
}

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Strip every tag we don't need in an email body. Lets through a
// minimal allowlist (formatting + lists + links). Anything else gets
// stripped, which is fine — visual editors usually emit only this set.
function sanitiseHtml(html: string): string {
  if (!html) return "";
  // Remove <script>, <style>, <iframe>, <object>, <embed>, <link>, <meta> blocks entirely.
  let cleaned = html.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  cleaned = cleaned.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, "");
  // Strip any element attribute we don't recognise. Keep href on <a>.
  cleaned = cleaned.replace(/<([a-z0-9]+)\b([^>]*)>/gi, (m, tag) => {
    const allowed = new Set(["b", "strong", "i", "em", "u", "br", "p", "ul", "ol", "li", "a", "span", "div"]);
    if (!allowed.has(tag.toLowerCase())) return "";
    if (tag.toLowerCase() === "a") {
      // Pull href out, drop everything else.
      const href = m.match(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i);
      const url = (href?.[1] || href?.[2] || "").trim();
      if (!url || /^(javascript|data):/i.test(url)) return "<a>";
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">`;
    }
    return `<${tag.toLowerCase()}>`;
  });
  // Strip <a href> javascript: payloads (paranoid double-pass).
  cleaned = cleaned.replace(/<a\s+href\s*=\s*["']?\s*javascript:[^>]*>/gi, "<a>");
  return cleaned;
}

async function getPlatformSetting(adminClient: any, key: string, fallback: string): Promise<string> {
  const { data } = await adminClient
    .from("thiqa_platform_settings")
    .select("setting_value")
    .eq("setting_key", key)
    .maybeSingle();
  return ((data as any)?.setting_value as string) || fallback;
}

async function getSmtpSettings(adminClient: any) {
  const keys = ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_sender_name", "smtp_from_email"];
  const { data } = await adminClient
    .from("thiqa_platform_settings")
    .select("setting_key, setting_value")
    .in("setting_key", keys);
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { map[r.setting_key] = r.setting_value || ""; });
  const user = map.smtp_user || Deno.env.get("THIQA_SMTP_USER") || "";
  return {
    host: map.smtp_host || Deno.env.get("THIQA_SMTP_HOST") || "smtp.hostinger.com",
    port: parseInt(map.smtp_port || Deno.env.get("THIQA_SMTP_PORT") || "465", 10),
    user,
    password: map.smtp_password || Deno.env.get("THIQA_SMTP_PASSWORD") || "",
    senderName: map.smtp_sender_name || "Thiqa Support",
    fromEmail: map.smtp_from_email
      || Deno.env.get("THIQA_SMTP_FROM_EMAIL")
      || (user.includes("@") ? `no-reply@${user.split("@")[1]}` : user),
  };
}

function notifyAdminBody(opts: {
  ticketNumber: string;
  name: string;
  email: string;
  category: string;
  bodyHtml: string;
}): string {
  return `
    <h2 style="margin:0 0 6px;color:#111;font-size:22px;font-weight:700;">طلب دعم جديد من الموقع</h2>
    <p style="margin:0 0 24px;color:#666;font-size:14px;">تم استلام طلب جديد عبر نموذج الاتصال في صفحة الأسئلة الشائعة.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;text-align:right;">
      <tr><td style="padding:6px 0;color:#666;font-size:13px;width:120px;">رقم التذكرة</td><td style="padding:6px 0;color:#111;font-size:14px;font-weight:700;direction:ltr;text-align:right;">${escapeHtml(opts.ticketNumber)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;font-size:13px;">الاسم</td><td style="padding:6px 0;color:#111;font-size:14px;">${escapeHtml(opts.name)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;font-size:13px;">البريد</td><td style="padding:6px 0;color:#111;font-size:14px;direction:ltr;text-align:right;">${escapeHtml(opts.email)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;font-size:13px;">الفئة</td><td style="padding:6px 0;color:#111;font-size:14px;">${escapeHtml(opts.category)}</td></tr>
    </table>
    <div style="margin:0 0 0;padding:18px 20px;background:#f8f9fa;border-radius:10px;text-align:right;">
      <p style="margin:0 0 8px;color:#999;font-size:11px;letter-spacing:.5px;text-transform:uppercase;">نص الطلب</p>
      <div style="margin:0;color:#222;font-size:14px;line-height:1.8;">${opts.bodyHtml || "—"}</div>
    </div>
  `;
}

function customerConfirmationBody(opts: { ticketNumber: string; name: string }): string {
  return `
    <h2 style="margin:0 0 6px;color:#111;font-size:22px;font-weight:700;">شكراً لتواصلك مع ثقة 🌟</h2>
    <p style="margin:0 0 18px;color:#444;font-size:15px;line-height:1.8;">
      أهلاً ${escapeHtml(opts.name)}،<br/>
      وصلنا طلبك بنجاح وسنرد عليك في أقرب وقت ممكن — عادة خلال 24 ساعة في أيام العمل.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px;max-width:340px;">
      <tr>
        <td style="background:#f8f9fa;border-radius:10px;padding:18px 22px;text-align:right;">
          <p style="margin:0 0 4px;color:#666;font-size:11px;letter-spacing:.5px;text-transform:uppercase;">رقم تذكرتك</p>
          <p style="margin:0;color:#0f0f1a;font-size:18px;font-weight:800;direction:ltr;text-align:right;">${escapeHtml(opts.ticketNumber)}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;color:#666;font-size:14px;line-height:1.8;">
      الرد على طلبك سيصلك على نفس البريد الإلكتروني هذا. احتفظ برقم التذكرة لمراجعتنا في حال تابعت الموضوع لاحقاً.
    </p>
    <p style="margin:24px 0 0;color:#999;font-size:13px;line-height:1.7;">
      فريق ثقة للتأمين
    </p>
  `;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Rate limit early so abusive callers don't even hit Supabase.
  const ip = ipFromRequest(req);
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: SubmitPayload;
  try {
    payload = await req.json() as SubmitPayload;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Honeypot — bots tend to fill every field. Real users never see it.
  if (payload.honeypot && payload.honeypot.trim().length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Validate inputs.
  const name = (payload.name || "").trim();
  const email = (payload.email || "").trim().toLowerCase();
  const category = (payload.category || "").trim();
  const body = (payload.body || "").trim();
  const bodyHtmlRaw = (payload.body_html || "").trim();

  if (name.length < 2 || name.length > 120)        return badRequest("invalid_name");
  if (!EMAIL_RE.test(email) || email.length > 200) return badRequest("invalid_email");
  if (category.length < 2 || category.length > 80) return badRequest("invalid_category");
  if (body.length < 1 || body.length > 5000)       return badRequest("invalid_body");

  const bodyHtml = sanitiseHtml(bodyHtmlRaw) || `<p>${escapeHtml(body).replace(/\n/g, "<br/>")}</p>`;

  // ── Insert ticket + initial message via service role.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  const subject = category.length > 60 ? `${category.slice(0, 57)}…` : category;

  const { data: ticket, error: ticketErr } = await adminClient
    .from("support_tickets")
    .insert({
      agent_id: null,
      created_by_user_id: null,
      category_id: null,
      subcategory_id: null,
      subject,
      status: "open",
      source: "public",
      contact_name: name,
      contact_email: email,
    })
    .select("id, ticket_number")
    .single();
  if (ticketErr || !ticket) {
    console.error("[public-support-submit] ticket insert failed", ticketErr);
    return new Response(JSON.stringify({ error: "ticket_insert_failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: msgErr } = await adminClient
    .from("support_messages")
    .insert({
      ticket_id: ticket.id,
      author_user_id: null,
      body,
      body_html: bodyHtml,
      is_admin_reply: false,
    });
  if (msgErr) {
    console.error("[public-support-submit] message insert failed", msgErr);
    // Not fatal — ticket already exists. Continue with emails using the body we have.
  }

  // ── Send emails (notification to support, confirmation to customer).
  const supportEmail = await getPlatformSetting(adminClient, "support_email", "support@getthiqa.com");
  const smtp = await getSmtpSettings(adminClient);

  if (smtp.user && smtp.password) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        requireTLS: smtp.port !== 465,
        auth: { user: smtp.user, pass: smtp.password },
        tls: { minVersion: "TLSv1.2" },
      });

      // Notification to support inbox
      await transporter.sendMail({
        from: `"${smtp.senderName}" <${smtp.fromEmail}>`,
        to: supportEmail,
        replyTo: email,
        subject: `[${ticket.ticket_number}] طلب دعم جديد — ${category}`,
        html: buildEmailHtml({
          body: notifyAdminBody({
            ticketNumber: ticket.ticket_number,
            name, email, category, bodyHtml,
          }),
          footerText: "اضغط ردّ على هذه الرسالة للتواصل المباشر مع المرسل.",
        }),
      });

      // Confirmation to customer
      await transporter.sendMail({
        from: `"${smtp.senderName}" <${smtp.fromEmail}>`,
        to: email,
        subject: `[${ticket.ticket_number}] استلمنا طلبك — Thiqa`,
        html: buildEmailHtml({
          body: customerConfirmationBody({ ticketNumber: ticket.ticket_number, name }),
          footerText: "هذه رسالة آلية من نظام دعم Thiqa. سيتم الرد عليك قريباً من فريقنا.",
        }),
      });
    } catch (e) {
      console.error("[public-support-submit] email send failed", e);
      // Email failure shouldn't fail the request — the ticket is in
      // the DB and the support team will see it.
    }
  } else {
    console.warn("[public-support-submit] SMTP not configured; ticket saved without email notification");
  }

  return new Response(
    JSON.stringify({ ok: true, ticket_number: ticket.ticket_number }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

function badRequest(code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status: 400,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  });
}
