-- Backfill cheque_due_date on policy_payments rows where it's still null.
--
-- Context: migration 20260509200000_cheque_due_and_issue_dates added the
-- new cheque_due_date column and one-shot backfilled it from payment_date.
-- Any cheque rows inserted between that migration and the wizard fix on
-- 2026-05-14 by a write path that mirrored to the legacy cheque_date
-- column (instead of cheque_due_date) would have cheque_due_date NULL —
-- and the generate-voucher session-expansion query was reading the legacy
-- column, so those rows printed تاريخ الاستحقاق as "—".
--
-- Code is fixed (generate-voucher now reads cheque_due_date with
-- cheque_date fallback). This migration is the data-side mirror: make
-- sure cheque_due_date itself is populated so every consumer — old or
-- new — sees the maturity date directly without relying on the fallback.

UPDATE public.policy_payments
SET cheque_due_date = COALESCE(cheque_due_date, cheque_date, payment_date)
WHERE payment_type = 'cheque'
  AND cheque_due_date IS NULL
  AND (cheque_date IS NOT NULL OR payment_date IS NOT NULL);
