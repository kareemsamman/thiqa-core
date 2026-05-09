-- =============================================================================
-- Backfill agent_feature_flags for free_trial agents whose flags were
-- never seeded due to a register-agent regression.
-- =============================================================================
-- register-agent/index.ts called set_features_for_plan(agent_id, "trial")
-- after inserting the agent with plan = 'free_trial'. The RPC was
-- rewritten in 20260503120000 to look up subscription_plans by plan_key,
-- so the mismatched key returned NULL and the function exited early
-- without seeding any rows. Every signup between 2026-05-03 and now
-- ended up with zero rows in agent_feature_flags, which made the AI
-- assistant edge function (and every other feature gate) refuse them
-- with "ميزة المساعد الذكي غير مفعّلة لهذا الحساب".
--
-- The TS fix changes the call to use "free_trial". This migration
-- patches the existing affected accounts. We target only agents with
-- plan = 'free_trial' AND zero non-visa_payment flags — the
-- unambiguous fingerprint of the regression. Agents who have any
-- non-visa_payment flags are left alone, so manual customisations done
-- via /thiqa/settings stay intact.
-- =============================================================================

DO $$
DECLARE
  v_defaults jsonb;
  v_agent_id uuid;
  v_key text;
  v_val boolean;
BEGIN
  SELECT default_features INTO v_defaults
  FROM public.subscription_plans
  WHERE plan_key = 'free_trial';

  IF v_defaults IS NULL THEN
    RAISE NOTICE 'free_trial plan not found, skipping backfill';
    RETURN;
  END IF;

  FOR v_agent_id IN
    SELECT a.id
    FROM public.agents a
    WHERE a.plan = 'free_trial'
      AND NOT EXISTS (
        SELECT 1
        FROM public.agent_feature_flags f
        WHERE f.agent_id = a.id
          AND f.feature_key <> 'visa_payment'
      )
  LOOP
    FOR v_key, v_val IN SELECT * FROM jsonb_each_text(v_defaults) LOOP
      IF v_val::boolean THEN
        INSERT INTO public.agent_feature_flags (agent_id, feature_key, enabled)
        VALUES (v_agent_id, v_key, true)
        ON CONFLICT (agent_id, feature_key) DO UPDATE SET enabled = true;
      END IF;
    END LOOP;
  END LOOP;
END $$;
