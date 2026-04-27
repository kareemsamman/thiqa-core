-- ============================================================
-- Backfill receipts.branch_id from parent policy / payment / client
--
-- The receipts table got branch_id mid-life and the auto-sync trigger
-- (sync_receipts_from_policy_payments + the branch derivation in
-- 20260427140000_fix_payment_branch_derivation) keeps new rows
-- correct. But every receipt created before the sync was wired up
-- still carries branch_id = NULL.
--
-- The branch_isolation RESTRICTIVE policy
-- (20260426150000_branch_isolation_for_workers) treats NULL branch_id
-- as "agency-wide" and lets every worker see those rows — so a worker
-- pinned to Branch A still sees Branch B's old receipts in the
-- /receipts list. The user reported exactly this: a branch-scoped
-- worker seeing receipts they shouldn't.
--
-- Resolution priority for the backfill:
--   1. policy.branch_id      (auto receipts that link to a policy)
--   2. policy_payment.branch_id (when policy has no branch_id either)
--   3. NULL — legacy manual receipts with no parent.
--      These stay NULL, but the user can edit them in /receipts and
--      the next save will stamp the correct branch via the auto-set
--      trigger.
-- ============================================================

UPDATE public.receipts AS r
SET branch_id = COALESCE(p.branch_id, pp.branch_id)
FROM public.policy_payments AS pp
LEFT JOIN public.policies AS p ON p.id = pp.policy_id
WHERE r.branch_id IS NULL
  AND r.payment_id = pp.id
  AND COALESCE(p.branch_id, pp.branch_id) IS NOT NULL;

-- Manual receipts (no payment_id) that have a policy_id directly.
UPDATE public.receipts AS r
SET branch_id = p.branch_id
FROM public.policies AS p
WHERE r.branch_id IS NULL
  AND r.payment_id IS NULL
  AND r.policy_id = p.id
  AND p.branch_id IS NOT NULL;
