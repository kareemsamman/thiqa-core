-- Update enforce_agent_isolation to allow NULL agent_id on INSERT
-- (the auto_set_agent_id trigger will populate it after RLS check)
CREATE OR REPLACE FUNCTION public.enforce_agent_isolation(_agent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN _agent_id IS NULL THEN
      -- Allow NULL agent_id for INSERT (trigger will fill it)
      EXISTS (SELECT 1 FROM public.agent_users WHERE user_id = auth.uid())
    ELSE
      public.user_belongs_to_agent(auth.uid(), _agent_id)
  END
$$;