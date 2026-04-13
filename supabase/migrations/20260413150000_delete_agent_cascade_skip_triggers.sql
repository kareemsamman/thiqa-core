-- When a super admin deletes an agent we want to wipe every trace of that
-- account, including system-generated rows that are normally protected by
-- guard triggers (e.g. prevent_locked_payment_delete on policy_payments
-- which raises "Cannot delete locked payment. This is a system-generated
-- payment."). Without bypassing that trigger the cascade leaves policies +
-- profiles in place and the final DELETE FROM agents fails with
-- profiles_agent_id_fkey.
--
-- Postgres gives us `session_replication_role = replica` as the standard
-- escape hatch: it disables user-defined triggers for the current
-- transaction while leaving FK constraints enforced. Because the function
-- is SECURITY DEFINER owned by postgres (superuser in Supabase), the
-- SET LOCAL is allowed.

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
  -- Skip user triggers for the rest of this transaction (FK constraints
  -- remain enforced because they are internal system triggers).
  PERFORM set_config('session_replication_role', 'replica', true);

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
        IF v_pass = 5 THEN
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
      'delete_agent_cascade: could not clear all dependents after 5 passes. Last blocker: %. Final: %',
      COALESCE(v_last_error, 'n/a'),
      SQLERRM;
  END;

  -- Restore default trigger behavior for the rest of the transaction (in
  -- case anything else runs after us in the same txn).
  PERFORM set_config('session_replication_role', 'origin', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_agent_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_agent_cascade(uuid) TO service_role;
