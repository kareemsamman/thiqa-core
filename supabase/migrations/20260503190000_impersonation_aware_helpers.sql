-- Make tenant helpers impersonation-aware so SECURITY DEFINER RPCs
-- (which bypass RLS) automatically scope to the impersonated agent
-- when a super admin is in an active impersonation session.
--
-- Background
-- ----------
-- 20260503130000 made the agent_data_* RLS policies impersonation-
-- aware: during impersonation they only show rows where
-- agent_id = get_impersonated_agent_id(), and they don't even consult
-- is_super_admin(). That fixed direct table reads/writes.
--
-- It did NOT fix SECURITY DEFINER RPCs, which bypass RLS by definition.
-- Every dashboard / report RPC follows this pattern:
--
--   v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
--   ...
--   IF NOT v_is_sa THEN v_agent_id := public.get_user_agent_id(...); END IF;
--   ...
--   WHERE ... AND (v_is_sa OR p.agent_id = v_agent_id)
--
-- So when a super admin impersonates an agent, v_is_sa stays true and
-- the agent filter is skipped — the RPC returns global aggregates. The
-- agent dashboard then reads e.g. "معاملات: 2" because it's summing
-- every tenant's policies created today, not the impersonated agent's.
--
-- Fix
-- ---
-- Push the impersonation check down into the helpers themselves:
--   * is_super_admin(auth.uid()) returns false while a row exists in
--     impersonation_sessions for the caller. (They're acting as the
--     agent, not as super admin.)
--   * get_user_agent_id(auth.uid()) and get_my_agent_id() return the
--     target_agent_id from impersonation_sessions when present, else
--     the caller's own agent_users row.
--
-- After this change every existing SECURITY DEFINER RPC's
-- (v_is_sa OR p.agent_id = v_agent_id) clause becomes
-- (false OR p.agent_id = <impersonated agent>), correctly tenant-
-- scoping the result without rewriting any RPC bodies.
--
-- Outside impersonation the helpers behave exactly as before, so
-- /thiqa/* admin dashboards and the global super-admin views are
-- unaffected.
--
-- The one place that *needs* the old "is this user a super admin
-- regardless of impersonation" semantics is start_impersonation, so an
-- agent can switch impersonation targets without first stopping. That
-- check is rewritten inline against thiqa_super_admins.

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.impersonation_sessions
      WHERE super_admin_user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM auth.users u
      JOIN public.thiqa_super_admins sa ON lower(u.email) = lower(sa.email)
      WHERE u.id = _user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.get_user_agent_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- Impersonation only rewrites the *caller's* effective agent_id.
    -- A super admin asking get_user_agent_id(some_other_user) keeps
    -- the literal lookup — the impersonation_sessions row is keyed on
    -- super_admin_user_id = auth.uid() AND only fires when _user_id
    -- equals the caller.
    (SELECT target_agent_id
       FROM public.impersonation_sessions
      WHERE super_admin_user_id = auth.uid()
        AND _user_id = auth.uid()),
    (SELECT agent_id
       FROM public.agent_users
      WHERE user_id = _user_id
      LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_agent_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT target_agent_id
       FROM public.impersonation_sessions
      WHERE super_admin_user_id = auth.uid()),
    (SELECT agent_id
       FROM public.agent_users
      WHERE user_id = auth.uid()
      LIMIT 1)
  );
$$;

-- start_impersonation must keep working when the caller is already
-- impersonating someone (switch-target flow). It can't go through
-- is_super_admin() any more because that now returns false during
-- impersonation. Inline the lookup against thiqa_super_admins.
CREATE OR REPLACE FUNCTION public.start_impersonation(p_agent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.thiqa_super_admins sa ON lower(u.email) = lower(sa.email)
    WHERE u.id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only Thiqa super admins can impersonate'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agents WHERE id = p_agent_id) THEN
    RAISE EXCEPTION 'Agent % does not exist', p_agent_id
      USING ERRCODE = '23503'; -- foreign_key_violation
  END IF;

  INSERT INTO public.impersonation_sessions (super_admin_user_id, target_agent_id)
  VALUES (auth.uid(), p_agent_id)
  ON CONFLICT (super_admin_user_id) DO UPDATE
    SET target_agent_id = EXCLUDED.target_agent_id,
        started_at = now();
END;
$$;
