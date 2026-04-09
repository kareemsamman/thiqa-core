-- Fix: unique constraint should be (user_id, agent_id) not (user_id, role)
-- A user has ONE role per agent, but can exist in multiple agents
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_agent_id_key UNIQUE (user_id, agent_id);