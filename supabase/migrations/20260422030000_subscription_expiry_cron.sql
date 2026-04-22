-- =============================================================================
-- Subscription expiry notifications — daily cron
-- =============================================================================
-- Fires once a day and drops a notification on every agent whose
-- trial or paid subscription is about to end (≤ 7 days). The
-- notification targets every admin user on the agent (user_roles.role
-- = 'admin'), links back to /subscription, and is de-duplicated per
-- (agent, kind, day) via a unique index on entity_type + entity_id so
-- the daily re-run can't spam the bell.
--
-- Notifications already exists as a table — we piggyback on the
-- existing bell + read/unread infrastructure instead of building a
-- parallel channel.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. De-dupe key: (entity_type='subscription_expiry_reminder', entity_id=<id>)
--    where <id> = "<agent_id>:<kind>:<yyyy-mm-dd>". The date segment lets us
--    run every day without collision — each day is a fresh reminder.
-- -----------------------------------------------------------------------------

-- No schema change needed; entity_id is already TEXT on notifications
-- (stores UUIDs historically but we can reuse it for composite keys).

-- -----------------------------------------------------------------------------
-- 2. The worker function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_subscription_expiry()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_days_left int;
  v_title text;
  v_message text;
  v_entity_id text;
  v_today date := CURRENT_DATE;
BEGIN
  -- Trial ends soon (up to 7 days out)
  FOR rec IN
    SELECT a.id, a.name_ar, a.name, a.trial_ends_at,
           (a.trial_ends_at::date - v_today) AS days_left
    FROM public.agents a
    WHERE a.subscription_status = 'trial'
      AND a.trial_ends_at IS NOT NULL
      AND a.trial_ends_at::date BETWEEN v_today AND v_today + INTERVAL '7 days'
  LOOP
    v_days_left := rec.days_left;
    v_entity_id := rec.id::text || ':trial:' || v_today::text;
    v_title := 'فترتك التجريبية تنتهي قريباً';
    v_message := CASE
      WHEN v_days_left <= 0 THEN 'انتهت فترتك التجريبية. يرجى الترقية لمتابعة استخدام المنصة.'
      WHEN v_days_left = 1 THEN 'فترتك التجريبية تنتهي غداً. قم بالترقية لمتابعة الخدمة.'
      ELSE 'فترتك التجريبية تنتهي خلال ' || v_days_left || ' أيام. فكّر بالترقية.'
    END;

    INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id, agent_id)
    SELECT ur.user_id,
           'subscription_expiry',
           v_title,
           v_message,
           '/subscription',
           'subscription_expiry_reminder',
           v_entity_id,
           rec.id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin'
      AND p.agent_id = rec.id
      AND p.status = 'active'
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Active paid subscription expiring soon (up to 7 days out)
  FOR rec IN
    SELECT a.id, a.name_ar, a.name, a.subscription_expires_at,
           (a.subscription_expires_at::date - v_today) AS days_left
    FROM public.agents a
    WHERE a.subscription_status = 'active'
      AND a.subscription_expires_at IS NOT NULL
      AND a.subscription_expires_at::date BETWEEN v_today AND v_today + INTERVAL '7 days'
  LOOP
    v_days_left := rec.days_left;
    v_entity_id := rec.id::text || ':sub:' || v_today::text;
    v_title := 'اشتراكك على وشك الانتهاء';
    v_message := CASE
      WHEN v_days_left <= 0 THEN 'انتهى اشتراكك. يرجى التجديد لمتابعة الخدمة.'
      WHEN v_days_left = 1 THEN 'اشتراكك ينتهي غداً. قم بالتجديد لتجنب انقطاع الخدمة.'
      ELSE 'اشتراكك ينتهي خلال ' || v_days_left || ' أيام. فكّر بالتجديد.'
    END;

    INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id, agent_id)
    SELECT ur.user_id,
           'subscription_expiry',
           v_title,
           v_message,
           '/subscription',
           'subscription_expiry_reminder',
           v_entity_id,
           rec.id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'admin'
      AND p.agent_id = rec.id
      AND p.status = 'active'
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. De-dupe index so re-running the same day is a no-op
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_expiry_unique
  ON public.notifications(user_id, entity_type, entity_id)
  WHERE entity_type = 'subscription_expiry_reminder';

-- -----------------------------------------------------------------------------
-- 4. Schedule the job — every day at 08:00 Jerusalem time (06:00 UTC)
-- -----------------------------------------------------------------------------
-- pg_cron may not be exposed in every Supabase project (the cron
-- schema can be present but querying cron.job requires special
-- grants). We wrap the scheduling call in a defensive DO block —
-- anything that raises is caught and logged, so the migration still
-- succeeds even where cron isn't available. Thiqa admin can invoke
-- notify_subscription_expiry() manually as a fallback.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $schedule$
BEGIN
  -- Use cron.unschedule by name; if the job doesn't exist this no-ops.
  BEGIN
    PERFORM cron.unschedule('subscription_expiry_notifications');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'subscription_expiry_notifications',
    '0 6 * * *',
    'SELECT public.notify_subscription_expiry();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END;
$schedule$;
