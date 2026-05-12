// ============================================================
// send-payment-receipt-sms
//
// Sibling to send-package-invoice-sms, but for سند قبض:
//   • Takes payment_ids (the user-added non-mandatory rows from the
//     wizard) and asks generate-bulk-payment-receipt for the PDF URL.
//   • Composes the SMS body using the same greeting + agent footer
//     shape that the invoice SMS uses, so customers get a consistent
//     look:
//
//         مرحباً {full_name}
//
//         سند قبضك: {receipt_url}
//
//         {owner_name}
//         {invoice_phones joined by " | "}
//
//   • Three modes (mutually exclusive flags):
//        skip_sms       → PDF only. Returns { receipt_url }. Used by
//                         the print icon — no SMS, no quota.
//        whatsapp_mode  → Returns { receipt_url, message_text,
//                         whatsapp_phone } so the client can open
//                         https://wa.me/{phone}?text={text} directly.
//                         No SMS, no quota.
//        default        → Sends the SMS, logs it, charges quota.
// ============================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { getAgentBranding, resolveAgentId } from "../_shared/agent-branding.ts";
import { appendSmsFooter } from "../_shared/sms-footer.ts";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { sendSms, normalizePhoneFor } from "../_shared/sms-sender.ts";
import { checkUsageLimit, limitReachedResponse, logUsage } from "../_shared/usage-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface RequestBody {
  payment_ids: string[];
  skip_sms?: boolean;
  whatsapp_mode?: boolean;
}

function normalizePhoneForWhatsapp(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "972" + digits.substring(1);
  return digits;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing authorization header" }, 401);

    const { payment_ids, skip_sms, whatsapp_mode }: RequestBody = await req.json();
    if (!payment_ids || payment_ids.length === 0) {
      return jsonResponse({ error: "payment_ids is required" }, 400);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Invalid authentication" }, 401);

    const agentId = await resolveAgentId(supabase, user.id);
    if (!agentId) return jsonResponse({ error: "Could not resolve agent" }, 404);

    // Resolve client (and the policy's branch) from the first payment row —
    // all rows in this batch belong to one policy / one client by construction.
    const { data: firstPayment, error: paymentError } = await supabase
      .from("policy_payments")
      .select(`
        branch_id,
        policy:policies(
          id,
          branch_id,
          client:clients(id, full_name, phone_number)
        )
      `)
      .eq("id", payment_ids[0])
      .maybeSingle();

    if (paymentError || !firstPayment) {
      console.error("[send-payment-receipt-sms] Payment lookup failed:", paymentError);
      return jsonResponse({ error: "لم يتم العثور على الدفعة" }, 404);
    }

    const policy = (firstPayment as any).policy;
    const client = policy?.client;
    if (!client) return jsonResponse({ error: "لم يتم العثور على بيانات العميل" }, 404);

    // Phone is mandatory for SMS + WhatsApp paths (the wa.me URL needs a
    // destination); print-only mode can run without one.
    if ((!skip_sms || whatsapp_mode) && !client.phone_number) {
      return jsonResponse({ error: "رقم هاتف العميل مطلوب" }, 400);
    }

    // Enforce SMS quota up front so we don't spend the receipt-generation
    // round-trip when the agent can't actually send. WhatsApp + print-only
    // bypass both quota and credential checks — same shape as the
    // invoice SMS function.
    if (!skip_sms && !whatsapp_mode) {
      const smsCheck = await checkUsageLimit(supabase, agentId, "sms");
      if (!smsCheck.allowed) return limitReachedResponse("sms", smsCheck, corsHeaders);
    }

    // Generate the receipt PDF by delegating to the existing function —
    // do not duplicate the template logic here. We invoke via supabase
    // client so auth/JWT propagation matches all other internal calls.
    const receiptResult = await supabase.functions.invoke(
      "generate-bulk-payment-receipt",
      { body: { payment_ids } },
    );
    if (receiptResult.error) {
      console.error("[send-payment-receipt-sms] generate-bulk-payment-receipt failed:", receiptResult.error);
      return jsonResponse({ error: "فشل في توليد سند القبض" }, 500);
    }
    const receipt_url = (receiptResult.data as any)?.receipt_url;
    if (!receipt_url) {
      return jsonResponse({ error: "لم يتم العثور على رابط السند" }, 500);
    }

    // Print-only path: hand back the URL, nothing else to do.
    if (skip_sms && !whatsapp_mode) {
      return jsonResponse({
        success: true,
        mode: "print",
        receipt_url,
        duration_ms: Date.now() - startTime,
      });
    }

    // Compose the SMS body. Greeting + receipt URL + branded footer —
    // matches the shape of the invoice SMS so customers see a
    // consistent voice from the agency.
    const branding = await getAgentBranding(supabase, agentId);
    let messageBody = `مرحباً ${client.full_name}\n\nسند قبضك: ${receipt_url}`;
    messageBody = appendSmsFooter(messageBody, branding);

    if (whatsapp_mode) {
      return jsonResponse({
        success: true,
        mode: "whatsapp",
        message_text: messageBody,
        whatsapp_phone: normalizePhoneForWhatsapp(client.phone_number),
        receipt_url,
        duration_ms: Date.now() - startTime,
      });
    }

    // Default: real SMS send.
    const smsSettings = await resolveSmsSettings(supabase, agentId);
    if (!smsSettings || !smsSettings.is_enabled) {
      return jsonResponse({ error: "خدمة الرسائل غير مفعلة" }, 400);
    }

    const sendResult = await sendSms(smsSettings, client.phone_number, messageBody);
    if (!sendResult.success) {
      console.error(`[send-payment-receipt-sms] SMS failed via ${sendResult.provider}: ${sendResult.error}`);
      return jsonResponse({ error: sendResult.error || "خطأ في إرسال الرسالة" }, 400);
    }

    // sms_logs.sms_type is a fixed enum (see migration 20251223133728).
    // 'receipt' isn't on it; 'invoice' is the closest existing slot and
    // is already used by the sibling invoice function — keeps these two
    // dashboards/queries on the same lane.
    await supabase.from("sms_logs").insert({
      agent_id: agentId,
      branch_id: policy?.branch_id || (firstPayment as any).branch_id || null,
      client_id: client.id,
      policy_id: policy?.id || null,
      phone_number: normalizePhoneFor(smsSettings.provider, client.phone_number),
      message: messageBody,
      sms_type: "invoice",
      status: "sent",
      sent_at: new Date().toISOString(),
    });

    await logUsage(supabase, agentId, "sms");

    return jsonResponse({
      success: true,
      mode: "sms",
      receipt_url,
      message_text: messageBody,
      duration_ms: Date.now() - startTime,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[send-payment-receipt-sms] Unhandled error:", err);
    return jsonResponse({ error: message }, 500);
  }
});
