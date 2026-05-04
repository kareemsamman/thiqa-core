-- Loosen prevent_locked_payment_modification so the agent can switch
-- the payment_type / payment_date / cheque metadata / notes on the
-- auto ELZAMI row (currently hardcoded to "فيزا خارجي" because that's
-- the most common case). Only `amount` stays locked — the price is
-- the source of truth for ELZAMI and shouldn't drift away from the
-- policy's insurance_price.
--
-- Image upload was never blocked by this trigger (images live in
-- media_files, not in policy_payments), so it already works for
-- locked rows from the trigger's perspective. UI gating is handled
-- separately in the wizard.

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

  -- For locked rows the *amount* is the only field we lock down — the
  -- agent can still change payment_type, payment_date, cheque info,
  -- bank/branch codes, notes, attached images, etc. without bumping
  -- into the guard.
  IF TG_OP = 'UPDATE' AND OLD.locked = true THEN
    IF OLD.amount IS DISTINCT FROM NEW.amount THEN
      RAISE EXCEPTION 'Cannot modify locked payment amount. The amount is bound to the policy price.';
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
