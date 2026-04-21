-- user_sessions: heartbeat column so the UI can tell stale rows apart.
--
-- Closing a tab or killing the browser doesn't reliably trigger the
-- client's beforeunload update (sendBeacon skips auth headers, mobile
-- Chrome backgrounds the unload handler, etc.), so is_active=true rows
-- pile up forever even after the user has actually left.
--
-- Add last_seen_at. The client ticks it every ~30s while the tab is
-- alive; the UI considers a session "currently active" only when
-- is_active AND last_seen_at is within the last ~90s. Old rows stay in
-- the table (so history + total-hours still work) but stop misleading
-- the "نشط حالياً" badge.

ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_user_sessions_last_seen_at
  ON public.user_sessions (last_seen_at DESC);
