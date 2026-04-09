
-- 1. Fix is_super_admin to use auth.users email directly (no profile dependency)
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = _user_id
    AND email = 'morshed500@gmail.com'
  )
$$;

-- 2. Allow users to update their own profile
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- 3. Super admin full access on site_settings
CREATE POLICY "Super admin full access on site_settings"
ON public.site_settings
FOR ALL
TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- 4. Super admin full access on sms_settings
CREATE POLICY "Super admin full access on sms_settings"
ON public.sms_settings
FOR ALL
TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- 5. Super admin full access on auth_settings
CREATE POLICY "Super admin full access on auth_settings"
ON public.auth_settings
FOR ALL
TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- 6. Super admin full access on payment_settings
CREATE POLICY "Super admin full access on payment_settings"
ON public.payment_settings
FOR ALL
TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

-- 7. Super admin full access on profiles (INSERT + SELECT + UPDATE + DELETE)
CREATE POLICY "Super admin full access on profiles"
ON public.profiles
FOR ALL
TO authenticated
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));
