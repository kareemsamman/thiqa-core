-- ============================================================
-- Fix notification agent isolation:
-- 1. Drop old RLS policies that only check user_id (no agent_id)
-- 2. Ensure agent_data_* policies are the ONLY active policies
-- 3. Clean up orphaned notifications with NULL agent_id
-- ============================================================

-- Drop old permissive policies that bypass agent isolation
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service can insert notifications" ON public.notifications;

-- Ensure agent_data_select exists with proper agent + user check
DROP POLICY IF EXISTS "agent_data_select" ON public.notifications;
CREATE POLICY "agent_data_select" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
    AND user_id = auth.uid()
  );

-- Ensure agent_data_insert exists
DROP POLICY IF EXISTS "agent_data_insert" ON public.notifications;
CREATE POLICY "agent_data_insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    agent_id IS NULL OR agent_id = public.get_my_agent_id()
  );

-- Ensure agent_data_update exists with proper agent + user check
DROP POLICY IF EXISTS "agent_data_update" ON public.notifications;
CREATE POLICY "agent_data_update" ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
    AND user_id = auth.uid()
  )
  WITH CHECK (
    agent_id IS NULL OR agent_id = public.get_my_agent_id()
  );

-- Ensure agent_data_delete exists with proper agent + user check
DROP POLICY IF EXISTS "agent_data_delete" ON public.notifications;
CREATE POLICY "agent_data_delete" ON public.notifications
  FOR DELETE TO authenticated
  USING (
    agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
    AND user_id = auth.uid()
  );

-- Allow service role / triggers to insert notifications (needed for SECURITY DEFINER triggers)
CREATE POLICY "service_insert_notifications" ON public.notifications
  FOR INSERT TO service_role
  WITH CHECK (true);

-- Backfill agent_id on notifications that have NULL (match via user's agent)
UPDATE public.notifications n
SET agent_id = au.agent_id
FROM public.agent_users au
WHERE au.user_id = n.user_id
  AND n.agent_id IS NULL;

-- Delete any orphaned notifications still with NULL agent_id
DELETE FROM public.notifications WHERE agent_id IS NULL;
