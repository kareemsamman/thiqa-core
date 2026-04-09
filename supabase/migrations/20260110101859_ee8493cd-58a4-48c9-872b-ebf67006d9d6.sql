-- Drop the existing ALL policy and recreate it properly with WITH CHECK
DROP POLICY IF EXISTS "Branch users can manage payments" ON public.policy_payments;

-- Create separate policies for INSERT, UPDATE, DELETE with proper WITH CHECK
CREATE POLICY "Branch users can insert payments"
ON public.policy_payments
FOR INSERT
TO authenticated
WITH CHECK (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can update payments"
ON public.policy_payments
FOR UPDATE
TO authenticated
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id))
WITH CHECK (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can delete payments"
ON public.policy_payments
FOR DELETE
TO authenticated
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));