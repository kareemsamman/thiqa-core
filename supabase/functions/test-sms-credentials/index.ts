// Test-SMS-Credentials — thiqa super admin only.
// Takes a provider + credentials + phone in the body and attempts to
// deliver a test message, without touching any stored settings. Used
// by /thiqa/settings to verify credentials before saving them.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import type { ResolvedSmsSettings, SmsProvider } from "../_shared/sms-settings.ts";
import { sendSms, normalizePhoneFor } from "../_shared/sms-sender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TestRequest {
  provider: SmsProvider | "019sms";
  phone: string;
  message?: string;
  // 019
  sms_user?: string;
  sms_token?: string;
  sms_source?: string;
  // HTD
  htd_id?: string;
  htd_sender?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    // Super admin gate — matches the check used elsewhere for Thiqa-only pages.
    const { data: sa } = await supabase
      .from("thiqa_super_admins")
      .select("email")
      .eq("email", user.email.toLowerCase())
      .maybeSingle();
    if (!sa) return json({ error: "Forbidden" }, 403);

    const body = (await req.json()) as TestRequest;
    if (!body.phone) return json({ error: "phone is required" }, 400);

    const provider: SmsProvider = body.provider === "htd" ? "htd" : "019";

    // Validate the credentials we actually need for the chosen provider.
    if (provider === "htd") {
      if (!body.htd_id || !body.htd_sender) {
        return json({ error: "HTD credentials are required (API ID + Sender)" }, 400);
      }
    } else if (!body.sms_user || !body.sms_token || !body.sms_source) {
      return json({ error: "019 credentials are required (user + token + source)" }, 400);
    }

    const settings: ResolvedSmsSettings = {
      provider,
      is_enabled: true,
      sms_user: body.sms_user ?? "",
      sms_token: body.sms_token ?? "",
      sms_source: body.sms_source ?? "",
      htd_id: body.htd_id ?? "",
      htd_sender: body.htd_sender ?? "",
    };

    const message = body.message?.trim() ||
      `رسالة اختبار من منصة ثقة عبر ${provider === "htd" ? "HTD" : "019sms"} — ${new Date().toLocaleString("ar")}`;

    const cleanPhone = normalizePhoneFor(provider, body.phone);
    const result = await sendSms(settings, body.phone, message);

    if (!result.success) {
      return json({
        success: false,
        provider: result.provider,
        phone: cleanPhone,
        error: result.error,
        raw: result.rawResponse,
        http_status: result.httpStatus,
      }, 400);
    }

    return json({
      success: true,
      provider: result.provider,
      phone: cleanPhone,
      api_message: result.apiMessage,
      shipment_id: result.shipmentId,
      raw: result.rawResponse,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    return json({ error }, 500);
  }
});
