-- ============================================================
-- payment_session_id: ties every policy_payments row written in the
-- same تسديد المبلغ submit together. Lets the receipts page (and the
-- client profile's سجل الدفعات tab) collapse "5 cheques entered in
-- one collection event" into ONE سند قبض row instead of 5, matching
-- what a paper voucher would have looked like.
--
-- This is a finer concept than batch_id:
--   - batch_id   = one PHYSICAL cheque (possibly split across N
--                  policies by the smallest-remaining allocator)
--   - session_id = one COLLECTION EVENT (possibly N cheques + cash
--                  + visa, all handed over at the same visit)
--
-- A session contains 1+ batches. A batch contains 1+ slice rows.
-- The columns nest cleanly: session_id → batch_id → row.
-- ============================================================

ALTER TABLE public.policy_payments
  ADD COLUMN IF NOT EXISTS payment_session_id uuid;

-- Partial index — most rows will get a session_id going forward
-- (DebtPaymentModal will stamp it on every submit), and legacy
-- rows leave it NULL. The WHERE keeps the index small and only
-- useful for the displays that filter on it.
CREATE INDEX IF NOT EXISTS idx_policy_payments_session_id
  ON public.policy_payments(payment_session_id)
  WHERE payment_session_id IS NOT NULL;
