-- Fix policy_payments cheque_date error & keep notification metadata working
BEGIN;

-- policy_payments trigger function references NEW.cheque_date; ensure the column exists
ALTER TABLE public.policy_payments
  ADD COLUMN IF NOT EXISTS cheque_date date;

-- Make notification trigger resilient and use payment_date as fallback due date
CREATE OR REPLACE FUNCTION public.notify_on_payment_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name TEXT;
  v_client_id UUID;
  v_policy_type_parent TEXT;
  v_admin_users UUID[];
  v_metadata JSONB;
  v_type_label TEXT;
  v_type_labels TEXT[];
BEGIN
  -- Get client and policy info
  SELECT c.full_name, c.id, pol.policy_type_parent
  INTO v_client_name, v_client_id, v_policy_type_parent
  FROM public.policies pol
  JOIN public.clients c ON c.id = pol.client_id
  WHERE pol.id = NEW.policy_id;

  -- Determine type label based on policy type and if it's locked/system-generated
  IF NEW.locked = true AND NEW.source = 'system' THEN
    v_type_label := 'settlement';
    v_type_labels := ARRAY['تسوية شركة'];
    IF v_policy_type_parent = 'ELZAMI' THEN
      v_type_labels := ARRAY['إلزامي – دفعة تلقائية'];
    END IF;
  ELSE
    v_type_label := 'premium';
    v_type_labels := ARRAY['قسط'];
  END IF;

  -- Build metadata with payment details
  v_metadata := jsonb_build_object(
    'payment', jsonb_build_object(
      'payment_id', NEW.id,
      'policy_id', NEW.policy_id,
      'client_id', v_client_id,
      'client_name', COALESCE(v_client_name, 'غير معروف'),
      'amount', NEW.amount,
      'currency', 'ILS',
      'method', COALESCE(NEW.payment_type, 'cash'),
      'type', v_type_label,
      'type_labels', v_type_labels,
      'reference', NEW.cheque_number,
      'notes', NEW.notes,
      'cheque', CASE
        WHEN NEW.payment_type = 'cheque' THEN jsonb_build_object(
          'number', NEW.cheque_number,
          'due_date', COALESCE(NEW.cheque_date, NEW.payment_date)
        )
        ELSE NULL
      END,
      'installment', NULL
    ),
    -- Keep legacy fields for backward compatibility
    'payment_method', COALESCE(NEW.payment_type, 'cash'),
    'amount', NEW.amount,
    'client_name', COALESCE(v_client_name, 'غير معروف'),
    'payment_id', NEW.id,
    'reference', NEW.cheque_number
  );

  -- Get all active users in the same branch
  SELECT ARRAY_AGG(p.id) INTO v_admin_users
  FROM public.profiles p
  WHERE p.status = 'active'
    AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);

  -- Insert notification for each user
  IF v_admin_users IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id, metadata)
    SELECT
      unnest(v_admin_users),
      'payment',
      CASE
        WHEN NEW.locked = true AND v_policy_type_parent = 'ELZAMI' THEN 'دفعة إلزامي تلقائية'
        ELSE 'دفعة جديدة'
      END,
      'تم استلام دفعة بمبلغ ₪' || NEW.amount::text || ' من العميل ' || COALESCE(v_client_name, 'غير معروف'),
      '/policies',
      'policy_payment',
      NEW.id,
      v_metadata;
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure the trigger exists and points to the updated function
DROP TRIGGER IF EXISTS on_payment_received ON public.policy_payments;
CREATE TRIGGER on_payment_received
  AFTER INSERT ON public.policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_payment_received();

COMMIT;