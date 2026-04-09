-- Update payment notification trigger to include metadata with payment details
CREATE OR REPLACE FUNCTION public.notify_on_payment_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name TEXT;
  v_client_id UUID;
  v_policy_number TEXT;
  v_admin_users UUID[];
  v_metadata JSONB;
BEGIN
  -- Get client and policy info
  SELECT c.full_name, c.id, p.policy_number
  INTO v_client_name, v_client_id, v_policy_number
  FROM public.policies pol
  JOIN public.clients c ON c.id = pol.client_id
  LEFT JOIN public.policies p ON p.id = pol.id
  WHERE pol.id = NEW.policy_id;
  
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
      'type', 'premium',
      'type_labels', ARRAY['قسط']::text[],
      'reference', NEW.cheque_number,
      'notes', NEW.notes,
      'cheque', CASE 
        WHEN NEW.payment_type = 'cheque' THEN jsonb_build_object(
          'number', NEW.cheque_number,
          'due_date', NEW.cheque_date
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
      'دفعة جديدة',
      'تم استلام دفعة بمبلغ ₪' || NEW.amount::text || ' من العميل ' || COALESCE(v_client_name, 'غير معروف'),
      '/policies',
      'policy_payment',
      NEW.id,
      v_metadata;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Ensure the trigger exists
DROP TRIGGER IF EXISTS on_payment_received ON public.policy_payments;
CREATE TRIGGER on_payment_received
  AFTER INSERT ON public.policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_payment_received();