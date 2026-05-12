-- ============================================================
-- SECURITY FIX — restore SECURITY INVOKER on tasks RPC
--
-- 20260308121838 originally ALTERed get_tasks_with_users_and_pending
-- to SECURITY INVOKER so RLS (agent_data_select + branch_isolation)
-- decides which tasks each user can see.
--
-- 20260427170000 added a p_branch_id parameter via DROP FUNCTION +
-- CREATE FUNCTION ... SECURITY DEFINER, silently regressing the
-- security mode back to DEFINER. SECURITY DEFINER bypasses RLS,
-- so every authenticated user calling the RPC was getting tasks
-- from every agency in the database — confirmed cross-tenant leak
-- (admin of agency A seeing tasks created by admin of agency B).
--
-- Fix: switch back to SECURITY INVOKER. The agent_data_select
-- policy on public.tasks (per 20260503130000) already scopes rows
-- to the caller's agent_id, so no in-function filter is needed.
-- ============================================================

ALTER FUNCTION public.get_tasks_with_users_and_pending(date, uuid)
  SECURITY INVOKER;
