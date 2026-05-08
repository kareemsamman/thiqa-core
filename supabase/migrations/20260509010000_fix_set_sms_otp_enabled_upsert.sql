-- Fix set_sms_otp_enabled: the ON CONFLICT clause needs the same
-- predicate as the partial unique index (WHERE agent_id IS NOT NULL),
-- otherwise PG throws "no unique or exclusion constraint matching
-- the ON CONFLICT specification".

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
  SELECT agent_id INTO v_agent_id
  FROM public.agent_users
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'no agent for caller' USING ERRCODE = '42501';
  END IF;

  SELECT au.user_id = auth.uid() INTO v_is_owner
  FROM public.agent_users au
  WHERE au.agent_id = v_agent_id
  ORDER BY au.created_at ASC
  LIMIT 1;

  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'only the agent owner can change this setting' USING ERRCODE = '42501';
  END IF;

  -- Update first; if no row exists for this agent yet, fall through
  -- to insert. Avoids ON CONFLICT entirely so the partial unique
  -- index doesn't need a matching predicate.
  UPDATE public.auth_settings
     SET sms_otp_enabled = p_enabled,
         updated_at = now()
   WHERE agent_id = v_agent_id;

  IF NOT FOUND THEN
    INSERT INTO public.auth_settings (agent_id, sms_otp_enabled)
    VALUES (v_agent_id, p_enabled);
  END IF;

  RETURN p_enabled;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_sms_otp_enabled(boolean) TO authenticated;
