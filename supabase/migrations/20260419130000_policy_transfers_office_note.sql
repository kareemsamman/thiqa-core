-- ============================================================
-- Adds an internal-only note column to policy_transfers so staff can
-- record an office-side comment (broker payouts, internal warnings,
-- handover instructions...) that is NEVER surfaced on the customer
-- invoice or SMS. The existing `note` column continues to hold the
-- customer-facing سبب التحويل text.
-- ============================================================

ALTER TABLE public.policy_transfers
  ADD COLUMN IF NOT EXISTS office_note text;

COMMENT ON COLUMN public.policy_transfers.office_note IS
  'Internal office note recorded with the transfer. Visible only on the audit row inside the app — never rendered on customer-facing invoices or SMS.';
