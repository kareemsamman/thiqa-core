-- Add super admin full access on user_roles
CREATE POLICY "Super admin full access on user_roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (is_super_admin(auth.uid()));

-- Add super admin full access on branches
CREATE POLICY "Super admin full access on branches"
ON public.branches
FOR ALL
TO authenticated
USING (is_super_admin(auth.uid()));