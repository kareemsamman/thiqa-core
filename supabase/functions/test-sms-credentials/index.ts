// Test-SMS-Credentials — thiqa super admin only.
// Takes a provider + credentials + phone in the body and attempts to
// deliver a test message, without touching any stored settings. Used
// by /thiqa/settings to verify credentials before saving them.
//
// This function is intentionally self-contained (no imports from
// ../_shared) so that a deploy of this single directory always works
// even if the shared helpers haven't rolled out yet.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Provider = "019" | "htd";

interface TestRequest {
  provider?: string;
  phone: string;
  message?: string;
  sms_user?: string;
  sms_token?: string;
  sms_source?: string;
  htd_id?: string;
  htd_sender?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(provider: Provider, phone: string): string {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (provider === "htd") {
    if (digits.startsWith("972")) return digits;
    if (digits.startsWith("0")) return "972" + digits.slice(1);
    return digits;
  }
  if (digits.startsWith("972")) return "0" + digits.slice(3);
  return digits;
}

function escapeXml(v: string): string {
  return (v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractXmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m?.[1]?.trim() ?? null;
}

async function send019(
  user: string,
  token: string,
  source: string,
  phone: string,
  message: string,
) {
  const dlr = crypto.randomUUID();
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sms>` +
    `<user><username>${escapeXml(user)}</username></user>` +
    `<source>${escapeXml(source)}</source>` +
    `<destinations><phone id="${dlr}">${escapeXml(phone)}</phone></destinations>` +
    `<message>${escapeXml(message)}</message>` +
    `</sms>`;

  const res = await fetch("https://019sms.co.il/api", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: xml,
  });
  const raw = await res.text();
  const status = extractXmlTag(raw, "status");
  const apiMessage = extractXmlTag(raw, "message");
  const shipmentId = extractXmlTag(raw, "shipment_id");
  const success = res.ok && status === "0";
  return {
    success,
    httpStatus: res.status,
    apiMessage,
    shipmentId,
    raw,
    error: success ? null : (apiMessage || `019 error (status=${status ?? "unknown"})`),
  };
}

async function sendHtd(
  id: string,
  sender: string,
  phone: string,
  message: string,
) {
  const body = new URLSearchParams({
    id,
    sender,
    to: phone,
    msg: message,
    mode: "0",
  });
  const res = await fetch("https://sms.htd.ps/API/SendSMS.aspx", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const raw = (await res.text()).trim();
  const success = res.ok && /message sent successfully/i.test(raw);
  return {
    success,
    httpStatus: res.status,
    apiMessage: raw || null,
    shipmentId: null as string | null,
    raw,
    error: success ? null : (raw || `HTD error (http=${res.status})`),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user?.email) return json({ error: "Invalid auth" }, 401);

    // Super admin gate.
    const { data: sa } = await supabase
      .from("thiqa_super_admins")
      .select("email")
      .eq("email", user.email.toLowerCase())
      .maybeSingle();
    if (!sa) return json({ error: "Forbidden" }, 403);

    const body = (await req.json()) as TestRequest;
    if (!body.phone) return json({ error: "phone is required" }, 400);

    const provider: Provider = String(body.provider ?? "").toLowerCase() === "htd" ? "htd" : "019";

    if (provider === "htd") {
      if (!body.htd_id || !body.htd_sender) {
        return json({ error: "HTD credentials are required (API ID + Sender)" }, 400);
      }
    } else if (!body.sms_user || !body.sms_token || !body.sms_source) {
      return json({ error: "019 credentials are required (user + token + source)" }, 400);
    }

    const cleanPhone = normalizePhone(provider, body.phone);
    if (!cleanPhone) return json({ error: "Invalid phone number" }, 400);

    const message = body.message?.trim() ||
      `رسالة اختبار من منصة ثقة عبر ${provider === "htd" ? "HTD" : "019sms"}`;

    const result = provider === "htd"
      ? await sendHtd(body.htd_id!, body.htd_sender!, cleanPhone, message)
      : await send019(body.sms_user!, body.sms_token!, body.sms_source!, cleanPhone, message);

    if (!result.success) {
      return json({
        success: false,
        provider,
        phone: cleanPhone,
        error: result.error,
        raw: result.raw,
        http_status: result.httpStatus,
      }, 400);
    }

    return json({
      success: true,
      provider,
      phone: cleanPhone,
      api_message: result.apiMessage,
      shipment_id: result.shipmentId,
      raw: result.raw,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    console.error("[test-sms-credentials] fatal:", error);
    return json({ error }, 500);
  }
});
