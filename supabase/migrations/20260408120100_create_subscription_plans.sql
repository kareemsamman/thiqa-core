-- ============================================================
-- Subscription Plans table
-- Stores configurable plan definitions (prices, features)
-- Used by: /pricing page, ThiqaAgentDetail plan selector
-- ============================================================

CREATE TABLE public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text NOT NULL UNIQUE,          -- 'starter', 'basic', 'pro'
  name text NOT NULL,                      -- 'Starter', 'Basic', 'Pro'
  name_ar text,                            -- Arabic name (optional)
  description text,                        -- Arabic description
  monthly_price numeric NOT NULL DEFAULT 0,
  yearly_price numeric NOT NULL DEFAULT 0,
  badge text,                              -- e.g. 'الأكثر شعبية'
  features jsonb NOT NULL DEFAULT '[]',    -- [{text: "...", info: true/false}]
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Everyone can read active plans (public pricing page)
CREATE POLICY "Anyone can read active plans"
  ON public.subscription_plans FOR SELECT
  USING (true);

-- Only super admin can manage plans
CREATE POLICY "Super admin can manage plans"
  ON public.subscription_plans FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Seed default plans matching current hardcoded values
INSERT INTO public.subscription_plans (plan_key, name, name_ar, description, monthly_price, yearly_price, badge, features, sort_order) VALUES
(
  'starter',
  'Starter',
  'المبتدئ',
  'مناسب للوكلاء المستقلين في بداية الطريق',
  240, 200, NULL,
  '[{"text": "إدارة حتى 200 عميل", "info": true}, {"text": "إصدار وثائق أساسي", "info": true}, {"text": "تقارير مالية شهرية", "info": false}, {"text": "دعم عبر البريد الإلكتروني", "info": false}, {"text": "استيراد بيانات أساسي", "info": true}, {"text": "نسخ احتياطي يومي تلقائي", "info": true}]',
  1
),
(
  'basic',
  'Basic',
  'الأساسي',
  'مناسب لوكالات التأمين الصغيرة والمتوسطة',
  300, 250, 'الأكثر شعبية',
  '[{"text": "إدارة عملاء بلا حدود", "info": true}, {"text": "إصدار وثائق متقدم", "info": true}, {"text": "إدارة مطالبات كاملة", "info": false}, {"text": "SMS وتذكيرات تلقائية", "info": true}, {"text": "تقارير مالية كاملة", "info": true}, {"text": "توقيع رقمي", "info": true}]',
  2
),
(
  'pro',
  'Pro',
  'الاحترافي',
  'مناسب للوكالات الكبيرة مع فريق عمل',
  500, 420, NULL,
  '[{"text": "كل ما في Basic", "info": false}, {"text": "إدارة فروع وصلاحيات", "info": true}, {"text": "API وتكاملات متقدمة", "info": true}, {"text": "تقارير مخصصة", "info": false}, {"text": "دعم VIP ومدير حساب", "info": true}, {"text": "مزامنة شركات التأمين", "info": true}]',
  3
);

-- Update trigger
CREATE TRIGGER update_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
