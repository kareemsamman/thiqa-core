-- Add default_features to subscription_plans
-- Maps feature keys to enabled/disabled defaults for agents on this plan
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS default_features jsonb NOT NULL DEFAULT '{}';

-- Seed Pro plan with all features enabled
UPDATE public.subscription_plans SET default_features = '{
  "sms": true,
  "financial_reports": true,
  "broker_wallet": true,
  "company_settlement": true,
  "expenses": true,
  "cheques": true,
  "leads": true,
  "accident_reports": true,
  "repair_claims": true,
  "marketing_sms": true,
  "road_services": true,
  "accident_fees": true,
  "correspondence": true,
  "ippbx": true
}'::jsonb WHERE plan_key = 'pro';

-- Basic plan with limited features
UPDATE public.subscription_plans SET default_features = '{
  "sms": false,
  "financial_reports": false,
  "broker_wallet": false,
  "company_settlement": false,
  "expenses": false,
  "cheques": false,
  "leads": true,
  "accident_reports": true,
  "repair_claims": true,
  "marketing_sms": false,
  "road_services": true,
  "accident_fees": true,
  "correspondence": true,
  "ippbx": false
}'::jsonb WHERE plan_key = 'basic';
