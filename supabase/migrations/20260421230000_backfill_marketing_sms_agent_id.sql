-- Marketing campaigns and their recipient rows historically went in
-- under the service role key from send-marketing-sms. Service role
-- bypasses RLS and auth.uid() is NULL inside the request, so the
-- auto_set_agent_id trigger couldn't populate agent_id. Result: rows
-- are saved with agent_id = NULL and then hidden by the SELECT policy
-- (agent_id IS NOT NULL AND agent_id = get_my_agent_id()).
--
-- Backfill from the creator's agent_users link so the admin actually
-- sees their own campaigns again in /admin/marketing-sms → سجل الحملات.

UPDATE public.marketing_sms_campaigns c
SET agent_id = au.agent_id
FROM public.agent_users au
WHERE c.agent_id IS NULL
  AND c.created_by_admin_id = au.user_id;

UPDATE public.marketing_sms_recipients r
SET agent_id = c.agent_id
FROM public.marketing_sms_campaigns c
WHERE r.agent_id IS NULL
  AND r.campaign_id = c.id
  AND c.agent_id IS NOT NULL;
