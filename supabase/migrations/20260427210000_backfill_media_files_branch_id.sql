-- ============================================================
-- Backfill media_files.branch_id from polymorphic parent
--
-- Same pattern as 20260427180000 (receipts backfill). The
-- set_media_files_branch_id trigger from 20260427150000 keeps every
-- new upload correctly stamped with the parent record's branch_id,
-- but every media_files row uploaded BEFORE that trigger landed
-- still carries branch_id = NULL.
--
-- The branch_isolation RESTRICTIVE policy
-- (20260426150000_branch_isolation_for_workers) treats NULL branch_id
-- as "agency-wide" and lets every worker see those rows — so a
-- branch-scoped worker on /media still sees other branches' legacy
-- attachments. The user reported exactly this.
--
-- Resolution mirrors the trigger's polymorphic switch:
--   entity_type = 'client'  → clients.branch_id
--   entity_type = 'car'     → cars.branch_id
--   entity_type = 'policy'  → policies.branch_id
--   entity_type = 'cheque'  → policy_payments.branch_id
-- Anything without an entity_type/id (or whose parent itself is
-- NULL-branch) stays NULL — those represent legacy agency-wide
-- uploads with no derivable branch and we don't want to invent one.
-- ============================================================

-- 1. client attachments
UPDATE public.media_files AS m
SET branch_id = c.branch_id
FROM public.clients AS c
WHERE m.branch_id IS NULL
  AND m.entity_type = 'client'
  AND m.entity_id = c.id
  AND c.branch_id IS NOT NULL;

-- 2. car attachments
UPDATE public.media_files AS m
SET branch_id = ca.branch_id
FROM public.cars AS ca
WHERE m.branch_id IS NULL
  AND m.entity_type = 'car'
  AND m.entity_id = ca.id
  AND ca.branch_id IS NOT NULL;

-- 3. policy attachments
UPDATE public.media_files AS m
SET branch_id = p.branch_id
FROM public.policies AS p
WHERE m.branch_id IS NULL
  AND m.entity_type = 'policy'
  AND m.entity_id = p.id
  AND p.branch_id IS NOT NULL;

-- 4. cheque attachments (cheque → policy_payments)
UPDATE public.media_files AS m
SET branch_id = pp.branch_id
FROM public.policy_payments AS pp
WHERE m.branch_id IS NULL
  AND m.entity_type = 'cheque'
  AND m.entity_id = pp.id
  AND pp.branch_id IS NOT NULL;
