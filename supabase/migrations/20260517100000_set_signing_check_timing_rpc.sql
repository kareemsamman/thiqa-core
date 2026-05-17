-- Owner-gated setter for agents.signing_check_timing.
--
-- Direct UPDATE on public.agents is blocked by RLS for normal agent
-- users (only Thiqa super-admins / impersonation flows can write).
-- The /subscription → الحساب toggle was hitting that silently — the
-- update returned no error and no rows, the success toast fired, and
-- the value never persisted. Mirror the set_sms_otp_enabled pattern:
-- a SECURITY DEFINER RPC that resolves the caller's agent and checks
-- they're the agency owner (first agent_users row by created_at) before
-- writing.
--
-- See migration 20260516200000_agents_signing_check_timing for the
-- column itself.

CREATE OR REPLACE FUNCTION public.set_signing_check_timing(p_timing text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id uuid;
  v_is_owner boolean;
BEGIN
  IF p_timing NOT IN ('on_client_select', 'on_completion') THEN
    RAISE EXCEPTION 'invalid signing_check_timing: %', p_timing
      USING ERRCODE = '22023';
  END IF;

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
    RAISE EXCEPTION 'only the agent owner can change this setting'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.agents
     SET signing_check_timing = p_timing,
         updated_at = now()
   WHERE id = v_agent_id;

  RETURN p_timing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_signing_check_timing(text) TO authenticated;
