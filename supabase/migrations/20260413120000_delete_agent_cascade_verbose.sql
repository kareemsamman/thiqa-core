-- Make delete_agent_cascade raise the real blocking table/column instead of
-- silently skipping and then failing on DELETE FROM agents with a generic
-- FK violation. Easier to diagnose when a delete fails from the admin UI.

CREATE OR REPLACE FUNCTION public.delete_agent_cascade(p_agent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fk_record RECORD;
  v_last_table text;
  v_last_column text;
BEGIN
  -- Find every foreign key in the public schema that points at agents.id
  FOR fk_record IN
    SELECT
      tc.table_name AS referencing_table,
      kcu.column_name AS referencing_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'agents'
      AND ccu.column_name = 'id'
      AND tc.table_name <> 'agents'
  LOOP
    v_last_table := fk_record.referencing_table;
    v_last_column := fk_record.referencing_column;
    BEGIN
      EXECUTE format(
        'DELETE FROM public.%I WHERE %I = $1',
        fk_record.referencing_table,
        fk_record.referencing_column
      ) USING p_agent_id;
    EXCEPTION WHEN OTHERS THEN
      -- Surface the exact blocking table + underlying error so the caller
      -- sees something actionable instead of a generic "failed to delete".
      RAISE EXCEPTION
        'delete_agent_cascade: failed to clear %.% — %',
        v_last_table, v_last_column, SQLERRM;
    END;
  END LOOP;

  DELETE FROM public.agents WHERE id = p_agent_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_agent_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_agent_cascade(uuid) TO service_role;
