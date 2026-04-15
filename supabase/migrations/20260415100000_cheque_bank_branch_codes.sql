-- Add bank/branch code columns to every table that stores a cheque.
--
-- Real Israeli/Palestinian cheques have three identifying numbers:
--   * bank code (2 digits, e.g. "12" = Hapoalim)
--   * branch code (3 digits, assigned by the bank)
--   * cheque serial (printed on the cheque)
-- Previously we only stored the serial (`cheque_number`), which made it
-- impossible for the UI to show the issuing bank/branch. Add free-text
-- `bank_code` and `branch_code` columns on every cheque-bearing table so
-- the frontend can offer a bank picker at entry time and a lookup at
-- display time. `text` (not fixed-width char) so we can accept leading
-- zeros and future bank additions without a migration.
--
-- Tables touched:
--   * policy_payments             — client pays a policy with a cheque
--   * outside_cheques             — cheque held in the customer wallet
--   * company_settlements         — office pays an insurer with a cheque
--
-- All columns are NULLable so existing rows don't need a backfill; the
-- UI treats missing codes the same as today's "unknown bank".

ALTER TABLE public.policy_payments
  ADD COLUMN IF NOT EXISTS bank_code text,
  ADD COLUMN IF NOT EXISTS branch_code text;

ALTER TABLE public.outside_cheques
  ADD COLUMN IF NOT EXISTS bank_code text,
  ADD COLUMN IF NOT EXISTS branch_code text;

ALTER TABLE public.company_settlements
  ADD COLUMN IF NOT EXISTS bank_code text,
  ADD COLUMN IF NOT EXISTS branch_code text;

COMMENT ON COLUMN public.policy_payments.bank_code   IS 'Bank code (IL: 2 digits, e.g. 12 = Hapoalim). Nullable. Resolved to bank name in the UI via src/lib/banks.ts.';
COMMENT ON COLUMN public.policy_payments.branch_code IS 'Branch code assigned by the bank (typically 3 digits). Nullable.';
COMMENT ON COLUMN public.outside_cheques.bank_code   IS 'Bank code (IL: 2 digits, e.g. 12 = Hapoalim). Nullable.';
COMMENT ON COLUMN public.outside_cheques.branch_code IS 'Branch code assigned by the bank (typically 3 digits). Nullable.';
COMMENT ON COLUMN public.company_settlements.bank_code   IS 'Bank code (IL: 2 digits, e.g. 12 = Hapoalim). Nullable.';
COMMENT ON COLUMN public.company_settlements.branch_code IS 'Branch code assigned by the bank (typically 3 digits). Nullable.';
