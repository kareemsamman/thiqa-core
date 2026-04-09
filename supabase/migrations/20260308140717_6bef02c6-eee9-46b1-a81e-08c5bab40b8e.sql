-- Harden tenant isolation and remove cross-agent visibility leaks

-- 1) Fix wrong cross-tenant unique constraint introduced earlier
ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;

-- Keep canonical uniqueness per tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_agent_id_key'
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_agent_id_key UNIQUE (user_id, agent_id);
  END IF;
END $$;

-- 2) Remove permissive cross-agent admin policies on key identity tables
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;

-- 3) Add restrictive tenant guard policies to ALL agent-scoped tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'agent_id'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=tbl AND policyname='agent_guard_select'
    ) THEN
      EXECUTE format(
        'CREATE POLICY agent_guard_select ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.enforce_agent_isolation(agent_id))',
        tbl
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=tbl AND policyname='agent_guard_insert'
    ) THEN
      EXECUTE format(
        'CREATE POLICY agent_guard_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.enforce_agent_isolation_insert(agent_id))',
        tbl
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=tbl AND policyname='agent_guard_update'
    ) THEN
      EXECUTE format(
        'CREATE POLICY agent_guard_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.enforce_agent_isolation(agent_id)) WITH CHECK (public.enforce_agent_isolation_insert(agent_id))',
        tbl
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=tbl AND policyname='agent_guard_delete'
    ) THEN
      EXECUTE format(
        'CREATE POLICY agent_guard_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.enforce_agent_isolation(agent_id))',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- 4) Scope login attempts visibility by tenant (table has no agent_id)
CREATE OR REPLACE FUNCTION public.can_view_login_attempt(_attempt_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.is_super_admin(auth.uid()) THEN true
    WHEN _attempt_user_id IS NULL THEN false
    WHEN _attempt_user_id = auth.uid() THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles me
      JOIN public.profiles target ON target.id = _attempt_user_id
      WHERE me.user_id = auth.uid()
        AND me.role = 'admin'::public.app_role
        AND me.agent_id = target.agent_id
    )
  END
$$;

DROP POLICY IF EXISTS "Admins can view login attempts" ON public.login_attempts;
CREATE POLICY "Users/admins can view scoped login attempts"
ON public.login_attempts
FOR SELECT
TO authenticated
USING (public.can_view_login_attempt(user_id));