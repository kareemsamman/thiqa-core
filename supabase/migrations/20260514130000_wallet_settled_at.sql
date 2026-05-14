-- ─────────────────────────────────────────────────────────────
-- customer_wallet_transactions.settled_at — explicit settlement
-- ─────────────────────────────────────────────────────────────
--
-- Before this migration the customer-page tile "مرتجع للعميل" and
-- the kashf footer "للعميل عند المكتب" both inferred wallet
-- settlement by subtracting the sum of disbursements (receipts where
-- receipt_type='disbursement') from the wallet credit total. That
-- worked when every سند صرف was the cash payout of a prior إشعار
-- دائن — but the user clarified the agency's model: each voucher is
-- an INDEPENDENT accounting event. A سند صرف can be issued for an
-- unrelated reason (e.g. paid the customer's tow fee out-of-pocket)
-- and shouldn't silently zero out a still-outstanding إشعار دائن.
--
-- This column makes settlement explicit:
--   • NULL  → the credit is still outstanding (default for every
--     credit issued from now on)
--   • timestamp → the office has settled this row, either via a
--     paired سند صرف that the user explicitly linked or by manual
--     reconciliation. The wallet tile / kashf treat settled rows as
--     paid-out and exclude them from the "نحن مدينون للعميل" total.
--
-- Existing rows are left settled_at = NULL by default — i.e.
-- treated as outstanding. If an agency has historical credits that
-- WERE settled via the prior auto-offset logic, they'll temporarily
-- resurface as outstanding until manually settled. This is the
-- user's intent: the auto-offset was producing false-zero balances
-- and they want to see every refund still on the books.

ALTER TABLE public.customer_wallet_transactions
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ NULL;

-- Common access pattern: "all outstanding refunds for client X".
-- A partial index over settled_at IS NULL keeps the index small
-- (active rows only) and matches the query the wallet tile runs.
CREATE INDEX IF NOT EXISTS customer_wallet_transactions_outstanding_idx
  ON public.customer_wallet_transactions (client_id)
  WHERE settled_at IS NULL;

COMMENT ON COLUMN public.customer_wallet_transactions.settled_at IS
  'When set, this credit has been settled (e.g. paid out via a سند صرف). NULL = still outstanding. Wallet/kashf tiles only count NULL rows toward "we owe customer".';
