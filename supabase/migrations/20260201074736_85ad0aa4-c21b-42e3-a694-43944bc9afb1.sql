-- Create a security definer function to get active users for task assignment
-- This bypasses RLS so workers can see all active users in the dropdown
CREATE OR REPLACE FUNCTION public.get_active_users_for_tasks()
RETURNS TABLE (id uuid, full_name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.email
  FROM public.profiles p
  WHERE p.status = 'active'
  ORDER BY p.full_name NULLS LAST;
$$;