-- Hard-deleting a client cascades through the FK chain into
-- policy_payments, where the prevent_locked_payment_delete trigger
-- raises "Cannot delete locked payment. This is a system-generated
-- payment." for the auto ELZAMI / Tranzila locked rows. That guard is
-- correct for everyday deletes but it shouldn't fire when the entire
-- client (and therefore every one of their policies) is going away.
--
-- Mirror what delete_agent_cascade already does for agent purges:
-- run the DELETE inside a SECURITY DEFINER function that flips
-- session_replication_role to 'replica' for the transaction. That
-- disables user-defined triggers (FK constraints stay enforced because
-- they're internal triggers) so the cascade can finish in one shot.

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

  IF v_branch_id IS NULL THEN
    -- Either the row doesn't exist or its branch_id is null. Either
    -- way fall back on a strict ownership check.
    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
      RAISE EXCEPTION 'Client not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF NOT (
    public.is_active_user(auth.uid())
    AND public.can_access_branch(auth.uid(), v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to delete this client' USING ERRCODE = '42501';
  END IF;

  -- Skip user triggers for the rest of this transaction. FK CASCADE
  -- still runs (those are system triggers), so the entire client tree
  -- (cars, policies, payments, signatures, accident reports, …) gets
  -- removed without bumping into prevent_locked_payment_delete or any
  -- other guard trigger we've installed for normal CRUD.
  PERFORM set_config('session_replication_role', 'replica', true);

  DELETE FROM public.clients WHERE id = p_client_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_client_cascade(uuid) TO authenticated;
