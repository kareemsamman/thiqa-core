CREATE OR REPLACE FUNCTION public.validate_policy_payment_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_policy_price numeric;
  v_group_id uuid;
  v_existing_total numeric;
  v_new_total numeric;
BEGIN
  -- Skip batch cheque entries from the cheques page (managed by application logic)
  IF NEW.batch_id IS NOT NULL AND NEW.notes = 'شيك من صفحة الشيكات' THEN
    RETURN NEW;
  END IF;

  -- Only validate for inserts/updates where payment is not refused
  IF COALESCE(NEW.refused, false) = true THEN
    RETURN NEW;
  END IF;

  -- Load policy price (including office commission) and group_id
  SELECT p.insurance_price + COALESCE(p.office_commission, 0), p.group_id
  INTO v_policy_price, v_group_id
  FROM public.policies p
  WHERE p.id = NEW.policy_id;

  IF v_policy_price IS NULL THEN
    RAISE EXCEPTION 'Policy not found for payment';
  END IF;

  -- If policy is part of a group (package), use total package price AND sum payments across all group policies
  IF v_group_id IS NOT NULL THEN
    SELECT COALESCE(SUM(pkg.insurance_price + COALESCE(pkg.office_commission, 0)), 0)
    INTO v_policy_price
    FROM public.policies pkg
    WHERE pkg.group_id = v_group_id
      AND pkg.deleted_at IS NULL;

    -- Sum existing payments across ALL policies in the package
    SELECT COALESCE(SUM(pp.amount), 0)
    INTO v_existing_total
    FROM public.policy_payments pp
    JOIN public.policies pol ON pol.id = pp.policy_id
    WHERE pol.group_id = v_group_id
      AND pol.deleted_at IS NULL
      AND COALESCE(pp.refused, false) = false
      AND (TG_OP <> 'UPDATE' OR pp.id <> NEW.id);
  ELSE
    -- Single policy: sum only for that policy
    SELECT COALESCE(SUM(pp.amount), 0)
    INTO v_existing_total
    FROM public.policy_payments pp
    WHERE pp.policy_id = NEW.policy_id
      AND COALESCE(pp.refused, false) = false
      AND (TG_OP <> 'UPDATE' OR pp.id <> NEW.id);
  END IF;

  v_new_total := v_existing_total + COALESCE(NEW.amount, 0);

  IF v_new_total > v_policy_price THEN
    RAISE EXCEPTION 'Payment total exceeds policy insurance_price (total=%, price=%)', v_new_total, v_policy_price;
  END IF;

  RETURN NEW;
END;
$$;