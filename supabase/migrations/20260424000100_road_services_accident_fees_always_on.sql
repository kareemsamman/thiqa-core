-- =============================================================================
-- Road services + accident-fee exemption are baseline features for every plan
-- =============================================================================
-- The pricing-foundation seed (20260422000000) only set road_services /
-- accident_fees to true for the legacy 'pro' and 'basic' plans via an old
-- migration (20260408170000). The new plans — entry / basic / professional
-- / ultimate — never got them in their default_features jsonb, so agents
-- on any current plan saw both sidebar items locked.
--
-- User feedback: these are baseline capabilities every agent needs. Flip
-- them on for every plan. The existing
-- trg_sync_agents_on_plan_default_features_change trigger picks up the
-- default_features change and re-seeds agent_feature_flags for every
-- agent on each plan, so no separate agent-flag backfill is needed.
-- =============================================================================

UPDATE public.subscription_plans
   SET default_features = default_features
                        || '{"road_services": true, "accident_fees": true}'::jsonb
 WHERE default_features -> 'road_services' IS DISTINCT FROM to_jsonb(true)
    OR default_features -> 'accident_fees' IS DISTINCT FROM to_jsonb(true);
