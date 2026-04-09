-- Fix existing visa payments with NULL branch_id by copying from their policy
UPDATE policy_payments pp
SET branch_id = p.branch_id
FROM policies p
WHERE pp.policy_id = p.id
  AND pp.branch_id IS NULL
  AND p.branch_id IS NOT NULL;