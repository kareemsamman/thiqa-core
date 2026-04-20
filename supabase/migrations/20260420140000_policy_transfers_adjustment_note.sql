-- Add a dedicated column for the "ملاحظة للتعديل المالي" field the
-- transfer modal has always collected but never persisted for the
-- customer-pays case (previously it only rode on
-- customer_wallet_transactions.notes, and only for refunds).
-- Internal-only — mirrors office_note in that it never appears on
-- customer-facing invoice output, only on the office's own views.

ALTER TABLE public.policy_transfers
  ADD COLUMN IF NOT EXISTS adjustment_note TEXT;

COMMENT ON COLUMN public.policy_transfers.adjustment_note IS
  'Internal note explaining why the customer was charged / refunded the adjustment_amount (e.g. "new car is more expensive"). Never shown on invoice.';
