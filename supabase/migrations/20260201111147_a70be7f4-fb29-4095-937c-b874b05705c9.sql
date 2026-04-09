-- Fix existing Visa payments that have null branch_id
-- This ensures workers can see payments for policies in their branch
UPDATE policy_payments pp
SET branch_id = p.branch_id
FROM policies p
WHERE pp.policy_id = p.id
  AND pp.payment_type = 'visa'
  AND pp.branch_id IS NULL
  AND p.branch_id IS NOT NULL;