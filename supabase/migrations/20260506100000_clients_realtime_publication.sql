-- Add clients table to the supabase_realtime publication so that
-- UPDATE events (e.g. signature_url being set after a customer signs)
-- are delivered to subscribed clients in real time.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'clients'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.clients';
  END IF;
END $$;
