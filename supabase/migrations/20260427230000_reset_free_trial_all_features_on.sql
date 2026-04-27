-- =============================================================================
-- Reset free_trial plan: turn every feature ON in default_features
-- =============================================================================
-- The original 20260422070000 migration seeded free_trial with every
-- feature enabled, but Thiqa admin (or someone using /thiqa/settings)
-- toggled them off afterward and saved — leaving every agent on the
-- free_trial plan with locked items in the sidebar (broker_wallet,
-- accident_reports, etc).
--
-- Free trial is meant to be a "try every feature" experience: the
-- limits live in the quotas (1 user, 1 branch, 100 SMS / month) not
-- in feature gating. Force the plan back to "everything on" so the
-- pre-purchase UX matches what the product description promises.
--
-- Updating subscription_plans.default_features fires the existing
-- trg_sync_agents_on_plan_default_features_change trigger
-- (see 20260422090000), which wipes and re-seeds agent_feature_flags
-- for every agent currently on free_trial — so the change propagates
-- to live customers immediately, no per-agent reset needed.
-- =============================================================================

UPDATE public.subscription_plans
SET default_features = '{
  "dashboard": true,
  "tasks": true,
  "contacts": true,
  "accident_reports": true,
  "correspondence": true,
  "renewals": true,
  "notifications": true,
  "files_upload": true,
  "files_explorer": true,
  "digital_signatures": true,
  "sms": true,
  "marketing_sms": true,
  "ai_assistant": true,
  "financial_reports": true,
  "broker_wallet": true,
  "company_settlement": true,
  "cheques": true,
  "debt_tracking": true,
  "repair_claims": true,
  "accounting": true,
  "receipts": true,
  "road_services": true,
  "accident_fees": true
}'::jsonb
WHERE plan_key = 'free_trial';
