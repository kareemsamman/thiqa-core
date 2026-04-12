-- Recreate agent_usage_limits and agent_usage_log.
--
-- The original 20260409110000_usage_limits.sql migration is in the history
-- table but the tables it was supposed to create do not exist on the remote
-- database (verified via REST: both return PGRST205 "table not found").
-- This is why the per-agent quota counters always showed 0 and no SMS/AI
-- limits were actually being enforced.
--
-- This migration is idempotent — it uses IF NOT EXISTS / CREATE OR REPLACE
-- everywhere and safely skips anything that already exists.

-- ---------------------------------------------------------------------------
-- agent_usage_limits — per-agent override of the platform default quotas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_usage_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  sms_limit_type text NOT NULL DEFAULT 'monthly' CHECK (sms_limit_type IN ('monthly', 'yearly', 'unlimited')),
  sms_limit_count int NOT NULL DEFAULT 100,
  ai_limit_type text NOT NULL DEFAULT 'monthly' CHECK (ai_limit_type IN ('monthly', 'yearly', 'unlimited')),
  ai_limit_count int NOT NULL DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(agent_id)
);

ALTER TABLE public.agent_usage_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_data_select" ON public.agent_usage_limits;
CREATE POLICY "agent_data_select" ON public.agent_usage_limits FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()));

DROP POLICY IF EXISTS "agent_data_insert" ON public.agent_usage_limits;
CREATE POLICY "agent_data_insert" ON public.agent_usage_limits FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "agent_data_update" ON public.agent_usage_limits;
CREATE POLICY "agent_data_update" ON public.agent_usage_limits FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Service role needs full access for edge functions that fall back from the
-- SECURITY DEFINER RPC to a direct upsert.
DROP POLICY IF EXISTS "service_role_all" ON public.agent_usage_limits;
CREATE POLICY "service_role_all" ON public.agent_usage_limits FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- agent_usage_log — actual usage counts per (agent, usage_type, period)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  usage_type text NOT NULL CHECK (usage_type IN ('sms', 'ai_chat')),
  period text NOT NULL,
  count int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(agent_id, usage_type, period)
);

ALTER TABLE public.agent_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_data_select" ON public.agent_usage_log;
CREATE POLICY "agent_data_select" ON public.agent_usage_log FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()));

DROP POLICY IF EXISTS "service_insert" ON public.agent_usage_log;
CREATE POLICY "service_insert" ON public.agent_usage_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Platform default limits
-- ---------------------------------------------------------------------------
INSERT INTO public.thiqa_platform_settings (setting_key, setting_value) VALUES
  ('default_sms_limit_type', 'monthly'),
  ('default_sms_limit_count', '100'),
  ('default_ai_limit_type', 'monthly'),
  ('default_ai_limit_count', '100')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Increment RPC — recreate so it's guaranteed correct even if the old one
-- drifted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_usage_log(
  p_agent_id uuid,
  p_usage_type text,
  p_period text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.agent_usage_log (agent_id, usage_type, period, count)
  VALUES (p_agent_id, p_usage_type, p_period, 1)
  ON CONFLICT (agent_id, usage_type, period)
  DO UPDATE SET count = agent_usage_log.count + 1, updated_at = now();
END;
$$;

-- Notify PostgREST to refresh its schema cache so the new tables are exposed
-- via the REST API immediately.
NOTIFY pgrst, 'reload schema';
