-- ─────────────────────────────────────────────────────────────
-- receipts.printed_at — track when ANY voucher has been printed
-- ─────────────────────────────────────────────────────────────
--
-- The customer سند قبض family already tracks "printed" via
-- policy_payments.printed_at (stamped on each row when the bulk
-- receipt is generated). That works for receipts that mirror
-- policy_payments, but every OTHER voucher kind
-- (credit_note / disbursement / cancellation / broker قبض+صرف)
-- had no equivalent — so the UI couldn't tell whether a non-
-- payment voucher had been printed yet and couldn't lock editing.
--
-- Adding printed_at directly on the receipts table makes the
-- "printed → immutable" rule uniform across all voucher kinds.
-- The print path stamps this column when it succeeds; the
-- Receipts page reads it to hide the تعديل menu item and only
-- expose إلغاء.
--
-- payment-type receipts can be derived from EITHER source: the
-- existing policy_payments.printed_at check stays (it stamps a row
-- per policy_payment, which the Receipts page already aggregates),
-- and the new receipts.printed_at column is layered on top — once
-- set on the canonical receipts row, the same lock applies even if
-- the legacy stamp hasn't propagated yet.

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.receipts.printed_at IS
  'When set, this voucher has been printed and edits are no longer allowed. Used by /receipts to swap تعديل out for إلغاء only.';
