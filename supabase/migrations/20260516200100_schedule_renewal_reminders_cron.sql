-- ============================================================
-- Schedule cron-renewal-reminders edge function daily.
--
-- pg_cron uses UTC; 08:00 UTC ≈ 11:00 Asia/Jerusalem in summer
-- (IDT, UTC+3) and 10:00 in winter (IST, UTC+2). Living with the
-- ±1hr DST drift is simpler than maintaining a per-season job
-- list. If a tighter "exactly 11 AM local" guarantee is needed
-- later, switch to a tz-aware job (pg_cron 1.6+ supports the
-- `cron.timezone` GUC) or split into two schedules.
--
-- The cron body calls net.http_post — both extensions are
-- enabled by default on Supabase. The service-role JWT is
-- read at run-time from Supabase Vault rather than baked into
-- the cron definition (which would leak it via cron.job rows).
-- Admin must seed the secret ONCE per project, e.g.:
--
--   SELECT vault.create_secret(
--     '<SERVICE_ROLE_KEY>',
--     'service_role_key',
--     'JWT used by pg_cron to invoke edge functions'
--   );
--
-- If the vault entry is missing, the cron still runs but the
-- POST will fail at the gateway with 401 — the edge function
-- itself never executes, so no SMS goes out. The log line in
-- net._http_response will show the failure.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $schedule$
BEGIN
  -- Unschedule any previous run; cron.unschedule throws if the name
  -- isn't registered, so swallow the not-found case.
  BEGIN
    PERFORM cron.unschedule('renewal_reminders_daily');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'renewal_reminders_daily',
    '0 8 * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://oxsxmvxtblcideimcgnr.supabase.co/functions/v1/cron-renewal-reminders',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'service_role_key'
          LIMIT 1
        ),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) AS request_id;
    $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'renewal_reminders_daily scheduling skipped: %', SQLERRM;
END;
$schedule$;
