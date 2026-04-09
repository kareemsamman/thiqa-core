-- Drop existing policies on clients and recreate with branch isolation
DROP POLICY IF EXISTS "Active users can manage clients" ON public.clients;
DROP POLICY IF EXISTS "Active users can view clients" ON public.clients;

CREATE POLICY "Branch users can view clients"
ON public.clients FOR SELECT
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can manage clients"
ON public.clients FOR ALL
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Drop existing policies on policies table and recreate with branch isolation
DROP POLICY IF EXISTS "Active users can manage policies" ON public.policies;
DROP POLICY IF EXISTS "Active users can view policies" ON public.policies;

CREATE POLICY "Branch users can view policies"
ON public.policies FOR SELECT
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can manage policies"
ON public.policies FOR ALL
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Drop existing policies on cars and recreate with branch isolation
DROP POLICY IF EXISTS "Active users can manage cars" ON public.cars;
DROP POLICY IF EXISTS "Active users can view cars" ON public.cars;

CREATE POLICY "Branch users can view cars"
ON public.cars FOR SELECT
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can manage cars"
ON public.cars FOR ALL
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Drop existing policies on invoices and recreate with branch isolation
DROP POLICY IF EXISTS "Active users can create invoices" ON public.invoices;
DROP POLICY IF EXISTS "Active users can view invoices" ON public.invoices;
DROP POLICY IF EXISTS "Admins can manage invoices" ON public.invoices;

CREATE POLICY "Branch users can view invoices"
ON public.invoices FOR SELECT
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can manage invoices"
ON public.invoices FOR ALL
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Drop existing policies on policy_payments and recreate with branch isolation
DROP POLICY IF EXISTS "Active users can manage payments" ON public.policy_payments;
DROP POLICY IF EXISTS "Active users can view payments" ON public.policy_payments;

CREATE POLICY "Branch users can view payments"
ON public.policy_payments FOR SELECT
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can manage payments"
ON public.policy_payments FOR ALL
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Drop existing policies on media_files and recreate with branch isolation
DROP POLICY IF EXISTS "Active users can upload media" ON public.media_files;
DROP POLICY IF EXISTS "Active users can view media" ON public.media_files;
DROP POLICY IF EXISTS "Users can soft delete own media" ON public.media_files;

CREATE POLICY "Branch users can view media"
ON public.media_files FOR SELECT
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id) AND deleted_at IS NULL);

CREATE POLICY "Branch users can upload media"
ON public.media_files FOR INSERT
WITH CHECK (is_active_user(auth.uid()) AND uploaded_by = auth.uid());

CREATE POLICY "Branch users can soft delete own media"
ON public.media_files FOR UPDATE
USING (is_active_user(auth.uid()) AND (uploaded_by = auth.uid() OR has_role(auth.uid(), 'admin')));

-- Drop existing policies on outside_cheques and recreate with branch isolation
DROP POLICY IF EXISTS "Active users can manage outside cheques" ON public.outside_cheques;
DROP POLICY IF EXISTS "Active users can view outside cheques" ON public.outside_cheques;

CREATE POLICY "Branch users can view outside cheques"
ON public.outside_cheques FOR SELECT
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can manage outside cheques"
ON public.outside_cheques FOR ALL
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));