-- Supabase's hosted `postgres` role isn't a real superuser and can't set
-- session_replication_role. Switch to a custom GUC (app.admin_deleting_agent)
-- that any role can set, and teach the prevent_locked_payment_modification
-- trigger to bypass its guard when that flag is set.
--
-- Flow:
--   1. delete_agent_cascade calls set_config('app.admin_deleting_agent','true',true)
--   2. The trigger sees the flag and returns OLD/NEW without raising
--   3. set_config second argument `true` makes the setting transaction-local,
--      so it auto-resets when the cascade transaction ends.

CREATE OR REPLACE FUNCTION public.prevent_locked_payment_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Super-admin agent deletion bypasses locked-payment protection.
  -- The GUC is set by delete_agent_cascade for the scope of that one txn.
  IF current_setting('app.admin_deleting_agent', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.locked = true THEN
    IF OLD.payment_type != NEW.payment_type OR
       OLD.amount != NEW.amount OR
       OLD.payment_date != NEW.payment_date OR
       OLD.cheque_number IS DISTINCT FROM NEW.cheque_number THEN
      RAISE EXCEPTION 'Cannot modify locked payment. This is a system-generated payment.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' AND OLD.locked = true THEN
    RAISE EXCEPTION 'Cannot delete locked payment. This is a system-generated payment.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

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
  -- Tell the locked-payment trigger (and any future agent-scoped guards)
  -- we are running an authorized cascade.
  PERFORM set_config('app.admin_deleting_agent', 'true', true);

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
END;
$$;

REVOKE ALL ON FUNCTION public.delete_agent_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_agent_cascade(uuid) TO service_role;
