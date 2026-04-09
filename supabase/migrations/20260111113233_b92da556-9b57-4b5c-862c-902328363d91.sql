-- Drop overly permissive policy on announcements
DROP POLICY IF EXISTS "Super admin can manage announcements" ON public.announcements;

-- Create super admin check function (uses existing profiles table with email)
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = _user_id
    AND email = 'morshed500@gmail.com'
    AND status = 'active'
  )
$$;

-- Create policy to allow all authenticated users to READ announcements (needed for popup display)
CREATE POLICY "Authenticated users can view announcements"
ON public.announcements FOR SELECT
TO authenticated
USING (true);

-- Create policy to restrict INSERT/UPDATE/DELETE to super admin only
CREATE POLICY "Only super admin can manage announcements"
ON public.announcements FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admin can update announcements"
ON public.announcements FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admin can delete announcements"
ON public.announcements FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));