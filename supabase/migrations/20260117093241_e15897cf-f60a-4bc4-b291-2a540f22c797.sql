-- Update ledger trigger to skip 0 amounts (protection against edge cases)
CREATE OR REPLACE FUNCTION public.ledger_on_payment_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy RECORD;
BEGIN
  -- Skip if amount is 0 or null
  IF NEW.amount IS NULL OR NEW.amount = 0 THEN
    RETURN NEW;
  END IF;

  -- Get policy info
  SELECT p.client_id, p.policy_type_parent, p.branch_id
  INTO v_policy
  FROM policies p WHERE p.id = NEW.policy_id;
  
  -- Only create entry if payment is not refused
  IF NEW.refused IS NOT TRUE THEN
    PERFORM insert_ledger_entry(
      'payment_received'::ledger_reference_type,
      NEW.id,
      'customer'::ledger_counterparty_type,
      v_policy.client_id,
      NEW.amount,
      'receivable_collected'::ledger_category,
      'استلام دفعة من العميل - ' || NEW.payment_type::TEXT,
      v_policy.policy_type_parent::TEXT,
      NEW.policy_id,
      NEW.branch_id,
      NEW.created_by_admin_id,
      NEW.payment_date
    );
  END IF;
  
  RETURN NEW;
END;
$$;