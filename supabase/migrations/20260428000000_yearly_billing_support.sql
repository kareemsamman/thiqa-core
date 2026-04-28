-- =============================================================================
-- Yearly billing: trigger respects billing_cycle, fires on cycle changes too
-- =============================================================================
-- Bug: the previous version of sync_agent_plan_transition() always set
-- subscription_expires_at = now() + 1 month for trial → paid transitions,
-- regardless of billing_cycle. A yearly subscriber ended up with a 1-month
-- renewal date, so the system would attempt to charge them every month
-- instead of once per year.
--
-- It also only fired BEFORE UPDATE OF plan, so switching billing_cycle on
-- the same plan (e.g. Professional/monthly → Professional/yearly) didn't
-- trigger any reconciliation — expires_at, monthly_price, etc. stayed
-- on the stale monthly numbers.
--
-- This migration:
--   1. Picks the renewal interval based on NEW.billing_cycle
--      ('1 year' for yearly, '1 month' otherwise).
--   2. Reacts when billing_cycle changes, not just plan.
--   3. Recomputes expires_at on cycle change (cycle switch implies a fresh
--      billing period was paid for upfront).
--   4. Backfills any existing yearly subscriber whose expires_at sits less
--      than 6 months out — those were set by the broken trigger and need
--      pushing out by 11 months to reach a year from activation.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_agent_plan_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_price numeric;
  v_cycle_interval interval;
  v_cycle_changed boolean;
BEGIN
  v_cycle_changed := NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle;

  -- Only react when plan OR billing_cycle actually changed.
  IF NEW.plan IS NOT DISTINCT FROM OLD.plan AND NOT v_cycle_changed THEN
    RETURN NEW;
  END IF;

  -- Renewal interval keyed on the *new* cycle. NULL defaults to monthly.
  v_cycle_interval := CASE WHEN NEW.billing_cycle = 'yearly'
                           THEN interval '1 year'
                           ELSE interval '1 month'
                      END;

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
    IF NEW.subscription_status = OLD.subscription_status
       AND OLD.subscription_status = 'trial' THEN
      NEW.subscription_status := 'active';
    END IF;
    IF COALESCE(NEW.monthly_price, 0) = 0 THEN
      NEW.monthly_price := v_target_price;
    END IF;
    NEW.trial_ends_at := NULL;
    IF NEW.subscription_started_at IS NULL THEN
      NEW.subscription_started_at := now();
    END IF;
    IF NEW.subscription_expires_at IS NULL OR NEW.subscription_expires_at < now() THEN
      NEW.subscription_expires_at := now() + v_cycle_interval;
    END IF;
    NEW.pending_plan := NULL;
    NEW.cancelled_at := NULL;
  ELSE
    -- paid → paid (plan switch and/or cycle switch on the same plan).
    -- Refresh the price when the plan changed and the caller didn't set
    -- a custom one.
    IF NEW.plan IS DISTINCT FROM OLD.plan AND
       (NEW.monthly_price IS NULL OR NEW.monthly_price = OLD.monthly_price) THEN
      NEW.monthly_price := v_target_price;
    END IF;
    -- Cycle change implies a fresh billing period was just paid for
    -- upfront, so push expires_at out one full new cycle from today.
    -- Same fallback if expires_at is missing or already past.
    IF v_cycle_changed
       OR NEW.subscription_expires_at IS NULL
       OR NEW.subscription_expires_at < now() THEN
      NEW.subscription_expires_at := now() + v_cycle_interval;
    END IF;
    NEW.pending_plan := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_agent_plan_transition ON public.agents;
CREATE TRIGGER trg_sync_agent_plan_transition
  BEFORE UPDATE OF plan, billing_cycle ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.sync_agent_plan_transition();

-- -----------------------------------------------------------------------------
-- Backfill existing yearly subscribers stuck with a 1-month expires_at.
-- The old trigger set expires_at = activation + 1 month for everyone.
-- For yearly subscribers that's ~11 months short — push them out so
-- they reach a year from their actual activation moment.
-- -----------------------------------------------------------------------------
UPDATE public.agents
SET subscription_expires_at = subscription_expires_at + interval '11 months'
WHERE billing_cycle = 'yearly'
  AND subscription_status = 'active'
  AND subscription_expires_at IS NOT NULL
  AND subscription_started_at IS NOT NULL
  AND (subscription_expires_at - subscription_started_at) < interval '6 months';
