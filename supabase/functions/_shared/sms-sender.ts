/**
 * Unified SMS sender. Dispatches to the right provider based on the
 * resolved settings from `resolveSmsSettings`.
 *
 * Call sites should only ever talk to `sendSms` — never build provider
 * XML / URL payloads themselves. That keeps the provider switch a
 * single-file change and ensures every flow (manual, invoice, OTP,
 * cron, marketing, etc.) respects the agent's / platform's choice.
 */

import type { ResolvedSmsSettings, SmsProvider } from "./sms-settings.ts";

export interface SendSmsResult {
  success: boolean;
  provider: SmsProvider;
  httpStatus: number;
  /** Human-readable message returned by the provider (if any). */
  apiMessage?: string | null;
  /** Provider-side identifier for the delivery (019 shipment_id / HTD message id). */
  shipmentId?: string | null;
  /** Raw response body, useful for logging. */
  rawResponse: string;
  /** Error string to surface to the caller when success===false. */
  error?: string;
}

// ─── Phone normalization ──────────────────────────────────────────────
// 019 expects Israeli local format (05xxxxxxx).
// HTD expects international without '+' (972500000000).
export function normalizePhoneFor(provider: SmsProvider, phone: string): string {
  const digits = (phone ?? '').replace(/[^0-9]/g, '');
  if (!digits) return '';

  if (provider === 'htd') {
    // HTD wants international: convert 05xxxxxxx → 9725xxxxxxx,
    // keep existing 972xxxxxxxx, strip leading '+' if already digits-only.
    if (digits.startsWith('972')) return digits;
    if (digits.startsWith('0')) return '972' + digits.slice(1);
    return digits;
  }

  // 019 wants local: convert 972xxxxxxxx → 0xxxxxxxx.
  if (digits.startsWith('972')) return '0' + digits.slice(3);
  return digits;
}

// ─── 019sms provider ──────────────────────────────────────────────────
function escapeXml(value: string): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractXmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1]?.trim() ?? null;
}

async function send019(
  settings: ResolvedSmsSettings,
  phone: string,
  message: string,
): Promise<SendSmsResult> {
  const dlr = crypto.randomUUID();
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sms>` +
    `<user><username>${escapeXml(settings.sms_user)}</username></user>` +
    `<source>${escapeXml(settings.sms_source)}</source>` +
    `<destinations><phone id="${dlr}">${escapeXml(phone)}</phone></destinations>` +
    `<message>${escapeXml(message)}</message>` +
    `</sms>`;

  const response = await fetch('https://019sms.co.il/api', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.sms_token}`,
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: xml,
  });

  const raw = await response.text();
  const status = extractXmlTag(raw, 'status');
  const apiMessage = extractXmlTag(raw, 'message');
  const shipmentId = extractXmlTag(raw, 'shipment_id');
  const success = response.ok && status === '0';

  return {
    success,
    provider: '019',
    httpStatus: response.status,
    apiMessage,
    shipmentId,
    rawResponse: raw,
    error: success ? undefined : (apiMessage || `019 error (status=${status ?? 'unknown'})`),
  };
}

// ─── HTD provider ─────────────────────────────────────────────────────
// HTD HTTP API: https://sms.HTD.ps/API/SendSMS.aspx (GET/POST)
// Params: id, sender, to, msg, mode=0 (single dest, simple response)
// Success response body starts with "Message Sent Successfully".
// Everything else is treated as an error (Authentication Failed,
// Insufficient Credit, Invalid Recipient, IP Not Allowed, …).
async function sendHtd(
  settings: ResolvedSmsSettings,
  phone: string,
  message: string,
): Promise<SendSmsResult> {
  const body = new URLSearchParams({
    id: settings.htd_id,
    sender: settings.htd_sender,
    to: phone,
    msg: message,
    mode: '0',
  });

  const response = await fetch('https://sms.htd.ps/API/SendSMS.aspx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const raw = (await response.text()).trim();
  // HTD returns plain text. "Message Sent Successfully" is the only success
  // response; anything else (even with HTTP 200) is an error.
  const success = response.ok && /message sent successfully/i.test(raw);

  return {
    success,
    provider: 'htd',
    httpStatus: response.status,
    apiMessage: raw || null,
    shipmentId: null,
    rawResponse: raw,
    error: success ? undefined : (raw || `HTD error (http=${response.status})`),
  };
}

// ─── Public entry point ───────────────────────────────────────────────
export async function sendSms(
  settings: ResolvedSmsSettings,
  phone: string,
  message: string,
): Promise<SendSmsResult> {
  const normalized = normalizePhoneFor(settings.provider, phone);
  if (!normalized) {
    return {
      success: false,
      provider: settings.provider,
      httpStatus: 0,
      rawResponse: '',
      error: 'Invalid phone number',
    };
  }

  try {
    return settings.provider === 'htd'
      ? await sendHtd(settings, normalized, message)
      : await send019(settings, normalized, message);
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown SMS send error';
    return {
      success: false,
      provider: settings.provider,
      httpStatus: 0,
      rawResponse: '',
      error,
    };
  }
}
