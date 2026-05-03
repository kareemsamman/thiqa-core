-- =============================================================================
-- Rewrite set_features_for_plan to source the feature set from
-- subscription_plans.default_features instead of a hardcoded plan-key
-- switch.
-- =============================================================================
-- The previous version (last touched in 20260430120000) only knew
-- about plan_key in ('pro','trial','basic'). Every other plan_key —
-- including the actually-seeded entry/professional/ultimate/free_trial
-- and any custom plan a Thiqa admin adds via /thiqa/settings → الخطط
-- (e.g. 'business') — fell through to the ELSE branch and was given
-- only `financial_reports` and `receipts`.
--
-- Symptom: Thiqa admin sets an agent's plan to "Business" (a custom
-- plan with default_features = "everything on"), the agents.plan
-- UPDATE trigger sync_plan_change_features correctly seeds
-- agent_feature_flags from default_features, then the saveAgent
-- handler in ThiqaAgentDetail calls set_features_for_plan(agent_id,
-- 'business') which clobbers those flags with the ELSE-branch defaults
-- — so the agent ends up with almost nothing enabled despite paying
-- for a full-feature plan.
--
-- Fix: align the RPC with sync_plan_change_features. Both now read
-- the same source of truth (subscription_plans.default_features), so
-- the manual "إعادة ضبط الميزات على الباقة" button and the auto-sync
-- on plan change behave identically and work for any plan_key — built-
-- in or custom. visa_payment stays admin-gated.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_features_for_plan(p_agent_id uuid, p_plan text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_defaults jsonb;
  v_key text;
  v_val boolean;
BEGIN
  SELECT default_features INTO v_defaults
  FROM public.subscription_plans
  WHERE plan_key = p_plan;

  -- Unknown plan: leave flags alone rather than wiping them. This
  -- matches sync_plan_change_features' behavior on the same condition.
  IF v_defaults IS NULL THEN
    RETURN;
  END IF;

  -- Wipe the agent's current flags (except admin-gated visa_payment)
  -- and re-seed from the plan's default_features. Mirrors the trigger
  -- in 20260422000100 / 20260422090000.
  DELETE FROM public.agent_feature_flags
  WHERE agent_id = p_agent_id
    AND feature_key <> 'visa_payment';

  FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_defaults) LOOP
    IF v_val::boolean THEN
      INSERT INTO public.agent_feature_flags (agent_id, feature_key, enabled)
      VALUES (p_agent_id, v_key, true)
      ON CONFLICT (agent_id, feature_key)
      DO UPDATE SET enabled = true;
    END IF;
  END LOOP;
END;
$$;

-- One-time backfill: every agent whose flags were last touched by the
-- buggy hardcoded RPC needs to be reconciled now. Re-running the fixed
-- RPC for every active agent re-seeds them from the correct
-- default_features. Skipped agents with no plan_key match in
-- subscription_plans (RPC short-circuits).
DO $$
DECLARE
  v_agent RECORD;
BEGIN
  FOR v_agent IN
    SELECT id, plan FROM public.agents WHERE plan IS NOT NULL
  LOOP
    PERFORM public.set_features_for_plan(v_agent.id, v_agent.plan);
  END LOOP;
END $$;
