-- user_sessions: join the supabase_realtime publication so the kick
-- signal propagates instantly to the target tab.
--
-- The new realtime subscription in useSessionTracker listens for an
-- UPDATE with a non-null kicked_at on the user's own session row and
-- signs them out immediately. That subscription only delivers events
-- for tables explicitly added to the supabase_realtime publication;
-- without this line the admin's "طرد" stamp would just sit in the DB
-- until the next 30s heartbeat.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_sessions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_sessions';
  END IF;
END $$;
