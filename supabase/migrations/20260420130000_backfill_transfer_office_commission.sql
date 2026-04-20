-- Backfill: repair office_commission / insurance_price on policies that
-- were created by the transfer flow BEFORE the bug-fix in
-- TransferPolicyModal landed. Old behavior:
--   * office_commission was never copied from the source policy, so the
--     new policy had office_commission = 0 even when the source had one.
--   * customer-pays adjustment was added to insurance_price, inflating
--     the target policy's base price (e.g. 250 → 750).
-- New behavior (matches the code now in main):
--   * office_commission = source.office_commission + transfer adjustment
--     (adjustment only added to the specific target policy and only
--     when adjustment_type = 'customer_pays').
--   * insurance_price stays equal to source.insurance_price.
--
-- Guard clause: only touch rows that look untouched by a human — i.e.,
-- current office_commission is 0/NULL AND the current insurance_price
-- still matches the exact old-bad-formula result. If either diverges
-- the policy was already edited by an admin after the transfer and we
-- leave it alone.

WITH transfer_data AS (
  SELECT
    pt.new_policy_id,
    pt.adjustment_type,
    COALESCE(pt.adjustment_amount, 0) AS adjustment_amount,
    COALESCE(orig.office_commission, 0) AS original_office_commission,
    COALESCE(orig.insurance_price, 0)    AS original_insurance_price
  FROM public.policy_transfers pt
  JOIN public.policies orig ON orig.id = pt.policy_id
),
expected AS (
  SELECT
    td.*,
    (td.original_insurance_price
      + CASE WHEN td.adjustment_type = 'customer_pays'
             THEN td.adjustment_amount ELSE 0 END) AS old_bad_insurance_price,
    (td.original_office_commission
      + CASE WHEN td.adjustment_type = 'customer_pays'
             THEN td.adjustment_amount ELSE 0 END) AS target_office_commission
  FROM transfer_data td
)
UPDATE public.policies np
SET
  office_commission = e.target_office_commission,
  insurance_price   = e.original_insurance_price
FROM expected e
WHERE np.id = e.new_policy_id
  AND np.deleted_at IS NULL
  AND COALESCE(np.office_commission, 0) = 0
  AND np.insurance_price = e.old_bad_insurance_price;

-- Report how many rows were backfilled so the migration log is readable.
DO $$
DECLARE
  rows_affected integer;
BEGIN
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RAISE NOTICE 'backfill_transfer_office_commission: updated % policy rows', rows_affected;
END $$;
