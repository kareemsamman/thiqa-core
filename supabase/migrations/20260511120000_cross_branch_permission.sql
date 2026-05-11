-- Cross-branch worker permission.
--
-- The current model only supports two roles: admin (sees everything in
-- their agent) and worker (sees only their assigned branch). An agent
-- with multiple branches sometimes has a "manager-like" worker who
-- needs visibility across all branches without inheriting admin
-- privileges. There's no in-between today.
--
-- This migration introduces a per-user permission `access.all_branches`
-- that grants cross-branch visibility — both via the RLS function
-- can_access_branch (used by direct PostgREST queries on clients/cars/
-- policies/etc) and via can_see_all_branches (used by the dashboard
-- and report RPCs). The permission is read from profiles.permissions
-- with a fallback to the agent's default_employee_permissions, exactly
-- like the existing usePermissions hook resolves keys.

-- ── Helper: does this user have the cross-branch permission? ───────
CREATE OR REPLACE FUNCTION public.user_has_all_branches(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH p AS (
    SELECT (permissions ->> 'access.all_branches')::boolean AS pflag
    FROM public.profiles
    WHERE id = _user_id
  ),
  ag AS (
    SELECT (a.default_employee_permissions ->> 'access.all_branches')::boolean AS aflag
    FROM public.agent_users au
    JOIN public.agents a ON a.id = au.agent_id
    WHERE au.user_id = _user_id
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT pflag FROM p),
    (SELECT aflag FROM ag),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_has_all_branches(uuid) TO authenticated;


-- ── can_access_branch: honor the new permission ────────────────────
--
-- Keep the existing cross-agent guard, the admin shortcut, and the
-- branch-scope rule. The new clause sits between admin and the
-- branch-scope rule: a worker with access.all_branches behaves like an
-- admin for branch checks but doesn't gain any other admin rights.
CREATE OR REPLACE FUNCTION public.can_access_branch(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_agent_id uuid;
  _branch_agent_id uuid;
BEGIN
  SELECT agent_id INTO _user_agent_id FROM public.agent_users WHERE user_id = _user_id LIMIT 1;

  IF _branch_id IS NOT NULL THEN
    SELECT agent_id INTO _branch_agent_id FROM public.branches WHERE id = _branch_id;
    IF _branch_agent_id IS NOT NULL
       AND _user_agent_id IS NOT NULL
       AND _branch_agent_id <> _user_agent_id THEN
      RETURN false;
    END IF;
  END IF;

  IF public.has_role(_user_id, 'admin') THEN RETURN true; END IF;

  -- New: per-user cross-branch grant. NULL branch_id is still allowed
  -- so cross-branch workers can see un-branched rows too.
  IF public.user_has_all_branches(_user_id) THEN RETURN true; END IF;

  IF _branch_id IS NULL THEN RETURN false; END IF;
  RETURN (SELECT branch_id FROM public.profiles WHERE id = _user_id) = _branch_id;
END;
$$;


-- ── can_see_all_branches: same extension ──────────────────────────
--
-- Used by SECURITY DEFINER RPCs (dashboard, reports) that bypass RLS
-- and apply the branch filter manually inside the function body. We
-- mirror the same gate: super admin, agent admin with no branch, OR a
-- user explicitly granted access.all_branches.
CREATE OR REPLACE FUNCTION public.can_see_all_branches()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin(auth.uid())
    OR (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'admin'
      )
      AND (SELECT branch_id FROM public.profiles WHERE id = auth.uid()) IS NULL
    )
    OR public.user_has_all_branches(auth.uid())
$$;

GRANT EXECUTE ON FUNCTION public.can_see_all_branches() TO authenticated;


-- ── Grant the permission to the requested worker right away ────────
--
-- One-off data update so the cross-branch view works for
-- kasteroashrakat98@gmail.com without needing a trip through the
-- admin UI. Idempotent: jsonb merge sets the key to true and leaves
-- the rest of the permissions map intact.
UPDATE public.profiles
   SET permissions = COALESCE(permissions, '{}'::jsonb)
                     || jsonb_build_object('access.all_branches', true)
 WHERE id = (SELECT id FROM auth.users WHERE email = 'kasteroashrakat98@gmail.com');
