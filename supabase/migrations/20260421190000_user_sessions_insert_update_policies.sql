-- user_sessions: restore INSERT + UPDATE policies that 20260421180000
-- accidentally dropped.
--
-- The previous migration replaced the "Admins can view user sessions"
-- policy (which was FOR ALL and therefore also covered INSERT/UPDATE
-- coming from the client-side useSessionTracker hook) with a narrow
-- FOR SELECT agent-scoped policy. Net effect: signed-in users can no
-- longer write their own session rows and the Sessions tab stays empty
-- even for live logins.
--
-- Add explicit INSERT and UPDATE policies so each user can manage their
-- own row. SELECT stays agent-scoped via can_view_user_session.

CREATE POLICY "Users can insert own sessions"
ON public.user_sessions
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own sessions"
ON public.user_sessions
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
