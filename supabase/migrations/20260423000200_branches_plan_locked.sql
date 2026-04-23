-- =============================================================================
-- PLAN-LOCKED BRANCHES
-- =============================================================================
-- Mirrors the profiles.status = 'plan_locked' pattern for branches.
-- When an agent downgrades and loses branch capacity, the newest
-- branches are flipped to status='plan_locked' (oldest + is_default
-- kept active). Locked branches:
--   * Stay visible everywhere so historical data isn't hidden
--   * Show with a lock badge + upgrade CTA in admin UIs
--   * Cannot be selected when creating a new policy (UI disable +
--     server-side INSERT guard on policies.branch_id)
--   * Don't count toward the plan's branch quota
--
-- When capacity opens back up (upgrade or extra_branch addon on plan
-- change), the oldest plan_locked branches are auto-restored to
-- 'active'.
-- =============================================================================

-- 1. Add the status column. text + CHECK (instead of enum) because
-- branches has never had a status enum and we want a lightweight
-- rollback path.
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.branches
  DROP CONSTRAINT IF EXISTS branches_status_check;

ALTER TABLE public.branches
  ADD CONSTRAINT branches_status_check
  CHECK (status IN ('active', 'plan_locked'));

CREATE INDEX IF NOT EXISTS idx_branches_agent_status
  ON public.branches(agent_id, status);

-- 2. Rewrite enforce_branch_limit:
--    * plan_locked rows skip enforcement entirely
--    * the count is over active rows only (locked rows are parked)
CREATE OR REPLACE FUNCTION public.enforce_branch_limit()
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

  IF COALESCE(NEW.status, 'active') = 'plan_locked' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_limit FROM public.get_agent_effective_limit(NEW.agent_id, 'branches');

  IF v_limit.plan_limit IS NULL THEN
    RETURN NEW;
  END IF;

  v_effective := v_limit.plan_limit + COALESCE(v_limit.addon_quantity, 0);

  SELECT COUNT(*) INTO v_current
  FROM public.branches
  WHERE agent_id = NEW.agent_id
    AND status = 'active'
    AND id <> NEW.id;

  IF v_current >= v_effective THEN
    RAISE EXCEPTION 'LIMIT_EXCEEDED:branches:%:%:%',
      v_limit.plan_key, v_current, v_effective
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Extend sync_plan_change_overflow to reconcile branches too. Same
-- dual-direction logic as users: lock overflow on downgrade, restore
-- oldest locked rows on upgrade. Default branch (is_default=true) is
-- always preferred to stay active so the agent never ends up without
-- one.
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
  v_current_users int;
  v_branches_limit int;
  v_branches_addon int;
  v_effective_branches int;
  v_current_branches int;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.plan = OLD.plan THEN
    RETURN NEW;
  END IF;

  -- ── USERS ────────────────────────────────────────────────────────
  SELECT plan_limit, addon_quantity
    INTO v_users_limit, v_users_addon
  FROM public.get_agent_effective_limit(NEW.id, 'users');

  IF v_users_limit IS NULL THEN
    UPDATE public.profiles
    SET status = 'active'
    WHERE agent_id = NEW.id
      AND status = 'plan_locked';
  ELSE
    v_effective_users := v_users_limit + COALESCE(v_users_addon, 0);

    SELECT COUNT(*) INTO v_current_users
    FROM public.profiles
    WHERE agent_id = NEW.id
      AND status IN ('active', 'pending');

    IF v_current_users > v_effective_users THEN
      UPDATE public.profiles
      SET status = 'plan_locked'
      WHERE id IN (
        SELECT id FROM public.profiles
        WHERE agent_id = NEW.id
          AND status IN ('active', 'pending')
        ORDER BY created_at ASC
        OFFSET v_effective_users
      );
    ELSIF v_current_users < v_effective_users THEN
      UPDATE public.profiles
      SET status = 'active'
      WHERE id IN (
        SELECT id FROM public.profiles
        WHERE agent_id = NEW.id
          AND status = 'plan_locked'
        ORDER BY created_at ASC
        LIMIT (v_effective_users - v_current_users)
      );
    END IF;
  END IF;

  -- ── BRANCHES ─────────────────────────────────────────────────────
  SELECT plan_limit, addon_quantity
    INTO v_branches_limit, v_branches_addon
  FROM public.get_agent_effective_limit(NEW.id, 'branches');

  IF v_branches_limit IS NULL THEN
    UPDATE public.branches
    SET status = 'active'
    WHERE agent_id = NEW.id
      AND status = 'plan_locked';
    RETURN NEW;
  END IF;

  v_effective_branches := v_branches_limit + COALESCE(v_branches_addon, 0);

  SELECT COUNT(*) INTO v_current_branches
  FROM public.branches
  WHERE agent_id = NEW.id
    AND status = 'active';

  IF v_current_branches > v_effective_branches THEN
    -- Downgrade overflow: lock newest non-default first. is_default
    -- DESC keeps the default branch out of the "to-lock" set; inside
    -- the remaining rows we lock the newest.
    UPDATE public.branches
    SET status = 'plan_locked'
    WHERE id IN (
      SELECT id FROM public.branches
      WHERE agent_id = NEW.id
        AND status = 'active'
      ORDER BY is_default DESC, created_at ASC
      OFFSET v_effective_branches
    );
  ELSIF v_current_branches < v_effective_branches THEN
    -- Capacity opened up: restore oldest plan_locked rows first.
    UPDATE public.branches
    SET status = 'active'
    WHERE id IN (
      SELECT id FROM public.branches
      WHERE agent_id = NEW.id
        AND status = 'plan_locked'
      ORDER BY is_default DESC, created_at ASC
      LIMIT (v_effective_branches - v_current_branches)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Belt-and-suspenders: stop new policies from binding to a
-- plan_locked branch. Existing rows are untouched — only INSERTs.
CREATE OR REPLACE FUNCTION public.block_policies_on_locked_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_status
  FROM public.branches
  WHERE id = NEW.branch_id;

  IF v_status = 'plan_locked' THEN
    RAISE EXCEPTION 'BRANCH_LOCKED:%', NEW.branch_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_policies_on_locked_branch ON public.policies;
CREATE TRIGGER trg_block_policies_on_locked_branch
  BEFORE INSERT ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.block_policies_on_locked_branch();
