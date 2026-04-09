-- Fix can_access_branch function to handle null branch_id correctly
-- This fixes RLS errors when creating payments with null branch_id

CREATE OR REPLACE FUNCTION public.can_access_branch(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins can access all branches (including null)
  IF public.has_role(_user_id, 'admin') THEN
    RETURN true;
  END IF;
  
  -- If branch_id is null, deny access for non-admins
  IF _branch_id IS NULL THEN
    RETURN false;
  END IF;
  
  -- Workers can only access their assigned branch
  RETURN (SELECT branch_id FROM public.profiles WHERE id = _user_id) = _branch_id;
END;
$$;