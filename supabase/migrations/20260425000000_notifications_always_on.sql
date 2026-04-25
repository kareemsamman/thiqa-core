-- =============================================================================
-- Notifications is a baseline feature for every plan
-- =============================================================================
-- The pricing-foundation seed (20260422000000) never added a
-- "notifications" key to any plan's default_features, even though the
-- key is in PLAN_FEATURE_CATALOG / ThiqaSettings.SYSTEM_FEATURES and
-- both NotificationsDropdown + NotificationsMiniCard gate on
-- hasFeature('notifications'). Result: notifications shows as locked
-- on every plan including Ultimate (الشامل).
--
-- Same shape as 20260424000100 (road_services + accident_fees). Flip
-- it on for every plan. The trg_sync_agents_on_plan_default_features_change
-- trigger picks up the default_features change and re-seeds
-- agent_feature_flags for every agent on each plan, so no separate
-- agent-flag backfill is needed.
-- =============================================================================

UPDATE public.subscription_plans
   SET default_features = default_features
                        || '{"notifications": true}'::jsonb
 WHERE default_features -> 'notifications' IS DISTINCT FROM to_jsonb(true);
