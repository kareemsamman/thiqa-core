-- user_sessions: auto-populate agent_id + scope SELECT by agent.
--
-- Background: user_sessions.agent_id became NOT NULL in a dashboard
-- migration, but the auth edge functions (auth-email-verify /
-- auth-sms-verify) call
--   supabase.from("user_sessions").insert({ user_id, ip_address, ... })
-- without ever setting agent_id. Every session insert since has failed
-- the NOT NULL constraint, silently — the auth response doesn't check
-- the insert's error, so login still succeeds but no session row is
-- persisted. Result: /admin/users' "الجلسات" tab is permanently empty.
--
-- Separately, the original SELECT policy ("Admins can view user
-- sessions") keys on public.has_role(auth.uid(), 'admin') — a global
-- role check with no agent scope. Even if sessions were being
-- persisted, a per-agent admin couldn't see their own team's rows.
--
-- Fix, symmetric to 20260421170000 for login_attempts:
--   1) BEFORE INSERT/UPDATE trigger that resolves agent_id from
--      profiles via user_id when the caller didn't supply it, so the
--      auth edge functions work unchanged.
--   2) Replace the SELECT policy with an agent-scoped helper that
--      mirrors can_view_login_attempt_agent.

CREATE OR REPLACE FUNCTION public.user_sessions_set_agent_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.agent_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT p.agent_id
    INTO NEW.agent_id
    FROM public.profiles p
    WHERE p.id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_sessions_set_agent_id ON public.user_sessions;
CREATE TRIGGER trg_user_sessions_set_agent_id
BEFORE INSERT OR UPDATE ON public.user_sessions
FOR EACH ROW
EXECUTE FUNCTION public.user_sessions_set_agent_id();

-- Scope SELECT: user sees their own sessions, agent admin sees their
-- agent's sessions, super admin sees all.
CREATE OR REPLACE FUNCTION public.can_view_user_session(_session_agent_id uuid, _session_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.is_super_admin(auth.uid()) THEN true
    WHEN _session_user_id IS NOT NULL AND _session_user_id = auth.uid() THEN true
    WHEN _session_agent_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles me
      WHERE me.user_id = auth.uid()
        AND me.role = 'admin'::public.app_role
        AND me.agent_id = _session_agent_id
    )
  END
$$;

DROP POLICY IF EXISTS "Admins can view user sessions" ON public.user_sessions;
DROP POLICY IF EXISTS "Users/admins can view scoped user sessions" ON public.user_sessions;
CREATE POLICY "Users/admins can view scoped user sessions"
ON public.user_sessions
FOR SELECT
TO authenticated
USING (public.can_view_user_session(agent_id, user_id));
