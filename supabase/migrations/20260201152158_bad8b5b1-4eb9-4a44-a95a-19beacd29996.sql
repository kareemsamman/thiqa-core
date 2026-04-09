-- Fix expenses table RLS: restrict to admin users only
-- Workers should not have access to company financial expenses

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can view expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated users can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated users can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated users can delete expenses" ON public.expenses;

-- Add admin-only policies
CREATE POLICY "Admins can view expenses"
ON public.expenses FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert expenses"
ON public.expenses FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update expenses"
ON public.expenses FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete expenses"
ON public.expenses FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));