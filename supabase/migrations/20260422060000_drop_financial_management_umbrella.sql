-- Drop the `financial_management` umbrella feature key from every
-- plan's default_features map. The actual financial pages are each
-- gated by their own feature (cheques, debt_tracking, accounting,
-- repair_claims, broker_wallet, company_settlement, financial_reports,
-- receipts), so the umbrella was redundant and only existed in the
-- seed data.

UPDATE public.subscription_plans
SET default_features = default_features - 'financial_management'
WHERE default_features ? 'financial_management';

DELETE FROM public.agent_feature_flags
WHERE feature_key = 'financial_management';
