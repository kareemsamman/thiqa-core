-- Multi-image support for cheque attachments on settlements + expenses.
--
-- Until now each row carried a single `cheque_image_url`. Agents asked to
-- attach more than one image per cheque (front + back, copies of multiple
-- pages, etc.) so we add a TEXT[] column alongside the existing single
-- column. The single column stays for backwards compatibility — readers
-- treat it as the first element when the array is empty/null.
--
-- Three tables get the same column for symmetry: company_settlements,
-- broker_settlements, expenses. policy_payments keeps its single column
-- since cheque images there are part of the customer-cheque flow which
-- already has its own UX.

ALTER TABLE company_settlements
  ADD COLUMN IF NOT EXISTS cheque_image_urls TEXT[] DEFAULT '{}'::text[];

ALTER TABLE broker_settlements
  ADD COLUMN IF NOT EXISTS cheque_image_urls TEXT[] DEFAULT '{}'::text[];

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS cheque_image_urls TEXT[] DEFAULT '{}'::text[];

COMMENT ON COLUMN company_settlements.cheque_image_urls IS
  'Optional list of attached cheque images (front, back, copies). Falls back to cheque_image_url when empty for legacy rows.';
COMMENT ON COLUMN broker_settlements.cheque_image_urls IS
  'Optional list of attached cheque images (front, back, copies). Falls back to cheque_image_url when empty for legacy rows.';
COMMENT ON COLUMN expenses.cheque_image_urls IS
  'Optional list of attached cheque images (front, back, copies). Falls back to cheque_image_url when empty for legacy rows.';
