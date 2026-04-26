-- =============================================================================
-- Restore agent-admin UPDATE access to profiles
-- =============================================================================
-- Migration 20260308140717 dropped the old "Admins can update all profiles"
-- policy as part of the cross-agent permission tightening, and the follow-up
-- 20260308141947 only added a SELECT policy on profiles. As a result, agent
-- admins could no longer update any team member's profile — including the
-- common block / unblock / activate flow on /admin/users.
--
-- The visible symptom: clicking "إلغاء الحظر" on the admin users page
-- returned a successful toast (Supabase doesn't error when an UPDATE matches
-- zero rows under RLS) but the user stayed blocked because the row never
-- changed.
--
-- Fix: add an UPDATE policy scoped to (admin in this agent) AND
-- (target profile in same agent). Mirrors the existing select policy's
-- agent-scoping; refuses cross-agent updates.
-- =============================================================================

DROP POLICY IF EXISTS agent_admin_update_profiles ON public.profiles;

CREATE POLICY agent_admin_update_profiles ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    -- Caller must be an admin in the same agent as the row being updated.
    public.has_role(auth.uid(), 'admin'::app_role)
    AND agent_id = public.get_my_agent_id()
  )
  WITH CHECK (
    -- After update, the row must still belong to the caller's agent so an
    -- admin can't move a profile to a different tenant.
    public.has_role(auth.uid(), 'admin'::app_role)
    AND agent_id = public.get_my_agent_id()
  );
