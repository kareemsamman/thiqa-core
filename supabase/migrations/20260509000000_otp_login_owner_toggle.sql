-- ============================================================
-- OTP-login owner-only toggle
--
-- Goal: let the *owner* admin of an agent (the earliest user in
-- agent_users for that agent_id) flip auth_settings.sms_otp_enabled
-- from the /subscription "إعدادات الحساب" card. Other admins of
-- the same agent should NOT be able to toggle this — only the
-- agent owner.
--
-- Two RPCs:
--   is_agent_owner()           — true if auth.uid() is the agent owner
--   set_sms_otp_enabled(bool)  — owner-only writer for the flag
-- ============================================================

-- Make sure auth_settings has at most one row per agent so the
-- writer below can ON CONFLICT (agent_id) upsert without an
-- existence check. Partial unique index covers the case where
-- legacy rows were inserted with NULL agent_id (old single-tenant
-- shape) — those are left alone.
CREATE UNIQUE INDEX IF NOT EXISTS auth_settings_agent_id_unique
  ON public.auth_settings(agent_id)
  WHERE agent_id IS NOT NULL;


CREATE OR REPLACE FUNCTION public.is_agent_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agent_users au
    WHERE au.user_id = auth.uid()
      AND au.created_at = (
        SELECT MIN(au2.created_at)
        FROM public.agent_users au2
        WHERE au2.agent_id = au.agent_id
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_agent_owner() TO authenticated;


CREATE OR REPLACE FUNCTION public.set_sms_otp_enabled(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id uuid;
  v_is_owner boolean;
BEGIN
  -- Resolve caller's agent
  SELECT agent_id INTO v_agent_id
  FROM public.agent_users
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'no agent for caller' USING ERRCODE = '42501';
  END IF;

  -- Verify caller is the owner (earliest agent_users row for this agent)
  SELECT au.user_id = auth.uid() INTO v_is_owner
  FROM public.agent_users au
  WHERE au.agent_id = v_agent_id
  ORDER BY au.created_at ASC
  LIMIT 1;

  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'only the agent owner can change this setting' USING ERRCODE = '42501';
  END IF;

  -- Upsert: ensure an auth_settings row exists for this agent, then set flag
  INSERT INTO public.auth_settings (agent_id, sms_otp_enabled)
  VALUES (v_agent_id, p_enabled)
  ON CONFLICT (agent_id) DO UPDATE
    SET sms_otp_enabled = EXCLUDED.sms_otp_enabled,
        updated_at = now();

  RETURN p_enabled;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_sms_otp_enabled(boolean) TO authenticated;
