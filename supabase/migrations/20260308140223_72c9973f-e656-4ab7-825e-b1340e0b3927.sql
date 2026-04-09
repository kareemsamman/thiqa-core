
-- Fix enforce_agent_isolation: NULL agent_id should only pass for writes (WITH CHECK), not reads (USING)
-- We split into two functions: one strict (for SELECT), one permissive (for INSERT)

-- Strict version: for SELECT/UPDATE/DELETE - NULL agent_id rows are NOT visible
CREATE OR REPLACE FUNCTION public.enforce_agent_isolation(_agent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN _agent_id IS NULL THEN false
    ELSE public.user_belongs_to_agent(auth.uid(), _agent_id)
  END
$$;

-- Permissive version for INSERT WITH CHECK: allows NULL (trigger will fill it)
CREATE OR REPLACE FUNCTION public.enforce_agent_isolation_insert(_agent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN _agent_id IS NULL THEN
      EXISTS (SELECT 1 FROM public.agent_users WHERE user_id = auth.uid())
    ELSE
      public.user_belongs_to_agent(auth.uid(), _agent_id)
  END
$$;

-- Now update ALL tenant_isolation policies to use the strict version for USING
-- and the permissive version for WITH CHECK

-- Get list of tables with tenant_isolation_authenticated policy
-- We need to drop and recreate them

DO $$
DECLARE
  tbl text;
  tables_with_policy text[] := ARRAY(
    SELECT DISTINCT tablename::text FROM pg_policies 
    WHERE policyname = 'tenant_isolation_authenticated' AND schemaname = 'public'
  );
BEGIN
  FOREACH tbl IN ARRAY tables_with_policy
  LOOP
    -- Drop the old combined policy
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_authenticated ON public.%I', tbl);
    
    -- Create SELECT policy (strict - no NULL agent_id)
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON public.%I FOR SELECT TO authenticated USING (public.enforce_agent_isolation(agent_id))',
      tbl
    );
    
    -- Create INSERT policy (permissive - allows NULL for trigger)
    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.enforce_agent_isolation_insert(agent_id))',
      tbl
    );
    
    -- Create UPDATE policy (strict USING, permissive CHECK)
    EXECUTE format(
      'CREATE POLICY tenant_isolation_update ON public.%I FOR UPDATE TO authenticated USING (public.enforce_agent_isolation(agent_id)) WITH CHECK (public.enforce_agent_isolation_insert(agent_id))',
      tbl
    );
    
    -- Create DELETE policy (strict)
    EXECUTE format(
      'CREATE POLICY tenant_isolation_delete ON public.%I FOR DELETE TO authenticated USING (public.enforce_agent_isolation(agent_id))',
      tbl
    );
  END LOOP;
END $$;

-- Also backfill agent_id on notifications that have NULL
UPDATE notifications n
SET agent_id = au.agent_id
FROM agent_users au
WHERE au.user_id = n.user_id
  AND n.agent_id IS NULL;

-- Delete any notifications still with NULL agent_id (orphaned)
DELETE FROM notifications WHERE agent_id IS NULL;
