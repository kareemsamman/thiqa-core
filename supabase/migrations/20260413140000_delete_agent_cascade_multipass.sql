-- Multi-pass version of delete_agent_cascade. The previous implementation
-- iterated FK-bearing tables in information_schema order, which is not
-- dependency order. If table A referenced the agent AND referenced table B
-- (which also referenced the agent), deleting B first failed with a FK
-- violation and the whole RPC aborted.
--
-- New approach: run up to 5 passes. On each pass, try every FK-bearing
-- table; silently swallow errors (they'll resolve on a later pass once the
-- blocking dependent rows are gone). After all passes, try the final
-- DELETE FROM agents — if anything still blocks, raise a verbose error
-- with the last blocker so the admin toast shows what to fix.

CREATE OR REPLACE FUNCTION public.delete_agent_cascade(p_agent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fk_record RECORD;
  v_pass int;
  v_errors_this_pass int;
  v_last_error text;
BEGIN
  FOR v_pass IN 1..5 LOOP
    v_errors_this_pass := 0;

    FOR fk_record IN
      SELECT tc.table_name AS referencing_table,
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
      BEGIN
        EXECUTE format(
          'DELETE FROM public.%I WHERE %I = $1',
          fk_record.referencing_table,
          fk_record.referencing_column
        ) USING p_agent_id;
      EXCEPTION WHEN OTHERS THEN
        v_errors_this_pass := v_errors_this_pass + 1;
        -- Remember the most recent blocker so we can report it if we can't
        -- finish. Only keep the LAST pass's error so the message reflects
        -- what's genuinely stuck (not transient deps cleared on later passes).
        IF v_pass = 5 THEN
          v_last_error := format('%s.%s — %s',
            fk_record.referencing_table,
            fk_record.referencing_column,
            SQLERRM);
        END IF;
      END;
    END LOOP;

    -- Nothing failed this pass; agent table is clear to delete.
    EXIT WHEN v_errors_this_pass = 0;
  END LOOP;

  BEGIN
    DELETE FROM public.agents WHERE id = p_agent_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'delete_agent_cascade: could not clear all dependents after 5 passes. Last blocker: %. Final: %',
      COALESCE(v_last_error, 'n/a'),
      SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_agent_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_agent_cascade(uuid) TO service_role;
