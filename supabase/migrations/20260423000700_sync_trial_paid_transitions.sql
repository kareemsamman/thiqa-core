-- =============================================================================
-- Sync subscription state when an agent's plan transitions in or out of trial
-- =============================================================================
-- Before this, the Thiqa admin "Save" button on the agent detail page
-- only wrote agents.plan. Moving an agent from free_trial → basic
-- therefore left subscription_status = 'trial', monthly_price = 0, and
-- trial_ends_at in the future — so the agent's /subscription page still
-- showed "فترة تجريبية" even after the Thiqa admin thought they'd
-- upgraded them.
--
-- This trigger watches plan changes and reconciles the related fields:
--   * free_trial → any paid plan
--       - subscription_status = 'active'
--       - monthly_price       = target plan's monthly_price
--       - trial_ends_at       = NULL
--       - subscription_started_at = COALESCE(existing, now())
--       - subscription_expires_at = if NULL or past, now() + 1 month
--       - pending_plan = NULL
--
--   * any paid plan → free_trial
--       - subscription_status = 'trial'
--       - monthly_price       = 0
--       - trial_ends_at       = now() + 35 days (only if not already set)
--       - subscription_expires_at = NULL
--       - pending_plan = NULL
--
--   * paid → paid
--       - monthly_price = target plan's monthly_price (keep dates intact)
--
-- The trigger runs BEFORE UPDATE so callers don't need to re-read the row.
-- Existing callers that already set these fields in the same UPDATE win —
-- we only touch fields that would otherwise stay stale.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_agent_plan_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_price numeric;
BEGIN
  -- Only react when the plan actually changed.
  IF NEW.plan IS NOT DISTINCT FROM OLD.plan THEN
    RETURN NEW;
  END IF;

  -- Look up the target plan's monthly price. Free_trial resolves to 0.
  SELECT monthly_price INTO v_target_price
  FROM public.subscription_plans
  WHERE plan_key = NEW.plan;
  v_target_price := COALESCE(v_target_price, 0);

  IF NEW.plan = 'free_trial' THEN
    -- paid → free_trial
    NEW.subscription_status := 'trial';
    NEW.monthly_price := 0;
    IF NEW.trial_ends_at IS NULL THEN
      NEW.trial_ends_at := now() + interval '35 days';
    END IF;
    NEW.subscription_expires_at := NULL;
    NEW.pending_plan := NULL;
    NEW.cancelled_at := NULL;
  ELSIF OLD.plan = 'free_trial' OR OLD.subscription_status = 'trial' THEN
    -- free_trial (or trial-status) → paid
    -- Only flip status if the caller didn't already do it in the same update.
    IF NEW.subscription_status = OLD.subscription_status
       AND OLD.subscription_status = 'trial' THEN
      NEW.subscription_status := 'active';
    END IF;
    -- Force a fresh monthly_price from the plan unless the caller set a
    -- non-zero one already (e.g. a custom discounted deal).
    IF COALESCE(NEW.monthly_price, 0) = 0 THEN
      NEW.monthly_price := v_target_price;
    END IF;
    NEW.trial_ends_at := NULL;
    IF NEW.subscription_started_at IS NULL THEN
      NEW.subscription_started_at := now();
    END IF;
    IF NEW.subscription_expires_at IS NULL OR NEW.subscription_expires_at < now() THEN
      NEW.subscription_expires_at := now() + interval '1 month';
    END IF;
    NEW.pending_plan := NULL;
    NEW.cancelled_at := NULL;
  ELSE
    -- paid → paid. Keep timing intact; just refresh the price if the
    -- caller didn't specify one.
    IF NEW.monthly_price IS NULL OR NEW.monthly_price = OLD.monthly_price THEN
      NEW.monthly_price := v_target_price;
    END IF;
    NEW.pending_plan := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_agent_plan_transition ON public.agents;
CREATE TRIGGER trg_sync_agent_plan_transition
  BEFORE UPDATE OF plan ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.sync_agent_plan_transition();

-- -----------------------------------------------------------------------------
-- One-off reconciliation
-- -----------------------------------------------------------------------------
-- Fix agents who were moved off free_trial but whose subscription_status
-- / monthly_price / trial_ends_at never caught up — the exact case the
-- Thiqa admin just flagged. We only touch rows that are clearly
-- inconsistent; real trial accounts on free_trial stay put.
UPDATE public.agents a
SET
  subscription_status     = 'active',
  monthly_price           = COALESCE(sp.monthly_price, 0),
  trial_ends_at           = NULL,
  subscription_started_at = COALESCE(a.subscription_started_at, now()),
  subscription_expires_at = COALESCE(
    CASE
      WHEN a.subscription_expires_at IS NULL OR a.subscription_expires_at < now()
        THEN now() + interval '1 month'
      ELSE a.subscription_expires_at
    END,
    now() + interval '1 month'
  ),
  pending_plan = NULL
FROM public.subscription_plans sp
WHERE sp.plan_key = a.plan
  AND a.plan <> 'free_trial'
  AND (
    a.subscription_status = 'trial'
    OR a.trial_ends_at IS NOT NULL
    OR COALESCE(a.monthly_price, 0) = 0
  );
