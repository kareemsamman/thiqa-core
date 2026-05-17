-- ============================================================
-- Schedule cron-birthday-license-sms edge function daily.
--
-- Target wall-clock: 14:00 Asia/Jerusalem (the agent requested
-- 2 PM local). pg_cron schedules in UTC, so:
--   * Summer (IDT, UTC+3): 11:00 UTC ≈ 14:00 local
--   * Winter (IST, UTC+2): 11:00 UTC ≈ 13:00 local
--
-- Living with the ±1hr DST drift is simpler than maintaining
-- two season-specific jobs. Renewal reminders take the same
-- approach at 08:00 UTC.
--
-- Service-role JWT comes from Supabase Vault — the admin has to
-- seed it ONCE per project:
--
--   SELECT vault.create_secret(
--     '<SERVICE_ROLE_KEY>',
--     'service_role_key',
--     'JWT used by pg_cron to invoke edge functions'
--   );
--
-- The renewal cron already shares this secret, so if that one is
-- running the birthday cron will too. Missing secret → POST hits
-- the gateway with no auth and the function never executes; check
-- net._http_response for the 401.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $schedule$
BEGIN
  BEGIN
    PERFORM cron.unschedule('birthday_license_sms_daily');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'birthday_license_sms_daily',
    '0 11 * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://oxsxmvxtblcideimcgnr.supabase.co/functions/v1/cron-birthday-license-sms',
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
  RAISE NOTICE 'birthday_license_sms_daily scheduling skipped: %', SQLERRM;
END;
$schedule$;
