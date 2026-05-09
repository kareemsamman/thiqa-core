-- =============================================================================
-- Auto-generate clients.file_number on INSERT + backfill existing rows
-- =============================================================================
-- Until now, generate_file_number() was only called from PolicyWizard.tsx
-- when creating a client through the new-policy flow. Clients added via
-- the standalone "إضافة عميل" form (ClientDrawer) — and any other
-- entry point (edge functions, imports) — landed with file_number = NULL,
-- so the customer detail page rendered "-" under رقم الملف.
--
-- A BEFORE INSERT trigger fills the field server-side from the existing
-- client_file_number_seq, making auto-generation work uniformly across
-- every path. Callers that explicitly pass a file_number keep their
-- value untouched.
--
-- The trigger loops up to 100 times if the sequence happens to land on
-- an already-used value (manual inserts can drift the sequence below
-- existing rows). On the off chance of running out of attempts it lets
-- the row through with NULL rather than blocking the insert — an admin
-- can fix file_numbers manually after.
-- =============================================================================

-- 1. Trigger function
CREATE OR REPLACE FUNCTION public.set_client_file_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate text;
  v_attempts int := 0;
BEGIN
  -- Caller already provided a file_number — leave it alone.
  IF NEW.file_number IS NOT NULL AND NEW.file_number <> '' THEN
    RETURN NEW;
  END IF;

  LOOP
    v_candidate := public.generate_file_number();
    IF NOT EXISTS (
      SELECT 1 FROM public.clients WHERE file_number = v_candidate
    ) THEN
      NEW.file_number := v_candidate;
      RETURN NEW;
    END IF;

    v_attempts := v_attempts + 1;
    EXIT WHEN v_attempts > 100;
  END LOOP;

  -- Couldn't find a free slot in 100 tries; let the row insert with NULL.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_client_file_number ON public.clients;
CREATE TRIGGER trg_set_client_file_number
  BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_client_file_number();

-- 2. Sync the sequence past any manually-inserted high file_numbers so
--    nextval() doesn't immediately produce duplicates during the backfill
--    or for future inserts.
DO $$
DECLARE
  v_max int;
BEGIN
  SELECT COALESCE(MAX(REGEXP_REPLACE(file_number, '[^0-9]', '', 'g')::int), 1000)
  INTO v_max
  FROM public.clients
  WHERE file_number IS NOT NULL
    AND file_number ~ '^F[0-9]+$';

  IF v_max > 1000 THEN
    PERFORM setval('public.client_file_number_seq', v_max);
  END IF;
END $$;

-- 3. Backfill existing clients with no file_number. Row-by-row so the
--    sequence advances and per-row collisions can retry without aborting
--    the whole DO block.
DO $$
DECLARE
  r RECORD;
  v_candidate text;
  v_attempts int;
BEGIN
  FOR r IN
    SELECT id FROM public.clients
    WHERE (file_number IS NULL OR file_number = '')
      AND deleted_at IS NULL
    ORDER BY created_at ASC
  LOOP
    v_attempts := 0;
    LOOP
      v_candidate := public.generate_file_number();
      IF NOT EXISTS (
        SELECT 1 FROM public.clients WHERE file_number = v_candidate
      ) THEN
        UPDATE public.clients
        SET file_number = v_candidate
        WHERE id = r.id;
        EXIT;
      END IF;

      v_attempts := v_attempts + 1;
      EXIT WHEN v_attempts > 100;
    END LOOP;
  END LOOP;
END $$;
