-- user_sessions: track the page each live session is on + let admins
-- kick a session remotely.
--
-- The admin's Sessions tab already knows who's signed in and when, but
-- not what page they're looking at right now. Add current_path so the
-- client tracker can PATCH it on every route change, and the admin can
-- see "this worker is on /tasks".
--
-- kicked_at is the mechanism for remote sign-out: an edge function
-- (called from the admin's kick button) stamps now() into this column,
-- the target session's heartbeat picks it up on its next tick (within
-- ~30s) and the client calls auth.signOut + redirects to /login. No
-- realtime subscription needed — reuses the heartbeat that's already
-- running.

ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS current_path text,
  ADD COLUMN IF NOT EXISTS kicked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_user_sessions_kicked_at
  ON public.user_sessions (kicked_at)
  WHERE kicked_at IS NOT NULL;
