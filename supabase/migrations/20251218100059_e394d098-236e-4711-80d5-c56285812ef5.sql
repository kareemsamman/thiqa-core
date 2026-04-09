-- Enforce that total non-refused payments never exceed policy insurance_price

-- 1) Validation function
CREATE OR REPLACE FUNCTION public.validate_policy_payment_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_policy_price numeric;
  v_existing_total numeric;
  v_new_total numeric;
BEGIN
  -- Only validate for inserts/updates where payment is not refused
  IF COALESCE(NEW.refused, false) = true THEN
    RETURN NEW;
  END IF;

  -- Load policy price
  SELECT p.insurance_price
  INTO v_policy_price
  FROM public.policies p
  WHERE p.id = NEW.policy_id;

  IF v_policy_price IS NULL THEN
    RAISE EXCEPTION 'Policy not found for payment';
  END IF;

  -- Sum existing payments excluding refused and excluding current row (for updates)
  SELECT COALESCE(SUM(pp.amount), 0)
  INTO v_existing_total
  FROM public.policy_payments pp
  WHERE pp.policy_id = NEW.policy_id
    AND COALESCE(pp.refused, false) = false
    AND (TG_OP <> 'UPDATE' OR pp.id <> NEW.id);

  v_new_total := v_existing_total + COALESCE(NEW.amount, 0);

  IF v_new_total > v_policy_price THEN
    RAISE EXCEPTION 'Payment total exceeds policy insurance_price (total=%, price=%)', v_new_total, v_policy_price;
  END IF;

  RETURN NEW;
END;
$$;

-- 2) Trigger (DROP/CREATE idempotent)
DROP TRIGGER IF EXISTS trg_validate_policy_payment_total ON public.policy_payments;
CREATE TRIGGER trg_validate_policy_payment_total
BEFORE INSERT OR UPDATE ON public.policy_payments
FOR EACH ROW
EXECUTE FUNCTION public.validate_policy_payment_total();
