
-- Fix: When a payment is inserted with NULL branch_id, 
-- set it to the user's branch_id from their profile
CREATE OR REPLACE FUNCTION public.set_payment_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_branch_id uuid;
BEGIN
  -- If branch_id is already set, keep it
  IF NEW.branch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get the current user's branch_id from their profile
  SELECT branch_id INTO user_branch_id
  FROM public.profiles
  WHERE id = auth.uid();
  
  -- Set the payment's branch_id to the user's branch
  IF user_branch_id IS NOT NULL THEN
    NEW.branch_id := user_branch_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger on policy_payments
DROP TRIGGER IF EXISTS set_payment_branch_id_trigger ON public.policy_payments;
CREATE TRIGGER set_payment_branch_id_trigger
  BEFORE INSERT ON public.policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_payment_branch_id();
