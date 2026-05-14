// ============================================================
// send-credit-note-sms
//
// Sibling to send-payment-receipt-sms, but for إشعار دائن:
//   • Takes voucher_receipt_id (receipts.id where receipt_type =
//     'credit_note') and asks generate-credit-note-voucher for the
//     printable PDF URL.
//   • Composes the SMS body with the same greeting + agent footer
//     shape that the payment-receipt SMS uses so customers see a
//     consistent voice from the agency:
//
//         مرحباً {full_name}
//
//         إشعار دائن: {receipt_url}
//
//         {owner_name}
//         {invoice_phones joined by " | "}
//
//   • Three modes (mutually exclusive flags) — same as the payment
//     receipt sibling:
//        skip_sms       → PDF only. Returns { receipt_url }.
//        whatsapp_mode  → Returns { receipt_url, message_text,
//                         whatsapp_phone } for wa.me deep-linking.
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
  voucher_receipt_id: string;
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

    const { voucher_receipt_id, skip_sms, whatsapp_mode }: RequestBody = await req.json();
    if (!voucher_receipt_id) {
      return jsonResponse({ error: "voucher_receipt_id is required" }, 400);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Invalid authentication" }, 401);

    const agentId = await resolveAgentId(supabase, user.id);
    if (!agentId) return jsonResponse({ error: "Could not resolve agent" }, 404);

    // Pull the credit_note row + linked client. client_id is on the
    // receipts row directly (CancelPolicyModal / TransferPolicyModal
    // both stamp it); fall back to policy → clients defensively if
    // an older row somehow lacks it.
    const { data: voucherRow, error: voucherErr } = await supabase
      .from("receipts")
      .select(`
        id, receipt_type, client_id, policy_id, branch_id, voucher_number,
        client:clients(id, full_name, phone_number),
        policy:policies(id, branch_id, client:clients(id, full_name, phone_number))
      `)
      .eq("id", voucher_receipt_id)
      .maybeSingle();

    if (voucherErr || !voucherRow) {
      console.error("[send-credit-note-sms] Voucher lookup failed:", voucherErr);
      return jsonResponse({ error: "لم يتم العثور على الإشعار" }, 404);
    }
    if (voucherRow.receipt_type !== "credit_note") {
      return jsonResponse({ error: "السند ليس إشعار دائن" }, 400);
    }

    const directClient = Array.isArray((voucherRow as any).client)
      ? (voucherRow as any).client[0]
      : (voucherRow as any).client;
    const policyClientWrap = Array.isArray((voucherRow as any).policy)
      ? (voucherRow as any).policy[0]
      : (voucherRow as any).policy;
    const policyClient = policyClientWrap
      ? (Array.isArray(policyClientWrap.client) ? policyClientWrap.client[0] : policyClientWrap.client)
      : null;
    const client = directClient || policyClient;
    if (!client) return jsonResponse({ error: "لم يتم العثور على بيانات العميل" }, 404);

    // Phone is mandatory for SMS + WhatsApp paths. Print-only skips it.
    if ((!skip_sms || whatsapp_mode) && !client.phone_number) {
      return jsonResponse({ error: "رقم هاتف العميل مطلوب" }, 400);
    }

    // Enforce SMS quota up front — same shape as send-payment-receipt-sms.
    if (!skip_sms && !whatsapp_mode) {
      const smsCheck = await checkUsageLimit(supabase, agentId, "sms");
      if (!smsCheck.allowed) return limitReachedResponse("sms", smsCheck, corsHeaders);
    }

    // Generate the credit-note PDF by delegating to the existing
    // function. Forward the caller's Authorization header (instead of
    // the service-role key) so the target's auth.getUser resolves a
    // real user — same pattern the payment-receipt sibling uses.
    let receiptData: any = null;
    let receiptErrorText = "";
    try {
      const receiptResp = await fetch(
        `${supabaseUrl}/functions/v1/generate-credit-note-voucher`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ voucher_receipt_id }),
        },
      );
      const text = await receiptResp.text();
      try {
        receiptData = JSON.parse(text);
      } catch {
        receiptErrorText = text;
      }
      if (!receiptResp.ok) {
        console.error(
          "[send-credit-note-sms] generate-credit-note-voucher non-2xx:",
          receiptResp.status,
          receiptData ?? receiptErrorText,
        );
        const detail = receiptData?.error || receiptErrorText || `status ${receiptResp.status}`;
        return jsonResponse({ error: `فشل في توليد الإشعار: ${detail}` }, 500);
      }
    } catch (err) {
      console.error("[send-credit-note-sms] receipt fetch failed:", err);
      return jsonResponse({ error: "فشل في توليد الإشعار" }, 500);
    }
    const receipt_url = receiptData?.receipt_url;
    if (!receipt_url) {
      return jsonResponse({ error: "لم يتم العثور على رابط الإشعار" }, 500);
    }

    if (skip_sms && !whatsapp_mode) {
      return jsonResponse({
        success: true,
        mode: "print",
        receipt_url,
        duration_ms: Date.now() - startTime,
      });
    }

    const branding = await getAgentBranding(supabase, agentId);
    let messageBody = `مرحباً ${client.full_name}\n\nإشعار دائن: ${receipt_url}`;
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

    const smsSettings = await resolveSmsSettings(supabase, agentId);
    if (!smsSettings || !smsSettings.is_enabled) {
      return jsonResponse({ error: "خدمة الرسائل غير مفعلة" }, 400);
    }

    const sendResult = await sendSms(smsSettings, client.phone_number, messageBody);
    if (!sendResult.success) {
      console.error(`[send-credit-note-sms] SMS failed via ${sendResult.provider}: ${sendResult.error}`);
      return jsonResponse({ error: sendResult.error || "خطأ في إرسال الرسالة" }, 400);
    }

    // sms_logs.sms_type is a fixed enum; 'invoice' is the closest
    // existing slot and is already shared with the payment-receipt
    // sibling — keeps the dashboards on the same lane.
    await supabase.from("sms_logs").insert({
      agent_id: agentId,
      branch_id: voucherRow.branch_id || policyClientWrap?.branch_id || null,
      client_id: client.id,
      policy_id: voucherRow.policy_id || null,
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
    console.error("[send-credit-note-sms] Unhandled error:", err);
    return jsonResponse({ error: message }, 500);
  }
});
