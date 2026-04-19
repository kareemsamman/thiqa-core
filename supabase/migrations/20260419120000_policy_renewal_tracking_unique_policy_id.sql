-- ============================================================
-- Fix: auto_mark_renewed_policies() trigger fails on every transfer
-- (and any other policy insert that finds a same-client+car+type
-- predecessor) with:
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
--
-- The trigger does:
--   INSERT INTO policy_renewal_tracking (policy_id, ...)
--   VALUES (...)
--   ON CONFLICT (policy_id) DO UPDATE SET ...
--
-- but the table was created with PRIMARY KEY (id) only — there is
-- no unique constraint on policy_id, so Postgres has nothing to
-- 'land on' for the conflict target. Result: transfers throw and
-- the user can't move a transferred package to another car again.
--
-- policy_renewal_tracking semantically holds one row per policy
-- (it tracks renewal contact status for each policy), so adding
-- a UNIQUE constraint on policy_id is the correct shape and lets
-- the existing trigger upsert work as intended.
-- ============================================================

-- Defensive dedupe: keep the most recently updated row per policy_id
-- and drop the rest. No-op on clean databases.
DELETE FROM public.policy_renewal_tracking a
USING public.policy_renewal_tracking b
WHERE a.policy_id = b.policy_id
  AND a.policy_id IS NOT NULL
  AND (
    a.updated_at < b.updated_at
    OR (a.updated_at = b.updated_at AND a.id < b.id)
  );

-- Add the UNIQUE constraint only when nothing equivalent exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'policy_renewal_tracking'
      AND c.contype IN ('p', 'u')
      AND c.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = t.oid AND attname = 'policy_id')
      ]
  ) THEN
    ALTER TABLE public.policy_renewal_tracking
      ADD CONSTRAINT policy_renewal_tracking_policy_id_key
      UNIQUE (policy_id);
  END IF;
END $$;
