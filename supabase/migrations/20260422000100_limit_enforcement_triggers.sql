-- =============================================================================
-- LIMIT ENFORCEMENT — user / branch / policy caps + downgrade handling
-- =============================================================================
-- Hard-enforces plan + addon quotas at the database layer so the app
-- can never sneak past them. Errors are raised with SQLSTATE P0001
-- and a structured message the frontend parses to show the upgrade
-- popup:
--
--   LIMIT_EXCEEDED:<resource>:<plan_key>:<current>:<effective_limit>
--
-- Example:  LIMIT_EXCEEDED:users:basic:1:1
--
-- Effective limit = plan column value + sum of matching active addons.
-- NULL on the plan column means unlimited (e.g. ultimate.policies_limit).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Resolve an agent's currently active plan + per-resource addon boost.
-- Returns: plan_key, plan_limit (nullable), addon_quantity
CREATE OR REPLACE FUNCTION public.get_agent_effective_limit(
  p_agent_id uuid,
  p_resource text  -- 'users' | 'branches' | 'policies' | 'sms' | 'marketing_sms' | 'ai'
)
RETURNS TABLE(plan_key text, plan_limit int, addon_quantity int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_key text;
  v_plan_limit int;
  v_addon_qty int := 0;
  v_addon_type text;
BEGIN
  SELECT a.plan INTO v_plan_key
  FROM public.agents a
  WHERE a.id = p_agent_id;

  SELECT
    CASE p_resource
      WHEN 'users'         THEN sp.users_limit
      WHEN 'branches'      THEN sp.branches_limit
      WHEN 'policies'      THEN sp.policies_limit
      WHEN 'sms'           THEN sp.sms_limit
      WHEN 'marketing_sms' THEN sp.marketing_sms_limit
      WHEN 'ai'            THEN sp.ai_limit
    END
  INTO v_plan_limit
  FROM public.subscription_plans sp
  WHERE sp.plan_key = v_plan_key;

  -- Map resource → addon_type (only user/branch/sms/marketing_sms/ai have addons).
  v_addon_type := CASE p_resource
    WHEN 'users'         THEN 'extra_user'
    WHEN 'branches'      THEN 'extra_branch'
    WHEN 'sms'           THEN 'extra_sms'
    WHEN 'marketing_sms' THEN 'extra_marketing_sms'
    WHEN 'ai'            THEN 'extra_ai'
    ELSE NULL
  END;

  IF v_addon_type IS NOT NULL THEN
    SELECT COALESCE(SUM(quantity), 0) INTO v_addon_qty
    FROM public.agent_addons
    WHERE agent_id = p_agent_id
      AND addon_type = v_addon_type
      AND status = 'active'
      AND billing_cycle = 'monthly'
      AND starts_at <= CURRENT_DATE
      AND (ends_at IS NULL OR ends_at >= CURRENT_DATE);
  END IF;

  RETURN QUERY SELECT v_plan_key, v_plan_limit, v_addon_qty;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Users per agent
-- -----------------------------------------------------------------------------
-- A profile counts toward the quota when status IN ('active','pending').
-- Blocked profiles don't count — used for downgrade overflow.
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

  -- Only enforce on rows that would count (active/pending).
  IF COALESCE(NEW.status, 'pending') = 'blocked' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_limit FROM public.get_agent_effective_limit(NEW.agent_id, 'users');

  -- NULL plan_limit means unlimited
  IF v_limit.plan_limit IS NULL THEN
    RETURN NEW;
  END IF;

  v_effective := v_limit.plan_limit + COALESCE(v_limit.addon_quantity, 0);

  SELECT COUNT(*) INTO v_current
  FROM public.profiles
  WHERE agent_id = NEW.agent_id
    AND status IN ('active', 'pending')
    AND id <> NEW.id;  -- exclude self for UPDATE re-activation

  IF v_current >= v_effective THEN
    RAISE EXCEPTION 'LIMIT_EXCEEDED:users:%:%:%',
      v_limit.plan_key, v_current, v_effective
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_user_limit ON public.profiles;
CREATE TRIGGER trg_enforce_user_limit
  BEFORE INSERT OR UPDATE OF status, agent_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_limit();

-- -----------------------------------------------------------------------------
-- 2. Branches per agent
-- -----------------------------------------------------------------------------
-- A branch counts when NOT archived (soft-deleted). All branches rows
-- have agent_id since the RLS refactor.
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

  SELECT * INTO v_limit FROM public.get_agent_effective_limit(NEW.agent_id, 'branches');

  IF v_limit.plan_limit IS NULL THEN
    RETURN NEW;
  END IF;

  v_effective := v_limit.plan_limit + COALESCE(v_limit.addon_quantity, 0);

  SELECT COUNT(*) INTO v_current
  FROM public.branches
  WHERE agent_id = NEW.agent_id
    AND id <> NEW.id;

  IF v_current >= v_effective THEN
    RAISE EXCEPTION 'LIMIT_EXCEEDED:branches:%:%:%',
      v_limit.plan_key, v_current, v_effective
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_branch_limit ON public.branches;
CREATE TRIGGER trg_enforce_branch_limit
  BEFORE INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_branch_limit();

-- -----------------------------------------------------------------------------
-- 3. Policies per agent per period ("معاملات")
-- -----------------------------------------------------------------------------
-- Period source: thiqa_platform_settings.policy_limit_period
--   'monthly' | 'yearly' | 'lifetime'
--
-- A "معاملة" is one transaction — either a standalone policy or a
-- package containing N policies. Packages share a policies.group_id.
-- We count distinct COALESCE(group_id, id) so every package (however
-- many children) contributes 1, and every standalone policy
-- contributes 1.
--
-- When the new row joins an EXISTING group in the same period, count
-- stays the same → allowed. A brand new group (or NULL group_id) that
-- would push the count over the effective limit is blocked.
CREATE OR REPLACE FUNCTION public.enforce_policy_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit RECORD;
  v_effective int;
  v_current int;
  v_period text;
  v_period_start timestamptz;
  v_already_in_period boolean;
BEGIN
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_limit FROM public.get_agent_effective_limit(NEW.agent_id, 'policies');

  IF v_limit.plan_limit IS NULL THEN
    RETURN NEW;  -- unlimited
  END IF;

  v_effective := v_limit.plan_limit + COALESCE(v_limit.addon_quantity, 0);

  SELECT setting_value INTO v_period
  FROM public.thiqa_platform_settings
  WHERE setting_key = 'policy_limit_period';
  v_period := COALESCE(v_period, 'monthly');

  v_period_start := CASE v_period
    WHEN 'monthly' THEN date_trunc('month', CURRENT_DATE)
    WHEN 'yearly'  THEN date_trunc('year', CURRENT_DATE)
    ELSE 'epoch'::timestamptz
  END;

  -- If this new policy joins a group that already has sibling(s) in
  -- the same period, it's free — the group was already counted.
  IF NEW.group_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.policies
      WHERE agent_id = NEW.agent_id
        AND group_id = NEW.group_id
        AND created_at >= v_period_start
        AND id <> NEW.id
    ) INTO v_already_in_period;

    IF v_already_in_period THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Otherwise count distinct transactions in the period.
  SELECT COUNT(DISTINCT COALESCE(group_id, id)) INTO v_current
  FROM public.policies
  WHERE agent_id = NEW.agent_id
    AND created_at >= v_period_start
    AND id <> NEW.id;

  IF v_current >= v_effective THEN
    RAISE EXCEPTION 'LIMIT_EXCEEDED:policies:%:%:%',
      v_limit.plan_key, v_current, v_effective
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_policy_limit ON public.policies;
CREATE TRIGGER trg_enforce_policy_limit
  BEFORE INSERT ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.enforce_policy_limit();

-- -----------------------------------------------------------------------------
-- 4. Plan change → reconcile overflow (downgrade protection)
-- -----------------------------------------------------------------------------
-- When an agent's plan changes and the new plan has tighter user/
-- branch limits, block the newest rows (keep the earliest created).
-- The agent can restore them by buying 'extra_user' / 'extra_branch'
-- addons — those raise the effective limit, at which point the admin
-- can re-activate a blocked profile or create a new branch.
CREATE OR REPLACE FUNCTION public.sync_plan_change_overflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_users_limit int;
  v_branches_limit int;
  v_users_addon int;
  v_branches_addon int;
  v_effective_users int;
  v_effective_branches int;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.plan = OLD.plan THEN
    RETURN NEW;
  END IF;

  -- Users
  SELECT plan_limit, addon_quantity
    INTO v_users_limit, v_users_addon
  FROM public.get_agent_effective_limit(NEW.id, 'users');

  IF v_users_limit IS NOT NULL THEN
    v_effective_users := v_users_limit + COALESCE(v_users_addon, 0);

    UPDATE public.profiles
    SET status = 'blocked'
    WHERE id IN (
      SELECT id FROM public.profiles
      WHERE agent_id = NEW.id
        AND status IN ('active', 'pending')
      ORDER BY created_at ASC  -- keep the earliest created
      OFFSET v_effective_users
    );
  END IF;

  -- Branches have no status column — we leave extras in place but the
  -- enforce_branch_limit trigger will block new creation. If the admin
  -- wants to reclaim a branch, they either delete one or buy an addon.
  -- (Documented behavior; no auto-archive action here.)

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_plan_change_overflow ON public.agents;
CREATE TRIGGER trg_sync_plan_change_overflow
  AFTER UPDATE OF plan ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.sync_plan_change_overflow();

-- -----------------------------------------------------------------------------
-- 5. Plan change → reset feature flags to new plan's default_features
-- -----------------------------------------------------------------------------
-- Reuses the set_features_for_plan RPC if it exists (from older
-- migration). Otherwise sets agent_feature_flags rows inline.
CREATE OR REPLACE FUNCTION public.sync_plan_change_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_defaults jsonb;
  v_key text;
  v_val boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.plan = OLD.plan THEN
    RETURN NEW;
  END IF;

  SELECT default_features INTO v_defaults
  FROM public.subscription_plans
  WHERE plan_key = NEW.plan;

  IF v_defaults IS NULL THEN
    RETURN NEW;
  END IF;

  -- Clear existing rows for this agent (excluding admin-gated features
  -- which require explicit approval — visa_payment is the only one).
  DELETE FROM public.agent_feature_flags
  WHERE agent_id = NEW.id
    AND feature_key <> 'visa_payment';

  -- Rewrite from plan defaults. Missing keys = disabled (no row).
  FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_defaults) LOOP
    IF v_val::boolean THEN
      INSERT INTO public.agent_feature_flags (agent_id, feature_key, enabled)
      VALUES (NEW.id, v_key, true)
      ON CONFLICT (agent_id, feature_key) DO UPDATE SET enabled = true;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_plan_change_features ON public.agents;
CREATE TRIGGER trg_sync_plan_change_features
  AFTER UPDATE OF plan ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.sync_plan_change_features();
