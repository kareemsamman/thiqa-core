DROP POLICY IF EXISTS "agent_data_select" ON public.notifications;
CREATE POLICY "agent_data_select" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    agent_id IS NOT NULL
    AND agent_id = get_my_agent_id()
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "agent_data_update" ON public.notifications;
CREATE POLICY "agent_data_update" ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    agent_id IS NOT NULL
    AND agent_id = get_my_agent_id()
    AND user_id = auth.uid()
  )
  WITH CHECK (
    (agent_id IS NULL OR agent_id = get_my_agent_id())
  );

DROP POLICY IF EXISTS "agent_data_delete" ON public.notifications;
CREATE POLICY "agent_data_delete" ON public.notifications
  FOR DELETE TO authenticated
  USING (
    agent_id IS NOT NULL
    AND agent_id = get_my_agent_id()
    AND user_id = auth.uid()
  );