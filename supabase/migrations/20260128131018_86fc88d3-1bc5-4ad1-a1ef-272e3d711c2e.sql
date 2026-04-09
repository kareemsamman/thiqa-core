
-- Temporarily disable the validation trigger to fix branch_id
ALTER TABLE policy_payments DISABLE TRIGGER trg_validate_policy_payment_total;

-- Update payments with NULL branch_id using their policy's branch_id
UPDATE policy_payments pp
SET branch_id = pol.branch_id
FROM policies pol
WHERE pp.policy_id = pol.id
  AND pp.branch_id IS NULL
  AND pol.branch_id IS NOT NULL;

-- Re-enable the trigger
ALTER TABLE policy_payments ENABLE TRIGGER trg_validate_policy_payment_total;
