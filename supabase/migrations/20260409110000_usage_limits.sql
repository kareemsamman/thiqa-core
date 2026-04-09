-- ============================================================
-- Usage limits for SMS and AI Chatbot per agent
-- ============================================================

-- Usage limits configuration per agent
CREATE TABLE IF NOT EXISTS public.agent_usage_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  -- SMS limits
  sms_limit_type text NOT NULL DEFAULT 'monthly' CHECK (sms_limit_type IN ('monthly', 'yearly', 'unlimited')),
  sms_limit_count int NOT NULL DEFAULT 100,
  -- AI chatbot limits
  ai_limit_type text NOT NULL DEFAULT 'monthly' CHECK (ai_limit_type IN ('monthly', 'yearly', 'unlimited')),
  ai_limit_count int NOT NULL DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(agent_id)
);

ALTER TABLE public.agent_usage_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_data_select" ON public.agent_usage_limits FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()));
CREATE POLICY "agent_data_insert" ON public.agent_usage_limits FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "agent_data_update" ON public.agent_usage_limits FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Usage tracking (actual usage counts)
CREATE TABLE IF NOT EXISTS public.agent_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  usage_type text NOT NULL CHECK (usage_type IN ('sms', 'ai_chat')),
  period text NOT NULL, -- 'YYYY-MM' for monthly, 'YYYY' for yearly
  count int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(agent_id, usage_type, period)
);

ALTER TABLE public.agent_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_data_select" ON public.agent_usage_log FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()));
CREATE POLICY "service_insert" ON public.agent_usage_log FOR ALL TO service_role
  WITH CHECK (true);

-- Platform default limits (in thiqa_platform_settings)
INSERT INTO public.thiqa_platform_settings (setting_key, setting_value) VALUES
  ('default_sms_limit_type', 'monthly'),
  ('default_sms_limit_count', '100'),
  ('default_ai_limit_type', 'monthly'),
  ('default_ai_limit_count', '100')
ON CONFLICT (setting_key) DO NOTHING;
