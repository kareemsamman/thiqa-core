-- Agent-purchased usage overages — lets agents buy extra SMS / AI quota for
-- the current period without waiting for a super admin to raise their limit.
-- Each row represents a top-up: `extra_count` units at `unit_price` each for
-- the given `(agent_id, usage_type, period)`. The server-side usage-limits
-- helper sums active overages for the current period and adds them to the
-- effective limit, so enforcement respects the top-up immediately.

CREATE TABLE IF NOT EXISTS public.agent_usage_overages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  usage_type text NOT NULL CHECK (usage_type IN ('sms', 'ai_chat')),
  period text NOT NULL,                -- 'YYYY-MM' (monthly)
  extra_count int NOT NULL CHECK (extra_count > 0),
  unit_price numeric(10, 3) NOT NULL CHECK (unit_price >= 0),
  total_amount numeric(10, 2) NOT NULL CHECK (total_amount >= 0),
  purchased_by uuid REFERENCES auth.users(id),
  billed boolean NOT NULL DEFAULT false, -- super-admin marks true when rolled into a monthly bill
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_usage_overages_lookup
  ON public.agent_usage_overages(agent_id, usage_type, period);

CREATE INDEX IF NOT EXISTS idx_agent_usage_overages_unbilled
  ON public.agent_usage_overages(agent_id) WHERE billed = false;

ALTER TABLE public.agent_usage_overages ENABLE ROW LEVEL SECURITY;

-- Agents can read their own overages, super admins can read everything.
DROP POLICY IF EXISTS "agent_data_select" ON public.agent_usage_overages;
CREATE POLICY "agent_data_select" ON public.agent_usage_overages FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id())
  );

-- Inserts happen through the purchase-usage-overage edge function as
-- service_role, never from the client directly.
DROP POLICY IF EXISTS "service_role_all" ON public.agent_usage_overages;
CREATE POLICY "service_role_all" ON public.agent_usage_overages FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Super admins can update (e.g. to mark billed) / delete if needed.
DROP POLICY IF EXISTS "super_admin_manage" ON public.agent_usage_overages;
CREATE POLICY "super_admin_manage" ON public.agent_usage_overages FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Platform defaults for overage unit prices (in ₪).
-- Super admin can change these later in thiqa_platform_settings.
-- ---------------------------------------------------------------------------
INSERT INTO public.thiqa_platform_settings (setting_key, setting_value) VALUES
  ('sms_overage_unit_price', '0.3'),
  ('ai_overage_unit_price', '0.5')
ON CONFLICT (setting_key) DO NOTHING;

-- Refresh PostgREST schema cache so the new table is queryable immediately.
NOTIFY pgrst, 'reload schema';
