-- ============================================================
-- Safety: guarantee the document_sequences unique constraint exists.
--
-- 20260414100000_document_numbers.sql declares the table with
-- `PRIMARY KEY (agent_id, kind, year)`, but the table was created
-- with `CREATE TABLE IF NOT EXISTS`. If it happened to exist from an
-- earlier attempt without that PK, the constraint never gets added,
-- and every call to allocate_document_number() fails with:
--   "there is no unique or exclusion constraint matching the
--    ON CONFLICT specification"
-- because ON CONFLICT (agent_id, kind, year) has nothing to land on.
--
-- Drop any duplicate rows that would block the constraint and then
-- create it idempotently. Safe to run on clean databases too.
-- ============================================================

-- Collapse duplicates if any exist: keep the row with the highest
-- next_value for each (agent_id, kind, year) triple, delete the rest.
DELETE FROM public.document_sequences a
USING public.document_sequences b
WHERE a.ctid < b.ctid
  AND a.agent_id IS NOT DISTINCT FROM b.agent_id
  AND a.kind = b.kind
  AND a.year = b.year;

-- Add a unique constraint only when nothing equivalent is in place.
-- We check pg_indexes first because a PK or previous UNIQUE would
-- have an index; that skips the add instead of raising.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'document_sequences'
      AND c.contype IN ('p', 'u')
      AND c.conkey @> ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'agent_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'kind'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'year')
      ]
  ) THEN
    ALTER TABLE public.document_sequences
      ADD CONSTRAINT document_sequences_agent_kind_year_key
      UNIQUE (agent_id, kind, year);
  END IF;
END $$;
