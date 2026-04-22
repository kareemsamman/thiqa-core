-- =============================================================================
-- Propagate Thiqa-admin edits to subscription_plans.default_features
-- down to agent_feature_flags for every agent on that plan.
-- =============================================================================
-- Before this, sync_plan_change_features only fired on agents.plan
-- change, so once an agent's flags were seeded they persisted forever.
-- When Thiqa admin toggled a feature off for the free_trial plan, the
-- plan row updated but the cached agent_feature_flags stayed at
-- enabled = true, which won against the plan default in
-- useAgentContext.hasFeature() — so the sidebar never locked and
-- PermissionRoute never redirected.
--
-- Fix: a second trigger on subscription_plans runs the same re-seed
-- (delete all rows, re-insert from default_features) for every agent
-- whose plan matches the edited row, whenever default_features
-- actually changed. Runs per row so the trigger can reuse the exact
-- same logic as sync_plan_change_features().
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_agents_on_plan_default_features_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id uuid;
  v_key text;
  v_val boolean;
BEGIN
  -- Only act when default_features genuinely changed.
  IF NEW.default_features IS NOT DISTINCT FROM OLD.default_features THEN
    RETURN NEW;
  END IF;

  FOR v_agent_id IN
    SELECT id FROM public.agents WHERE plan = NEW.plan_key
  LOOP
    -- Same shape as sync_plan_change_features: wipe then re-seed,
    -- leaving admin-gated features (visa_payment) untouched.
    DELETE FROM public.agent_feature_flags
    WHERE agent_id = v_agent_id
      AND feature_key <> 'visa_payment';

    FOR v_key, v_val IN SELECT * FROM jsonb_each_text(NEW.default_features) LOOP
      IF v_val::boolean THEN
        INSERT INTO public.agent_feature_flags (agent_id, feature_key, enabled)
        VALUES (v_agent_id, v_key, true)
        ON CONFLICT (agent_id, feature_key) DO UPDATE SET enabled = true;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_agents_on_plan_default_features_change
  ON public.subscription_plans;
CREATE TRIGGER trg_sync_agents_on_plan_default_features_change
  AFTER UPDATE OF default_features ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.sync_agents_on_plan_default_features_change();

-- One-time backfill: the stale flags that accumulated before this
-- trigger existed need to be reconciled now. Walk every plan and
-- re-seed every agent on it from the current default_features, so
-- the database catches up with whatever Thiqa admin has already
-- toggled in /thiqa/settings.
DO $$
DECLARE
  r_plan RECORD;
  v_agent_id uuid;
  v_key text;
  v_val boolean;
BEGIN
  FOR r_plan IN
    SELECT plan_key, default_features
    FROM public.subscription_plans
    WHERE default_features IS NOT NULL
  LOOP
    FOR v_agent_id IN
      SELECT id FROM public.agents WHERE plan = r_plan.plan_key
    LOOP
      DELETE FROM public.agent_feature_flags
      WHERE agent_id = v_agent_id
        AND feature_key <> 'visa_payment';

      FOR v_key, v_val IN SELECT * FROM jsonb_each_text(r_plan.default_features) LOOP
        IF v_val::boolean THEN
          INSERT INTO public.agent_feature_flags (agent_id, feature_key, enabled)
          VALUES (v_agent_id, v_key, true)
          ON CONFLICT (agent_id, feature_key) DO UPDATE SET enabled = true;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
