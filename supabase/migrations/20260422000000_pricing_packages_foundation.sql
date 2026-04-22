-- =============================================================================
-- PRICING & PACKAGES — foundation migration
-- =============================================================================
-- Introduces the four-tier plan model (Entry / Basic / Professional /
-- Ultimate) with per-plan quotas (users, branches, policies, SMS,
-- marketing SMS, AI), discount tracking, add-ons (extra user/branch/
-- SMS/onboarding/migration), per-user permissions matrix, and
-- per-agent defaults for new employee permissions.
--
-- Thiqa is pre-launch: every existing agent is a test account, so we
-- rebuild subscription_plans from scratch. Agent rows are preserved
-- but reassigned to 'ultimate' on trial in a sibling migration.
--
-- Design:
-- - Plan limits live on subscription_plans. Per-agent overrides go
--   through agent_addons (recurring billable extras) and
--   agent_discounts (temporary price overrides).
-- - Permissions are a single JSONB map on profiles with boolean
--   per-page keys. `view_financial` is one global key that controls
--   every financial number (profit, commission, debt) across the app.
-- - marketing_sms becomes its own usage_type alongside sms + ai_chat.
--   Separate per-plan limit, separate wallet balance, separate
--   overage pricing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. subscription_plans — add limit + SLA columns, reseed with 4 tiers
-- -----------------------------------------------------------------------------
ALTER TABLE public.subscription_plans
  -- default_features may already exist from an earlier migration, but
  -- the remote DB this is running against is partially seeded — add
  -- it defensively so the INSERT below doesn't miss the column.
  ADD COLUMN IF NOT EXISTS default_features jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS users_limit int,
  ADD COLUMN IF NOT EXISTS branches_limit int,
  ADD COLUMN IF NOT EXISTS policies_limit int,  -- NULL = unlimited
  ADD COLUMN IF NOT EXISTS sms_limit int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS marketing_sms_limit int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_limit int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS support_sla_hours int NOT NULL DEFAULT 96;

-- Entry has no yearly option — make yearly_price nullable so NULL
-- means "yearly plan not offered" (vs 0 which would mean "free for a
-- year").
ALTER TABLE public.subscription_plans ALTER COLUMN yearly_price DROP NOT NULL;
ALTER TABLE public.subscription_plans ALTER COLUMN yearly_price DROP DEFAULT;

DELETE FROM public.subscription_plans;

INSERT INTO public.subscription_plans (
  plan_key, name, name_ar, description,
  monthly_price, yearly_price, badge,
  users_limit, branches_limit, policies_limit,
  sms_limit, marketing_sms_limit, ai_limit,
  support_sla_hours, sort_order, is_active,
  features, default_features
) VALUES
  ('entry', 'Entry', 'الأساس',
   'الحزمة الأساسية لبدء العمل',
   75, NULL, NULL,
   1, 1, 10,
   0, 0, 0,
   96, 1, true,
   '[]'::jsonb, '{}'::jsonb),

  ('basic', 'Basic', 'البيسك',
   'الحزمة الأساسية مع الرسائل ورفع الملفات',
   170, 1870, NULL,
   1, 1, 30,
   50, 0, 0,
   96, 2, true,
   '[]'::jsonb,
   '{"files_upload":true,"sms":true}'::jsonb),

  ('professional', 'Professional', 'المحترف',
   'الحزمة الأكثر شعبية للوكلاء المحترفين',
   300, 3300, 'الأكثر شعبية',
   3, 1, 70,
   100, 200, 0,
   96, 3, true,
   '[]'::jsonb,
   '{"files_upload":true,"files_explorer":true,"sms":true,"marketing_sms":true,"accident_reports":true,"correspondence":true,"contacts":true,"digital_signatures":true,"tasks":true}'::jsonb),

  ('ultimate', 'Ultimate', 'الشامل',
   'كل الميزات بدون حدود',
   500, 5000, NULL,
   5, 3, NULL,
   200, 300, 250,
   48, 4, true,
   '[]'::jsonb,
   '{"files_upload":true,"files_explorer":true,"sms":true,"marketing_sms":true,"accident_reports":true,"correspondence":true,"contacts":true,"digital_signatures":true,"tasks":true,"renewals":true,"dashboard":true,"financial_management":true,"cheques":true,"debt_tracking":true,"repair_claims":true,"broker_wallet":true,"company_settlement":true,"accounting":true,"financial_reports":true,"receipts":true,"ai_assistant":true,"ippbx":true}'::jsonb);

-- -----------------------------------------------------------------------------
-- 2. agent_addons — per-agent cart (extra user/branch/SMS/onboarding/migration)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  addon_type text NOT NULL CHECK (addon_type IN (
    'extra_user',
    'extra_branch',
    'extra_sms',
    'extra_marketing_sms',
    'extra_ai',
    'onboarding',
    'data_migration'
  )),
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'one_time')),
  starts_at date NOT NULL DEFAULT CURRENT_DATE,
  ends_at date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_addons_agent_status
  ON public.agent_addons(agent_id, status);

ALTER TABLE public.agent_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_addons_select ON public.agent_addons
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR agent_id = public.get_my_agent_id()
  );

CREATE POLICY agent_addons_super_manage ON public.agent_addons
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY agent_addons_service_role ON public.agent_addons
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 3. agent_discounts — temporary price override by Thiqa admin
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  discounted_price numeric NOT NULL CHECK (discounted_price >= 0),
  starts_at date NOT NULL DEFAULT CURRENT_DATE,
  ends_at date NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_discounts_window
  ON public.agent_discounts(agent_id, starts_at, ends_at);

ALTER TABLE public.agent_discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_discounts_select ON public.agent_discounts
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR agent_id = public.get_my_agent_id()
  );

CREATE POLICY agent_discounts_super_manage ON public.agent_discounts
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY agent_discounts_service_role ON public.agent_discounts
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 4. thiqa_platform_settings — addon pricing + marketing copy + policy period
-- -----------------------------------------------------------------------------
-- All prices are editable by Thiqa admin. Quantities are how many units
-- the agent gets per purchase (e.g. 50 SMS for 50₪).
INSERT INTO public.thiqa_platform_settings (setting_key, setting_value) VALUES
  ('addon_extra_user_price', '30'),
  ('addon_extra_branch_price', '120'),

  ('addon_extra_sms_price', '50'),
  ('addon_extra_sms_quantity', '50'),
  ('addon_extra_marketing_sms_price', '50'),
  ('addon_extra_marketing_sms_quantity', '50'),
  ('addon_extra_ai_price', '50'),
  ('addon_extra_ai_quantity', '50'),

  ('addon_onboarding_price', '200'),
  ('addon_data_migration_price', '450'),

  -- Policy limit period: 'monthly' | 'yearly' | 'lifetime'
  ('policy_limit_period', 'monthly'),

  -- Upgrade popup copy (Arabic, editable)
  ('upgrade_popup_title', 'لقد وصلت إلى حد حزمتك'),
  ('upgrade_popup_subtitle', 'طوّر حزمتك للحصول على المزيد من المعاملات والميزات'),
  ('upgrade_popup_cta_label', 'عرض الحزم'),

  -- Marketing SMS quota defaults (mirrors sms + ai_chat pattern)
  ('default_marketing_sms_limit_type', 'monthly'),
  ('default_marketing_sms_limit_count', '0'),
  ('marketing_sms_overage_unit_price', '1')
ON CONFLICT (setting_key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Per-user permissions matrix + per-agent defaults for new employees
-- -----------------------------------------------------------------------------
-- profiles.permissions — individual override per user. Admins (role='admin')
-- bypass these checks entirely; the app enforces that. Missing key falls
-- back to the agent's default_employee_permissions.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- agents.default_employee_permissions — the template an agent admin
-- maintains for new employees they invite.
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS default_employee_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Seed every existing agent with a conservative default: daily-work
-- pages on, management/financial pages off, financial numbers hidden.
-- Agent admins edit this from /admin/users → settings later.
UPDATE public.agents
SET default_employee_permissions = '{
  "page.dashboard": true,
  "page.tasks": true,
  "page.activity": true,
  "page.notifications": true,
  "page.policy_reports": true,
  "page.clients": true,
  "page.cars": true,
  "page.policies": true,
  "page.accidents": true,
  "page.contacts": true,
  "page.leads": true,
  "page.media": true,
  "page.form_templates": true,
  "view_financial": false
}'::jsonb
WHERE default_employee_permissions = '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- 6. marketing_sms as a first-class usage_type
-- -----------------------------------------------------------------------------
-- Relax the CHECK on usage log + overages so 'marketing_sms' is legal
-- alongside 'sms' and 'ai_chat'.
ALTER TABLE public.agent_usage_log
  DROP CONSTRAINT IF EXISTS agent_usage_log_usage_type_check;
ALTER TABLE public.agent_usage_log
  ADD CONSTRAINT agent_usage_log_usage_type_check
  CHECK (usage_type IN ('sms', 'ai_chat', 'marketing_sms'));

ALTER TABLE public.agent_usage_overages
  DROP CONSTRAINT IF EXISTS agent_usage_overages_usage_type_check;
ALTER TABLE public.agent_usage_overages
  ADD CONSTRAINT agent_usage_overages_usage_type_check
  CHECK (usage_type IN ('sms', 'ai_chat', 'marketing_sms'));

-- Dedicated wallet balance so marketing SMS credits don't pool with
-- transactional SMS credits.
ALTER TABLE public.agent_credit_wallet
  ADD COLUMN IF NOT EXISTS marketing_sms_credit_balance int NOT NULL DEFAULT 0
  CHECK (marketing_sms_credit_balance >= 0);

-- Extend agent_usage_limits with marketing_sms columns.
ALTER TABLE public.agent_usage_limits
  ADD COLUMN IF NOT EXISTS marketing_sms_limit_type text NOT NULL DEFAULT 'monthly'
    CHECK (marketing_sms_limit_type IN ('monthly', 'yearly', 'unlimited')),
  ADD COLUMN IF NOT EXISTS marketing_sms_limit_count int NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 7. updated_at triggers (reuse existing helper if available)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_addons_updated_at ON public.agent_addons;
CREATE TRIGGER trg_agent_addons_updated_at
  BEFORE UPDATE ON public.agent_addons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
