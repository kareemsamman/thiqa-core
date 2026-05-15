-- =============================================================================
-- Backfill agent_feature_flags for free_trial agents created via Google OAuth.
-- =============================================================================
-- The earlier 20260509180000 backfill caught register-agent victims. The
-- matching bug lived in setup-oauth-user/index.ts too: it called
-- set_features_for_plan(agent_id, "trial") after inserting the agent
-- with plan = 'free_trial', and the RPC (source-of-truth-driven since
-- 20260503120000) returned silently because plan_key="trial" doesn't
-- exist. Every Google-signup since 2026-05-03 ended up with zero rows
-- in agent_feature_flags and hit "ميزة المساعد الذكي غير مفعّلة لهذا
-- الحساب" the moment they opened ثاقب.
--
-- The TS fix passes "free_trial". This migration patches the existing
-- affected accounts using the same fingerprint as the prior backfill:
-- plan = 'free_trial' AND zero non-visa_payment flags. Agents who
-- already have any non-visa_payment flag are left alone to preserve
-- manual customisations from /thiqa/settings.
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
