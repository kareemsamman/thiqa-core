-- A database function that fully deletes an agent and everything referencing
-- it in the public schema. Uses information_schema to discover every table
-- that has a foreign key to public.agents(id) at runtime, then deletes
-- from each one in the same transaction, and finally deletes the agent row.
--
-- This is more maintainable than a hardcoded table list in the edge function
-- — any new table with an `agent_id` FK is handled automatically.

CREATE OR REPLACE FUNCTION public.delete_agent_cascade(p_agent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fk_record RECORD;
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
      -- Don't try to delete from agents itself
      AND tc.table_name <> 'agents'
  LOOP
    BEGIN
      EXECUTE format(
        'DELETE FROM public.%I WHERE %I = $1',
        fk_record.referencing_table,
        fk_record.referencing_column
      ) USING p_agent_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'delete_agent_cascade: skipped %.% — %',
        fk_record.referencing_table,
        fk_record.referencing_column,
        SQLERRM;
    END;
  END LOOP;

  -- Finally delete the agent itself. If something still blocks this (e.g. a
  -- policy with ON DELETE RESTRICT), the exception propagates so the caller
  -- sees the real reason instead of a generic 500.
  DELETE FROM public.agents WHERE id = p_agent_id;
END;
$$;

-- Only super admins should be able to call this.
REVOKE ALL ON FUNCTION public.delete_agent_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_agent_cascade(uuid) TO service_role;
