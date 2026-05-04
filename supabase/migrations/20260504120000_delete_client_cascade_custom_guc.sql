-- Supabase's hosted `postgres` role isn't a real superuser and can't
-- set session_replication_role, so the previous version of
-- delete_client_cascade failed with "permission denied to set
-- parameter session_replication_role".
--
-- Mirror the pattern used by delete_agent_cascade (see
-- 20260413160000_delete_agent_cascade_custom_guc.sql): use a custom
-- GUC (app.cascade_deleting_client) that any role can set, and teach
-- the prevent_locked_payment_modification trigger to bypass its guard
-- when that flag is set.

CREATE OR REPLACE FUNCTION public.prevent_locked_payment_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Authorized cascade flows (super-admin agent delete OR a
  -- branch-scoped client hard-delete). Both flip a transaction-local
  -- GUC before issuing their DELETE so the trigger can let the row go.
  IF current_setting('app.admin_deleting_agent', true) = 'true'
     OR current_setting('app.cascade_deleting_client', true) = 'true' THEN
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

CREATE OR REPLACE FUNCTION public.delete_client_cascade(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  -- Re-implement the "Branch users can manage clients" RLS check
  -- explicitly here. SECURITY DEFINER bypasses RLS, so without this
  -- gate any authenticated user could delete any client across
  -- tenants. Mirror the policy: caller must be active + have access
  -- to the client's branch.
  SELECT branch_id INTO v_branch_id
  FROM public.clients
  WHERE id = p_client_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_active_user(auth.uid())
    AND public.can_access_branch(auth.uid(), v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to delete this client' USING ERRCODE = '42501';
  END IF;

  -- Tell prevent_locked_payment_modification (and any future cascade-
  -- aware guards) that an authorized client purge is in progress. The
  -- third argument `true` makes it transaction-local so it auto-
  -- resets when the transaction ends.
  PERFORM set_config('app.cascade_deleting_client', 'true', true);

  DELETE FROM public.clients WHERE id = p_client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_client_cascade(uuid) TO authenticated;
