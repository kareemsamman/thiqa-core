-- Add locked and source columns to policy_payments for ELZAMI payment immutability
ALTER TABLE public.policy_payments 
ADD COLUMN IF NOT EXISTS locked boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS source text DEFAULT 'user' CHECK (source IN ('user', 'system'));

-- Create a function to prevent modification of locked payments
CREATE OR REPLACE FUNCTION public.prevent_locked_payment_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- For UPDATE: Check if the old record was locked
  IF TG_OP = 'UPDATE' AND OLD.locked = true THEN
    -- Allow only certain fields to be updated even for locked payments
    -- (e.g., receipt_images for documentation purposes)
    IF OLD.payment_type != NEW.payment_type OR
       OLD.amount != NEW.amount OR
       OLD.payment_date != NEW.payment_date OR
       OLD.cheque_number IS DISTINCT FROM NEW.cheque_number THEN
      RAISE EXCEPTION 'Cannot modify locked payment. This is a system-generated payment.';
    END IF;
  END IF;
  
  -- For DELETE: Prevent deletion of locked payments
  IF TG_OP = 'DELETE' AND OLD.locked = true THEN
    RAISE EXCEPTION 'Cannot delete locked payment. This is a system-generated payment.';
  END IF;
  
  -- Allow the operation
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create triggers to enforce locked payment immutability
DROP TRIGGER IF EXISTS prevent_locked_payment_update ON public.policy_payments;
CREATE TRIGGER prevent_locked_payment_update
  BEFORE UPDATE ON public.policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_locked_payment_modification();

DROP TRIGGER IF EXISTS prevent_locked_payment_delete ON public.policy_payments;
CREATE TRIGGER prevent_locked_payment_delete
  BEFORE DELETE ON public.policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_locked_payment_modification();

-- Update payment notification trigger to include ELZAMI label in metadata
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