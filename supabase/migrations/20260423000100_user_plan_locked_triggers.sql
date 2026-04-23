-- =============================================================================
-- PLAN-LOCKED USER STATUS — step 2: reshape overflow + enforcement triggers
-- =============================================================================
-- Previously the overflow trigger wrote status='blocked' on excess
-- users after a plan downgrade, which mixed them into the admin
-- "blocked" tab next to intentionally-banned users. This rewrite:
--
--   1. Writes the new 'plan_locked' status (added in migration
--      20260423000000) so the UI can keep these rows in the active
--      tab with a lock badge + upgrade CTA while still denying login.
--   2. Auto-restores plan_locked → active when a plan change frees
--      capacity (oldest locked first), so upgrading / adding seats
--      is the natural unlock path.
--   3. Skips the user-limit guard for rows entering blocked or
--      plan_locked, since those don't consume seats.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_plan_change_overflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_users_limit int;
  v_users_addon int;
  v_effective_users int;
  v_current int;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.plan = OLD.plan THEN
    RETURN NEW;
  END IF;

  SELECT plan_limit, addon_quantity
    INTO v_users_limit, v_users_addon
  FROM public.get_agent_effective_limit(NEW.id, 'users');

  -- Unlimited plan → nothing to reconcile, and restore any leftover
  -- plan_locked users (edge case: finite → unlimited upgrade).
  IF v_users_limit IS NULL THEN
    UPDATE public.profiles
    SET status = 'active'
    WHERE agent_id = NEW.id
      AND status = 'plan_locked';
    RETURN NEW;
  END IF;

  v_effective_users := v_users_limit + COALESCE(v_users_addon, 0);

  SELECT COUNT(*) INTO v_current
  FROM public.profiles
  WHERE agent_id = NEW.id
    AND status IN ('active', 'pending');

  IF v_current > v_effective_users THEN
    -- Downgrade overflow: lock the newest rows (keep earliest active).
    UPDATE public.profiles
    SET status = 'plan_locked'
    WHERE id IN (
      SELECT id FROM public.profiles
      WHERE agent_id = NEW.id
        AND status IN ('active', 'pending')
      ORDER BY created_at ASC
      OFFSET v_effective_users
    );
  ELSIF v_current < v_effective_users THEN
    -- Capacity opened up: restore oldest plan_locked rows first.
    UPDATE public.profiles
    SET status = 'active'
    WHERE id IN (
      SELECT id FROM public.profiles
      WHERE agent_id = NEW.id
        AND status = 'plan_locked'
      ORDER BY created_at ASC
      LIMIT (v_effective_users - v_current)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_user_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit RECORD;
  v_effective int;
  v_current int;
BEGIN
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Non-counting statuses skip enforcement entirely.
  IF COALESCE(NEW.status, 'pending') IN ('blocked', 'plan_locked') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_limit FROM public.get_agent_effective_limit(NEW.agent_id, 'users');

  IF v_limit.plan_limit IS NULL THEN
    RETURN NEW;
  END IF;

  v_effective := v_limit.plan_limit + COALESCE(v_limit.addon_quantity, 0);

  SELECT COUNT(*) INTO v_current
  FROM public.profiles
  WHERE agent_id = NEW.agent_id
    AND status IN ('active', 'pending')
    AND id <> NEW.id;

  IF v_current >= v_effective THEN
    RAISE EXCEPTION 'LIMIT_EXCEEDED:users:%:%:%',
      v_limit.plan_key, v_current, v_effective
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
