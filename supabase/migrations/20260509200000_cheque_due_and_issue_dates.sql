-- Add cheque_due_date (تاريخ الاستحقاق) and cheque_issue_date (تاريخ الإصدار)
-- to every table that stores cheque payments. Until now the UI captured
-- both dates but only one column existed, so the due date was silently
-- dropped on every cheque entered through the settlement / expense /
-- customer-cheque dialogs. The Cheques page renders cheque_due_date
-- under the "تاريخ الاستحقاق" column going forward.
--
-- Backfill rule: for existing cheque rows we set both new columns to
-- the legacy single date column (payment_date / settlement_date /
-- expense_date) so the new UI keeps showing the same dates the user
-- saw before — only after they edit a row will the two diverge.

ALTER TABLE public.policy_payments
  ADD COLUMN IF NOT EXISTS cheque_due_date DATE,
  ADD COLUMN IF NOT EXISTS cheque_issue_date DATE;

UPDATE public.policy_payments
SET
  cheque_due_date = COALESCE(cheque_due_date, payment_date),
  cheque_issue_date = COALESCE(cheque_issue_date, payment_date)
WHERE payment_type = 'cheque'
  AND (cheque_due_date IS NULL OR cheque_issue_date IS NULL);

ALTER TABLE public.company_settlements
  ADD COLUMN IF NOT EXISTS cheque_due_date DATE,
  ADD COLUMN IF NOT EXISTS cheque_issue_date DATE;

UPDATE public.company_settlements
SET
  cheque_due_date = COALESCE(cheque_due_date, settlement_date),
  cheque_issue_date = COALESCE(cheque_issue_date, settlement_date)
WHERE payment_type = 'cheque'
  AND (cheque_due_date IS NULL OR cheque_issue_date IS NULL);

ALTER TABLE public.broker_settlements
  ADD COLUMN IF NOT EXISTS cheque_due_date DATE,
  ADD COLUMN IF NOT EXISTS cheque_issue_date DATE;

UPDATE public.broker_settlements
SET
  cheque_due_date = COALESCE(cheque_due_date, settlement_date),
  cheque_issue_date = COALESCE(cheque_issue_date, settlement_date)
WHERE payment_type = 'cheque'
  AND (cheque_due_date IS NULL OR cheque_issue_date IS NULL);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS cheque_due_date DATE,
  ADD COLUMN IF NOT EXISTS cheque_issue_date DATE;

UPDATE public.expenses
SET
  cheque_due_date = COALESCE(cheque_due_date, expense_date),
  cheque_issue_date = COALESCE(cheque_issue_date, expense_date)
WHERE payment_method = 'cheque'
  AND (cheque_due_date IS NULL OR cheque_issue_date IS NULL);

-- Index the due-date column on the customer-cheque table since the
-- cheques list page filters/orders by it.
CREATE INDEX IF NOT EXISTS idx_policy_payments_cheque_due_date
  ON public.policy_payments (cheque_due_date)
  WHERE payment_type = 'cheque';
