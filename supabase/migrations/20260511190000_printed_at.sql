-- ============================================================
-- printed_at: when a session's سند قبض has been physically printed
-- (the user clicked "طباعة سندات القبض" on the row). Once stamped
-- the receipt is treated as immutable — the "تعديل" entry on the
-- dropdown locks out, only "إلغاء السند" stays available. The
-- bookkeeper's rule we agreed on earlier: printed → no edits, only
-- a paired cancellation voucher.
--
-- The column lives on policy_payments because that's where the
-- session_id and per-row state lives. To mark a session printed we
-- UPDATE every row sharing that payment_session_id. The display
-- side considers the group printed when any of its rows is stamped.
-- SMS auto-receipts deliberately don't set this — only the explicit
-- طباعة button counts as "printed".
-- ============================================================

ALTER TABLE public.policy_payments
  ADD COLUMN IF NOT EXISTS printed_at timestamptz;
