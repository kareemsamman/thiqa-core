
-- 1) payment_settings: drop the broad cross-tenant admin SELECT policy.
-- The existing agent_data_select policy already lets admins of an agent
-- see their own agent's payment settings.
DROP POLICY IF EXISTS "Admins can view payment settings" ON public.payment_settings;

-- 2) import_progress: scope by agent_id.
ALTER TABLE public.import_progress
  ADD COLUMN IF NOT EXISTS agent_id uuid;

-- Backfill existing rows to the creating admin's agent if possible (best effort).
-- New rows will be auto-set by the existing auto_set_agent_id trigger pattern.
DROP TRIGGER IF EXISTS set_agent_id_import_progress ON public.import_progress;
CREATE TRIGGER set_agent_id_import_progress
  BEFORE INSERT ON public.import_progress
  FOR EACH ROW EXECUTE FUNCTION public.auto_set_agent_id();

-- Replace the over-broad admin policy with a tenant-scoped one.
DROP POLICY IF EXISTS "Admins can manage import progress" ON public.import_progress;

CREATE POLICY "Admins manage own agent import progress"
  ON public.import_progress
  FOR ALL
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'admin'::app_role)
      AND agent_id IS NOT NULL
      AND agent_id = public.get_my_agent_id()
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'admin'::app_role)
      AND (agent_id IS NULL OR agent_id = public.get_my_agent_id())
    )
  );

-- 3) realtime.messages: deny broadcast/presence subscriptions by default.
-- The app uses Postgres-changes subscriptions (governed by table RLS), not
-- broadcast/presence topics, so a default-deny policy is safe and closes
-- the cross-tenant topic-subscription gap.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny realtime broadcast/presence by default" ON realtime.messages;
CREATE POLICY "Deny realtime broadcast/presence by default"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (false);

DROP POLICY IF EXISTS "Deny realtime broadcast/presence write by default" ON realtime.messages;
CREATE POLICY "Deny realtime broadcast/presence write by default"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (false);
