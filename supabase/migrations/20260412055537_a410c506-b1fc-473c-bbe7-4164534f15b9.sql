
-- =============================================
-- FIX 1: xservice_sync_log — add agent_id and scope RLS
-- =============================================

-- Add agent_id column
ALTER TABLE public.xservice_sync_log ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Backfill agent_id from policies
UPDATE public.xservice_sync_log sl
SET agent_id = p.agent_id
FROM public.policies p
WHERE sl.policy_id = p.id AND sl.agent_id IS NULL;

-- Drop old overly-permissive policies
DROP POLICY IF EXISTS "Authenticated users can read xservice_sync_log" ON public.xservice_sync_log;
DROP POLICY IF EXISTS "Service role can insert xservice_sync_log" ON public.xservice_sync_log;
DROP POLICY IF EXISTS "Service role can update xservice_sync_log" ON public.xservice_sync_log;

-- New agent-scoped SELECT policy
CREATE POLICY "Agent users can read own sync logs"
  ON public.xservice_sync_log FOR SELECT
  TO authenticated
  USING (public.user_belongs_to_agent(auth.uid(), agent_id));

-- INSERT/UPDATE only via service role (edge functions)
CREATE POLICY "Service role can insert sync logs"
  ON public.xservice_sync_log FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update sync logs"
  ON public.xservice_sync_log FOR UPDATE
  TO service_role
  USING (true);

-- =============================================
-- FIX 2: thiqa_super_admins — restrict SELECT to super admins only
-- =============================================

-- Drop old permissive SELECT policy
DROP POLICY IF EXISTS "Authenticated users can read super admins" ON public.thiqa_super_admins;

-- Only super admins can read the table
CREATE POLICY "Super admins can read super admins"
  ON public.thiqa_super_admins FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Create RPC for non-admin users to get contact emails (limited info)
CREATE OR REPLACE FUNCTION public.get_admin_contact_emails()
RETURNS TABLE(email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sa.email
  FROM public.thiqa_super_admins sa
  WHERE sa.email LIKE '%@%'
    AND sa.email NOT LIKE '%@phone.local'
$$;
