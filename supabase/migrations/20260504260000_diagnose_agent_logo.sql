-- One-off diagnostic: print the agents.logo_url for the ali masri
-- account so we can tell whether the renewals report header has no
-- image because the URL is missing or because it's failing to load.
-- This emits a NOTICE during push and does not modify state.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT a.id, a.name, a.name_ar, a.logo_url, p.email
    FROM agents a
    JOIN profiles p ON p.agent_id = a.id
    WHERE p.email = 'ali.masri.22@gmail.com'
  LOOP
    RAISE NOTICE 'agent % (%) logo_url=%', r.name, r.email, COALESCE(r.logo_url, '<null>');
  END LOOP;
END $$;
