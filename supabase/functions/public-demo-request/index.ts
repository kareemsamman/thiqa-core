// Public "request a demo call" lead capture.
//
// Hit by the <DemoCallDialog /> on the landing/pricing/faq pages
// (anonymous, no JWT). Required input is just a phone number; name +
// email + note are optional. Side effects:
//
//   1. Insert a support_tickets row (source='public', no agent, no
//      creator user) with contact_name + contact_phone + (optionally)
//      contact_email. Subject is set to "طلب عرض توضيحي" so the
//      Thiqa-side admin inbox shows it cleanly.
//   2. Insert the initial support_messages row with the lead details
//      so the thread UI has something to display when admin opens it.
//   3. Email support@getthiqa.com with the lead so the rep knows to
//      call back. No customer confirmation email — we don't always
//      have an email address, and the customer is expecting a phone
//      call anyway.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "https://esm.sh/nodemailer@6.9.16";
import { buildEmailHtml } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface DemoPayload {
  name?: string;
  phone?: string;
  email?: string;
  note?: string;
  honeypot?: string;
}

// Per-IP throttle (5 / 10min). Mirrors public-support-submit.
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
// Allow digits, +, spaces, hyphens, parentheses. Length 6–25.
const PHONE_RE = /^[+\d][\d\s().-]{5,24}$/;

function encodeMimeSubject(s: string): string {
  return "=?UTF-8?B?" + btoa(unescape(encodeURIComponent(s))) + "?=";
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    senderName: map.smtp_sender_name || "Thiqa",
  };
}

function notifyAdminBody(opts: {
  ticketNumber: string;
  name: string;
  phone: string;
  email: string;
  note: string;
}): string {
  return `
    <h2 style="margin:0 0 6px;color:#111;font-size:22px;font-weight:700;">طلب عرض توضيحي جديد 📞</h2>
    <p style="margin:0 0 24px;color:#666;font-size:14px;">عميل ترك رقم هاتفه ليتواصل معه ممثل ثقة. الرد المتوقع: مكالمة هاتفية.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;text-align:right;">
      <tr><td style="padding:6px 0;color:#666;font-size:13px;width:120px;">رقم التذكرة</td><td style="padding:6px 0;color:#111;font-size:14px;font-weight:700;direction:ltr;text-align:right;">${escapeHtml(opts.ticketNumber)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;font-size:13px;">الاسم</td><td style="padding:6px 0;color:#111;font-size:14px;">${escapeHtml(opts.name)}</td></tr>
      <tr><td style="padding:6px 0;color:#666;font-size:13px;">الهاتف</td><td style="padding:6px 0;color:#111;font-size:15px;font-weight:700;direction:ltr;text-align:right;"><a href="tel:${escapeHtml(opts.phone)}" style="color:#0f0f1a;text-decoration:none;">${escapeHtml(opts.phone)}</a></td></tr>
      ${opts.email ? `<tr><td style="padding:6px 0;color:#666;font-size:13px;">البريد</td><td style="padding:6px 0;color:#111;font-size:14px;direction:ltr;text-align:right;"><a href="mailto:${escapeHtml(opts.email)}" style="color:#0f0f1a;text-decoration:none;">${escapeHtml(opts.email)}</a></td></tr>` : ""}
    </table>
    ${opts.note ? `
    <div style="margin:0 0 0;padding:18px 20px;background:#f8f9fa;border-radius:10px;text-align:right;">
      <p style="margin:0 0 8px;color:#999;font-size:11px;letter-spacing:.5px;text-transform:uppercase;">ملاحظة من العميل</p>
      <div style="margin:0;color:#222;font-size:14px;line-height:1.8;white-space:pre-wrap;">${escapeHtml(opts.note)}</div>
    </div>` : ""}
  `;
}

function badRequest(code: string) {
  return new Response(JSON.stringify({ error: code }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ip = ipFromRequest(req);
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: DemoPayload;
  try {
    payload = await req.json() as DemoPayload;
  } catch {
    return badRequest("invalid_json");
  }

  if (payload.honeypot && payload.honeypot.trim().length > 0) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const name = (payload.name || "").trim() || "زائر";
  const phone = (payload.phone || "").trim();
  const email = (payload.email || "").trim().toLowerCase();
  const note = (payload.note || "").trim();

  if (name.length > 120)                                    return badRequest("invalid_name");
  if (!PHONE_RE.test(phone))                                return badRequest("invalid_phone");
  if (email && (!EMAIL_RE.test(email) || email.length > 200)) return badRequest("invalid_email");
  if (note.length > 2000)                                   return badRequest("invalid_note");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: ticket, error: ticketErr } = await adminClient
    .from("support_tickets")
    .insert({
      agent_id: null,
      created_by_user_id: null,
      category_id: null,
      subcategory_id: null,
      subject: "طلب عرض توضيحي",
      status: "open",
      source: "public",
      contact_name: name,
      contact_phone: phone,
      contact_email: email || null,
    })
    .select("id, ticket_number")
    .single();

  if (ticketErr || !ticket) {
    console.error("[public-demo-request] ticket insert failed", ticketErr);
    return new Response(JSON.stringify({ error: "ticket_create_failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Initial message — gives the thread UI something to render and the
  // admin a single block of context. Includes the phone in the body so
  // it's visible even if the thread page doesn't pull contact_phone.
  const messageBody = [
    `طلب عرض توضيحي جديد.`,
    `الاسم: ${name}`,
    `الهاتف: ${phone}`,
    email ? `البريد: ${email}` : null,
    note ? `\nملاحظة من العميل:\n${note}` : null,
  ].filter(Boolean).join("\n");

  await adminClient
    .from("support_messages")
    .insert({
      ticket_id: ticket.id,
      author_user_id: null,
      body: messageBody,
    });

  // Email Thiqa support so the rep sees the lead in their inbox.
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
      await transporter.sendMail({
        from: `"${smtp.senderName}" <${smtp.user}>`,
        to: supportEmail,
        replyTo: email || smtp.user,
        subject: encodeMimeSubject(`[${ticket.ticket_number}] طلب عرض توضيحي — ${name}`),
        text: `طلب عرض توضيحي من ${name} (${phone}).\nرقم التذكرة: ${ticket.ticket_number}.${email ? `\nالبريد: ${email}` : ""}${note ? `\n\nملاحظة:\n${note}` : ""}`,
        html: buildEmailHtml({
          body: notifyAdminBody({
            ticketNumber: ticket.ticket_number,
            name, phone, email, note,
          }),
          footerText: "اضغط على رقم الهاتف أعلاه للاتصال مباشرة، أو افتح التذكرة من لوحة الإدارة.",
        }),
        priority: "high",
      });
    } catch (e) {
      // Don't fail the request — the ticket is already in the DB and
      // the admin can see it in /thiqa/support even if the email
      // notification didn't land.
      console.error("[public-demo-request] email send failed", e);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, ticket_number: ticket.ticket_number }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
