-- Schema groundwork for the unified "add voucher" dialog launched from
-- the Accounting page (سند صرف / سند قبض / مرتجعات + expenses).
--
-- 1. company_settlements: add `direction` so a single table can record
--    both money we paid TO a company AND money we received FROM one.
--    Existing rows default to 'outgoing' (the legacy meaning).
--
-- 2. broker_settlements + expenses: align on the same bank-tracking
--    fields company_settlements + policy_payments already had — bank_code,
--    branch_code — so a cheque written from any surface stores the same
--    identifying triple (cheque_number + bank_code + branch_code).
--
-- 3. expenses: add the cheque metadata fields needed for the same
--    payment-lines UX as the settlement vouchers — cheque_number,
--    cheque_image_url, bank_reference, customer_cheque_ids,
--    cheque_status. Each expense row is still a single payment.

ALTER TABLE company_settlements
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'outgoing'
    CHECK (direction IN ('outgoing', 'incoming'));

COMMENT ON COLUMN company_settlements.direction IS
  'outgoing = we paid the company (سند صرف); incoming = company paid us (سند قبض / refund).';

ALTER TABLE broker_settlements
  ADD COLUMN IF NOT EXISTS bank_code text,
  ADD COLUMN IF NOT EXISTS branch_code text;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS cheque_number text,
  ADD COLUMN IF NOT EXISTS cheque_image_url text,
  ADD COLUMN IF NOT EXISTS bank_reference text,
  ADD COLUMN IF NOT EXISTS bank_code text,
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS customer_cheque_ids jsonb,
  ADD COLUMN IF NOT EXISTS cheque_status text;

-- Lookup index for cross-surface duplicate detection (phase 3). The
-- "is this cheque already in the system?" check joins by cheque_number
-- + bank_code, so partial indexes on the matching tables let it stay
-- fast as the cheque book grows.
CREATE INDEX IF NOT EXISTS idx_company_settlements_cheque_lookup
  ON company_settlements (cheque_number, bank_code)
  WHERE cheque_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_broker_settlements_cheque_lookup
  ON broker_settlements (cheque_number, bank_code)
  WHERE cheque_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_cheque_lookup
  ON expenses (cheque_number, bank_code)
  WHERE cheque_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_policy_payments_cheque_lookup
  ON policy_payments (cheque_number, bank_code)
  WHERE cheque_number IS NOT NULL;
