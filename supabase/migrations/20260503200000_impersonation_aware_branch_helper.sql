-- Fix-up to 20260503190000: making is_super_admin(auth.uid()) return
-- false during impersonation broke can_see_all_branches() as a side
-- effect. That helper drives the branch isolation clamp on every
-- dashboard / report RPC:
--
--   AND (v_see_all OR x.branch_id IS NULL OR x.branch_id = v_my_branch)
--
-- A super admin has profiles.branch_id = NULL (they're not branch-
-- scoped), so when can_see_all_branches() returned true the clamp was
-- a no-op. Now during impersonation v_see_all flips to false and the
-- clamp keeps only rows with branch_id = NULL, hiding every row whose
-- branch_id is actually set — which is most of them. The agent
-- dashboard then reads "0 customers" for an agent that has 1.
--
-- Fix: treat an active impersonation session as a "see all branches"
-- grant. The semantics line up with how impersonation worked before
-- the helper rewrite — the super admin sees the whole impersonated
-- tenant, not a branch slice of it.

CREATE OR REPLACE FUNCTION public.can_see_all_branches()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.impersonation_sessions
      WHERE super_admin_user_id = auth.uid()
    )
    OR public.is_super_admin(auth.uid())
    OR (
      EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role = 'admin'
      )
      AND (SELECT branch_id FROM public.profiles WHERE id = auth.uid()) IS NULL
    );
$$;
