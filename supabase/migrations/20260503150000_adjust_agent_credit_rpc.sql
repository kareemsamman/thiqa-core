-- =============================================================================
-- adjust_agent_credit — Thiqa-admin manual top-up / clawback for the
-- agent_credit_wallet (SMS, marketing SMS, AI). Positive delta adds
-- credit, negative removes (clamped at 0 — the wallet has CHECK >= 0).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.adjust_agent_credit(
  p_agent_id uuid,
  p_usage_type text,
  p_delta int
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance int;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only Thiqa super admins can adjust agent credit'
      USING ERRCODE = '42501';
  END IF;

  IF p_usage_type NOT IN ('sms', 'marketing_sms', 'ai_chat') THEN
    RAISE EXCEPTION 'Unknown usage_type: %', p_usage_type
      USING ERRCODE = '22023';
  END IF;

  -- Make sure the wallet row exists before we touch it. INSERT-on-conflict
  -- so concurrent adjustments don't race the seed.
  INSERT INTO public.agent_credit_wallet (agent_id)
  VALUES (p_agent_id)
  ON CONFLICT (agent_id) DO NOTHING;

  -- GREATEST(0, balance + delta) keeps the CHECK constraint happy when
  -- the admin hands out a clawback bigger than the current balance.
  IF p_usage_type = 'sms' THEN
    UPDATE public.agent_credit_wallet
    SET sms_credit_balance = GREATEST(0, sms_credit_balance + p_delta),
        updated_at = now()
    WHERE agent_id = p_agent_id
    RETURNING sms_credit_balance INTO v_new_balance;
  ELSIF p_usage_type = 'marketing_sms' THEN
    UPDATE public.agent_credit_wallet
    SET marketing_sms_credit_balance = GREATEST(0, marketing_sms_credit_balance + p_delta),
        updated_at = now()
    WHERE agent_id = p_agent_id
    RETURNING marketing_sms_credit_balance INTO v_new_balance;
  ELSE -- ai_chat
    UPDATE public.agent_credit_wallet
    SET ai_credit_balance = GREATEST(0, ai_credit_balance + p_delta),
        updated_at = now()
    WHERE agent_id = p_agent_id
    RETURNING ai_credit_balance INTO v_new_balance;
  END IF;

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_agent_credit(uuid, text, int) TO authenticated;
