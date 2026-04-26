-- ============================================================
-- Branch isolation for workers
--
-- Companion to the existing agent_data_* policies (which scope rows
-- by agent_id). This migration adds a second layer that scopes rows
-- by branch_id whenever the user is a non-admin worker:
--
--   * Agent admins and Thiqa super admins: bypass — see/touch every
--     row in their agent (matches current behavior).
--   * Workers with profiles.branch_id = X: see/touch only rows whose
--     branch_id = X, plus rows where branch_id IS NULL (treated as
--     "agency-wide"). Worker INSERTs get auto-filled with their
--     branch by the trigger below, so they can't deliberately stash
--     rows into the NULL bucket — only admins can create NULL-branch
--     rows, and that's intentional ("not tied to any single branch").
--
-- Implementation:
--   * Two STABLE SECURITY DEFINER helpers: get_my_branch_id() and
--     is_my_agent_admin().
--   * auto_set_branch_id() trigger mirrors the auto_set_agent_id
--     pattern — fills branch_id from the inserter's profile when not
--     supplied, so worker-driven forms that don't explicitly pass
--     branch_id still satisfy the RESTRICTIVE check.
--   * branch_isolation RESTRICTIVE policy on every public table with
--     a branch_id column, except profiles (workers must still see
--     other profiles in their agent for tasks/assignments).
--
-- Tables with branch_id are discovered via pg_attribute so the policy
-- automatically covers any future tables that add the column.
-- ============================================================

-- 1. Helpers --------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_branch_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.profiles WHERE id = auth.uid()
$$;

-- True when the current user is admin in any of their agents, OR
-- a Thiqa super admin. Combined with the agent_data_* policies
-- (which already cap visibility to the user's own agent), this
-- effectively means "admin of the agent you're querying".
CREATE OR REPLACE FUNCTION public.is_my_agent_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role = 'admin'
    )
$$;

-- 2. Auto-fill branch_id on insert ---------------------------

-- Mirrors auto_set_agent_id: if the row comes in with branch_id NULL
-- and the inserting user has a profile.branch_id, copy it over. Lets
-- workers' INSERTs satisfy the RESTRICTIVE policy without every
-- single form having to remember to pass branch_id explicitly.
-- Admins (whose profile.branch_id is typically NULL) get a NULL
-- branch_id, which is fine — they see everything anyway.
CREATE OR REPLACE FUNCTION public.auto_set_branch_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT branch_id INTO v_branch_id
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_branch_id IS NOT NULL THEN
    NEW.branch_id := v_branch_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Apply trigger + policy to every table with a branch_id col -

DO $$
DECLARE
  tbl TEXT;
  trg TEXT;
  excluded TEXT[] := ARRAY['profiles'];
BEGIN
  FOR tbl IN
    SELECT c.relname
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND a.attname = 'branch_id'
      AND c.relkind = 'r'
      AND NOT a.attisdropped
      AND c.relname <> ALL(excluded)
    ORDER BY c.relname
  LOOP
    -- Auto-set trigger (idempotent)
    trg := 'auto_set_branch_id_' || tbl;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trg, tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.auto_set_branch_id()',
      trg, tbl
    );

    -- RESTRICTIVE branch isolation policy (admin bypass + branch match)
    EXECUTE format('DROP POLICY IF EXISTS branch_isolation ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY branch_isolation ON public.%I
         AS RESTRICTIVE
         FOR ALL
         TO authenticated
         USING (
           public.is_my_agent_admin()
           OR branch_id IS NULL
           OR branch_id = public.get_my_branch_id()
         )
         WITH CHECK (
           public.is_my_agent_admin()
           OR branch_id IS NULL
           OR branch_id = public.get_my_branch_id()
         )',
      tbl
    );

    RAISE NOTICE 'branch_isolation: trigger + policy applied to %', tbl;
  END LOOP;
END $$;
