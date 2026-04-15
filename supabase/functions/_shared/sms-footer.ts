/**
 * Shared helper to append an agent-branded footer to every outgoing SMS.
 *
 * Footer format (Arabic, newline-separated) — built from site_settings:
 *   <blank line>
 *   <owner_name>
 *   <invoice_phones joined by " | ">
 *
 * Deliberately excludes tax / operator number — staff asked for a
 * customer-facing signature, not a legal header.
 *
 * OTP flows (auth-sms-start, sms-verify-phone) do NOT call this — login
 * codes must stay short and have no agent context anyway.
 */

import type { AgentBranding } from "./agent-branding.ts";

export function buildSmsFooter(branding: Pick<AgentBranding, "ownerName" | "invoicePhones">): string {
  const lines: string[] = [];

  const name = (branding.ownerName || "").trim();
  if (name) lines.push(name);

  const phones = (branding.invoicePhones || [])
    .map((p) => (p || "").trim())
    .filter(Boolean);
  if (phones.length > 0) lines.push(phones.join(" | "));

  return lines.join("\n");
}

export function appendSmsFooter(
  message: string,
  branding: Pick<AgentBranding, "ownerName" | "invoicePhones">,
): string {
  const footer = buildSmsFooter(branding);
  if (!footer) return message;
  return `${message}\n\n${footer}`;
}
