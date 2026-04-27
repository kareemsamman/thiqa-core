-- ============================================================
-- get_my_agent_admin_contact() — surface the AGENT's own admin
-- contact info to a locked worker on /no-access
--
-- Background: the lockout screen used to read get_admin_contact_emails(),
-- which returns the Thiqa platform super admins (morshed500@gmail.com
-- etc.). That's the wrong contact for "your agency manager needs to
-- upgrade your plan" — the worker needs to reach the OWNER of their
-- own agency, not Thiqa support.
--
-- This RPC resolves the caller's agent via agent_users (same path used
-- by every other "scope to my agent" helper) and returns the canonical
-- contact triple (name, email, phone) stored on agents — the values
-- the agent registered with and that the Thiqa admin can edit on
-- /thiqa/agents/<id>.
--
-- SECURITY DEFINER + locked-down search_path so a plan_locked profile
-- (whose RLS context might block direct reads on agents) can still
-- get this lookup back through the function's elevated privileges.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_agent_admin_contact()
RETURNS TABLE (
  agent_name text,
  email text,
  phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(a.name_ar, a.name)::text AS agent_name,
    a.email::text                     AS email,
    a.phone::text                     AS phone
  FROM public.agents a
  JOIN public.agent_users au ON au.agent_id = a.id
  WHERE au.user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_agent_admin_contact() TO authenticated;
