// ============================================================
// send-voucher
//
// Unified SMS / WhatsApp / print wrapper for every voucher kind
// (سند قبض / سند صرف / إشعار دائن / سند إلغاء) across every
// counterparty type (client / broker / company-future / other-
// future). Replaces the three per-kind wrappers (send-payment-
// receipt-sms / send-disbursement-sms / send-credit-note-sms) by
// reading the receipts row and branching on receipt_type +
// available foreign keys (client_id / broker_id) for both the
// phone-number resolution and the message text.
//
// Modes (mutually exclusive):
//   skip_sms      → returns { receipt_url } only (print path)
//   whatsapp_mode → returns { whatsapp_phone, message_text, receipt_url }
//   default       → sends the SMS via the agency's configured
//                   provider, logs usage, returns confirmation
//
// receipts.printed_at gets stamped on EVERY path that actually
// produces or delivers a copy — print (via generate-voucher), SMS
// (here, after a successful send), or WhatsApp open (here, when we
// hand off the message_text to the client). Mirrors the user's
// rule: once a voucher leaves the office in any form, it's sealed.
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
  voucher_receipt_id?: string;
  /** Legacy alternative — same as the bulk-payment-receipt input
   *  shape. Resolves to the canonical receipts row via the same
   *  logic as generate-voucher. */
  payment_ids?: string[];
  skip_sms?: boolean;
  whatsapp_mode?: boolean;
}

// Per-kind copy. Each entry yields the receipt-line label
// inserted into the SMS body and the noun the post-send log uses.
const VOUCHER_LABELS: Record<string, { line: string; noun: string }> = {
  payment: { line: 'سند القبض', noun: 'سند القبض' },
  disbursement: { line: 'سند الصرف', noun: 'سند الصرف' },
  credit_note: { line: 'إشعار الدائن', noun: 'إشعار الدائن' },
  cancellation: { line: 'سند الإلغاء', noun: 'سند الإلغاء' },
};

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

    const body = await req.json() as RequestBody;
    let voucher_receipt_id = body.voucher_receipt_id;

    // payment_ids fallback — mirrors generate-voucher's behavior so
    // callers that historically used the bulk-receipt contract can
    // swap function name with no shape change.
    if (!voucher_receipt_id && body.payment_ids && body.payment_ids.length > 0) {
      const { data: matching } = await supabase
        .from('receipts')
        .select('id')
        .in('payment_id', body.payment_ids)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (matching?.id) voucher_receipt_id = matching.id as string;
    }

    if (!voucher_receipt_id) {
      return jsonResponse({ error: "voucher_receipt_id (or payment_ids) is required" }, 400);
    }
    const { skip_sms, whatsapp_mode } = body;

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return jsonResponse({ error: "Invalid authentication" }, 401);

    const agentId = await resolveAgentId(supabase, user.id);
    if (!agentId) return jsonResponse({ error: "Could not resolve agent" }, 404);

    // Pull the receipt + the two possible counterparty rows in one
    // shot. Either client_id or broker_id will be set; the policy
    // join is a defensive fallback for legacy receipts that lack
    // client_id but still belong to a policy.
    const { data: voucherRow, error: voucherErr } = await supabase
      .from("receipts")
      .select(`
        id, receipt_type, receipt_number, voucher_number,
        client_id, client_name, broker_id, policy_id, branch_id,
        amount, receipt_date,
        client:clients(id, full_name, phone_number),
        broker:brokers(id, name, phone),
        policy:policies(id, branch_id, client:clients(id, full_name, phone_number))
      `)
      .eq("id", voucher_receipt_id)
      .maybeSingle();

    if (voucherErr || !voucherRow) {
      console.error("[send-voucher] Voucher lookup failed:", voucherErr);
      return jsonResponse({ error: "لم يتم العثور على السند" }, 404);
    }

    const receiptType = (voucherRow.receipt_type as string) || 'payment';
    const labels = VOUCHER_LABELS[receiptType] || VOUCHER_LABELS.payment;

    // Resolve display name + phone. Priority:
    //   1. Direct client (clients.phone_number)
    //   2. Direct broker (brokers.phone)
    //   3. Policy → client (legacy receipts missing client_id)
    //   4. receipts.client_name as display only (no phone)
    const directClient = Array.isArray((voucherRow as any).client)
      ? (voucherRow as any).client[0]
      : (voucherRow as any).client;
    const directBroker = Array.isArray((voucherRow as any).broker)
      ? (voucherRow as any).broker[0]
      : (voucherRow as any).broker;
    const policyWrap = Array.isArray((voucherRow as any).policy)
      ? (voucherRow as any).policy[0]
      : (voucherRow as any).policy;
    const policyClient = policyWrap
      ? (Array.isArray(policyWrap.client) ? policyWrap.client[0] : policyWrap.client)
      : null;

    let recipientName: string | null = null;
    let recipientPhone: string | null = null;
    let recipientClientId: string | null = null;
    if (directClient) {
      recipientName = directClient.full_name || null;
      recipientPhone = directClient.phone_number || null;
      recipientClientId = directClient.id || null;
    } else if (directBroker) {
      recipientName = directBroker.name || null;
      recipientPhone = directBroker.phone || null;
    } else if (policyClient) {
      recipientName = policyClient.full_name || null;
      recipientPhone = policyClient.phone_number || null;
      recipientClientId = policyClient.id || null;
    } else {
      recipientName = (voucherRow.client_name as string) || null;
    }

    if (!recipientName) recipientName = '-';

    // SMS / WhatsApp paths need a phone. The print-only path does
    // not, so we only enforce the check when actually delivering.
    if ((!skip_sms || whatsapp_mode) && !recipientPhone) {
      return jsonResponse({ error: "لا يوجد رقم هاتف للجهة" }, 400);
    }

    // SMS quota — only relevant for the SMS path; print and
    // WhatsApp don't consume quota.
    if (!skip_sms && !whatsapp_mode) {
      const smsCheck = await checkUsageLimit(supabase, agentId, "sms");
      if (!smsCheck.allowed) return limitReachedResponse("sms", smsCheck, corsHeaders);
    }

    // Always call generate-voucher for the URL — it also stamps
    // receipts.printed_at on success, so the "printed = immutable"
    // lock kicks in regardless of whether the user takes the
    // print / SMS / WhatsApp branch below.
    let receiptData: any = null;
    let receiptErrorText = "";
    try {
      const receiptResp = await fetch(
        `${supabaseUrl}/functions/v1/generate-voucher`,
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
          `[send-voucher] generate-voucher non-2xx:`,
          receiptResp.status,
          receiptData ?? receiptErrorText,
        );
        const detail = receiptData?.error || receiptErrorText || `status ${receiptResp.status}`;
        return jsonResponse({ error: `فشل في توليد ${labels.noun}: ${detail}` }, 500);
      }
    } catch (err) {
      console.error(`[send-voucher] receipt fetch failed:`, err);
      return jsonResponse({ error: `فشل في توليد ${labels.noun}` }, 500);
    }
    const receipt_url = receiptData?.receipt_url;
    if (!receipt_url) {
      return jsonResponse({ error: "لم يتم العثور على رابط السند" }, 500);
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
    let messageBody = `مرحباً ${recipientName}\n\n${labels.line}: ${receipt_url}`;
    messageBody = appendSmsFooter(messageBody, branding);

    if (whatsapp_mode) {
      // WhatsApp is a hand-off — we can't verify the message was
      // actually sent. Stamp printed_at anyway because the user
      // clicked the "send via WhatsApp" affordance and we already
      // produced a deliverable URL; the receipt is effectively
      // out of the office's vault.
      await supabase
        .from('receipts')
        .update({ printed_at: new Date().toISOString() })
        .eq('id', voucher_receipt_id)
        .is('printed_at', null);
      return jsonResponse({
        success: true,
        mode: "whatsapp",
        message_text: messageBody,
        whatsapp_phone: normalizePhoneForWhatsapp(recipientPhone!),
        receipt_url,
        duration_ms: Date.now() - startTime,
      });
    }

    const smsSettings = await resolveSmsSettings(supabase, agentId);
    if (!smsSettings || !smsSettings.is_enabled) {
      return jsonResponse({ error: "خدمة الرسائل غير مفعلة" }, 400);
    }

    const sendResult = await sendSms(smsSettings, recipientPhone!, messageBody);
    if (!sendResult.success) {
      console.error(
        `[send-voucher] SMS failed via ${sendResult.provider}: ${sendResult.error}`,
      );
      return jsonResponse({ error: sendResult.error || "خطأ في إرسال الرسالة" }, 400);
    }

    // SMS sent → stamp printed_at + log to sms_logs.
    await supabase
      .from('receipts')
      .update({ printed_at: new Date().toISOString() })
      .eq('id', voucher_receipt_id)
      .is('printed_at', null);

    await supabase.from("sms_logs").insert({
      agent_id: agentId,
      branch_id: voucherRow.branch_id || policyWrap?.branch_id || null,
      client_id: recipientClientId,
      policy_id: voucherRow.policy_id || null,
      phone_number: normalizePhoneFor(smsSettings.provider, recipientPhone!),
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
      duration_ms: Date.now() - startTime,
    });
  } catch (error: unknown) {
    console.error("[send-voucher] Fatal:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return jsonResponse({ error: message }, 500);
  }
});
