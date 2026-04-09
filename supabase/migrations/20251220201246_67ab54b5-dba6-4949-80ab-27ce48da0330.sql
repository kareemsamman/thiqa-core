-- Add notification trigger for new payments
CREATE OR REPLACE FUNCTION public.notify_on_payment_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name TEXT;
  v_policy_number TEXT;
  v_admin_users UUID[];
BEGIN
  -- Get client and policy info
  SELECT c.full_name, p.policy_number
  INTO v_client_name, v_policy_number
  FROM public.policies pol
  JOIN public.clients c ON c.id = pol.client_id
  LEFT JOIN public.policies p ON p.id = pol.id
  WHERE pol.id = NEW.policy_id;
  
  -- Get all active users in the same branch
  SELECT ARRAY_AGG(p.id) INTO v_admin_users
  FROM public.profiles p
  WHERE p.status = 'active'
  AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);
  
  -- Insert notification for each user
  IF v_admin_users IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id)
    SELECT 
      unnest(v_admin_users),
      'payment',
      'دفعة جديدة',
      'تم استلام دفعة بمبلغ ₪' || NEW.amount::text || ' من العميل ' || COALESCE(v_client_name, 'غير معروف'),
      '/policies',
      'policy_payment',
      NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for payments
DROP TRIGGER IF EXISTS on_payment_received ON public.policy_payments;
CREATE TRIGGER on_payment_received
  AFTER INSERT ON public.policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_payment_received();

-- Add notification trigger for new policies
CREATE OR REPLACE FUNCTION public.notify_on_policy_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name TEXT;
  v_admin_users UUID[];
BEGIN
  -- Get client name
  SELECT full_name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;
  
  -- Get all active users in the same branch
  SELECT ARRAY_AGG(p.id) INTO v_admin_users
  FROM public.profiles p
  WHERE p.status = 'active'
  AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);
  
  -- Insert notification for each user
  IF v_admin_users IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id)
    SELECT 
      unnest(v_admin_users),
      'policy',
      'وثيقة جديدة',
      'تم إنشاء وثيقة جديدة للعميل ' || COALESCE(v_client_name, 'غير معروف'),
      '/policies',
      'policy',
      NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for new policies
DROP TRIGGER IF EXISTS on_policy_created ON public.policies;
CREATE TRIGGER on_policy_created
  AFTER INSERT ON public.policies
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_policy_created();

-- Add notification trigger for new clients
CREATE OR REPLACE FUNCTION public.notify_on_client_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_users UUID[];
BEGIN
  -- Get all active users in the same branch
  SELECT ARRAY_AGG(p.id) INTO v_admin_users
  FROM public.profiles p
  WHERE p.status = 'active'
  AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);
  
  -- Insert notification for each user
  IF v_admin_users IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id)
    SELECT 
      unnest(v_admin_users),
      'client',
      'عميل جديد',
      'تم إضافة عميل جديد: ' || COALESCE(NEW.full_name, 'غير معروف'),
      '/clients',
      'client',
      NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for new clients
DROP TRIGGER IF EXISTS on_client_created ON public.clients;
CREATE TRIGGER on_client_created
  AFTER INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_client_created();