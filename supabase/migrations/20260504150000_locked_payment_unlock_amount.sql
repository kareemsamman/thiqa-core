-- Drop the amount lock from prevent_locked_payment_modification.
--
-- Before: the auto ELZAMI "external visa" row's amount was bound to
-- the policy insurance_price. The new requirement: the agent should
-- be able to set the locked-payment amount to 0 (or any partial
-- value) when the customer hasn't actually paid the company portal
-- yet and wants the agency to collect later. That makes ELZAMI
-- behave like any other policy on the customer-debt side: paid by
-- the locked row → no debt; locked row reduced/zeroed → real debt
-- that surfaces on the debt page, debt-payment modal, etc.
--
-- The trigger still blocks DELETE on locked rows so the auto-row
-- can't be removed wholesale — only its fields can be changed.

CREATE OR REPLACE FUNCTION public.prevent_locked_payment_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Authorized cascade flows (super-admin agent delete OR a
  -- branch-scoped client hard-delete). Both flip a transaction-local
  -- GUC before issuing their DELETE so the trigger lets the row go.
  IF current_setting('app.admin_deleting_agent', true) = 'true'
     OR current_setting('app.cascade_deleting_client', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Locked rows are still un-deletable (they're the system-generated
  -- ELZAMI bookkeeping anchor — losing the row entirely would orphan
  -- the policy's payment status calculations). Every editable field
  -- (amount, payment_type, payment_date, cheque info, notes) is
  -- intentionally writable so agents can adjust the auto-row to
  -- match what actually happened.
  IF TG_OP = 'DELETE' AND OLD.locked = true THEN
    RAISE EXCEPTION 'Cannot delete locked payment. This is a system-generated payment.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;
