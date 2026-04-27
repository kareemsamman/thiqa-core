-- ============================================================
-- unlock_plan_locked_user(p_user_id) — agent-admin-driven manual
-- unlock for plan_locked profiles
--
-- Background: the sync_plan_change_overflow trigger auto-restores
-- the oldest plan_locked user when an agent's plan changes — but
-- it ONLY fires on agents.plan UPDATE. When the Thiqa admin
-- approves an "extra user" addon (agent_addons → status='active'),
-- agents.plan doesn't change, so nothing reconciles and every
-- previously-locked user stays locked even though the effective
-- limit (plan + addons) has gone up.
--
-- Auto-restoring on addon approval would force the agent admin to
-- accept whatever order sync_plan_change_overflow picks ("oldest
-- first"). The user feedback was explicit: when a single seat
-- opens up via an addon, the agent admin wants to *choose* which
-- locked user gets it — not have it auto-assigned.
--
-- This RPC is the manual unlock path:
--   * SECURITY DEFINER so it can flip profiles.status past the
--     normal RLS write rules.
--   * Verifies the caller is an admin of the same agent as the
--     target user. Workers can't unlock teammates; admins of
--     other agents can't touch this agent's users.
--   * Sets status='active'. The existing enforce_user_limit
--     trigger fires and either succeeds (capacity available) or
--     raises LIMIT_EXCEEDED (no capacity → returns a friendly
--     Arabic error to the UI).
--   * Returns the updated profile id on success so the client can
--     optimistically update.
-- ============================================================

CREATE OR REPLACE FUNCTION public.unlock_plan_locked_user(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_agent_id uuid;
  v_target_agent_id uuid;
  v_target_status text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id مطلوب';
  END IF;

  -- Resolve the target's agent + current status. maybeSingle-style
  -- lookup so we can throw a clean Arabic error if the row doesn't
  -- exist instead of leaking SQL state.
  SELECT agent_id, status::text
    INTO v_target_agent_id, v_target_status
  FROM public.profiles
  WHERE id = p_user_id;

  IF v_target_agent_id IS NULL THEN
    RAISE EXCEPTION 'المستخدم غير موجود';
  END IF;

  IF v_target_status <> 'plan_locked' THEN
    RAISE EXCEPTION 'هذا المستخدم ليس مقفلاً';
  END IF;

  -- Caller must be an admin of the same agent. Super admin via the
  -- standard is_super_admin check bypasses (used during
  -- impersonation testing from /thiqa).
  IF NOT public.is_super_admin(auth.uid()) THEN
    SELECT au.agent_id
      INTO v_caller_agent_id
    FROM public.agent_users au
    JOIN public.user_roles ur ON ur.user_id = au.user_id
    WHERE au.user_id = auth.uid()
      AND ur.role = 'admin'
      AND au.agent_id = v_target_agent_id
    LIMIT 1;

    IF v_caller_agent_id IS NULL THEN
      RAISE EXCEPTION 'لا تملك صلاحية فتح هذا المستخدم';
    END IF;
  END IF;

  -- Flip to active. The trg_enforce_user_limit BEFORE-UPDATE trigger
  -- runs and either accepts (capacity available from plan + addons)
  -- or raises LIMIT_EXCEEDED:users:... which the client surfaces.
  UPDATE public.profiles
  SET status = 'active'
  WHERE id = p_user_id;

  RETURN p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_plan_locked_user(uuid) TO authenticated;
