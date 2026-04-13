-- The cascade so far only clears tables that have an `agent_id` column.
-- Tables like sms_logs record activity via `created_by -> profiles(id)`
-- without carrying agent_id themselves, so they survived the cascade and
-- blocked the profiles delete at the end (sms_logs_created_by_fkey).
--
-- Fix: snapshot every profile id belonging to this agent up front, then
-- in each pass also delete rows from public tables whose column name is
-- a known user-identity column (created_by, user_id, admin_id, ...) and
-- whose value is in that snapshot. The multi-pass loop handles ordering
-- so a table blocked on a dependent in pass N resolves by pass N+1.

CREATE OR REPLACE FUNCTION public.delete_agent_cascade(p_agent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fk_record RECORD;
  col_record RECORD;
  tbl_record RECORD;
  v_pass int;
  v_errors_this_pass int;
  v_last_error text;
  v_profile_ids uuid[];
BEGIN
  PERFORM set_config('app.admin_deleting_agent', 'true', true);

  -- Snapshot profile ids so we can clear indirect references through
  -- created_by / user_id / admin_id columns that don't carry agent_id.
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_profile_ids
    FROM public.profiles
    WHERE agent_id = p_agent_id;

  FOR v_pass IN 1..6 LOOP
    v_errors_this_pass := 0;

    -- (A) Every public table with an `agent_id` column. Using the column
    --     name catches tables where the FK was omitted or renamed.
    FOR tbl_record IN
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'agent_id'
        AND table_name <> 'agents'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE agent_id = $1',
                       tbl_record.table_name)
          USING p_agent_id;
      EXCEPTION WHEN OTHERS THEN
        v_errors_this_pass := v_errors_this_pass + 1;
        IF v_pass = 6 THEN
          v_last_error := format('%s.agent_id — %s',
                                 tbl_record.table_name, SQLERRM);
        END IF;
      END;
    END LOOP;

    -- (B) Any table with a known user-identity column pointing at one of
    --     this agent's profile ids. Covers sms_logs.created_by and
    --     similar audit-style columns on tables that don't have agent_id.
    IF array_length(v_profile_ids, 1) > 0 THEN
      FOR col_record IN
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN (
            'created_by', 'updated_by', 'deleted_by', 'cancelled_by',
            'user_id', 'admin_id', 'assigned_to',
            'created_by_admin_id', 'updated_by_admin_id'
          )
          AND table_name NOT IN ('profiles', 'agents')
      LOOP
        BEGIN
          EXECUTE format(
            'DELETE FROM public.%I WHERE %I = ANY($1)',
            col_record.table_name,
            col_record.column_name
          ) USING v_profile_ids;
        EXCEPTION WHEN OTHERS THEN
          v_errors_this_pass := v_errors_this_pass + 1;
          IF v_pass = 6 THEN
            v_last_error := format('%s.%s — %s',
                                   col_record.table_name,
                                   col_record.column_name,
                                   SQLERRM);
          END IF;
        END;
      END LOOP;
    END IF;

    -- (C) Safety net: FK-driven cascade for anything the column-name sweep
    --     missed (e.g. FKs pointing at agents.id from a column not named
    --     agent_id).
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
        AND kcu.column_name <> 'agent_id'
    LOOP
      BEGIN
        EXECUTE format(
          'DELETE FROM public.%I WHERE %I = $1',
          fk_record.referencing_table,
          fk_record.referencing_column
        ) USING p_agent_id;
      EXCEPTION WHEN OTHERS THEN
        v_errors_this_pass := v_errors_this_pass + 1;
        IF v_pass = 6 THEN
          v_last_error := format('%s.%s — %s',
                                 fk_record.referencing_table,
                                 fk_record.referencing_column,
                                 SQLERRM);
        END IF;
      END;
    END LOOP;

    EXIT WHEN v_errors_this_pass = 0;
  END LOOP;

  BEGIN
    DELETE FROM public.agents WHERE id = p_agent_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'delete_agent_cascade: could not clear all dependents after 6 passes. Last blocker: %. Final: %',
      COALESCE(v_last_error, 'n/a'),
      SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_agent_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_agent_cascade(uuid) TO service_role;
