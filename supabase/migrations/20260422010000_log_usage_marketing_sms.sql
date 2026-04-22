-- =============================================================================
-- Extend log_usage_with_credit to handle marketing_sms
-- =============================================================================
-- The original function in 20260412220000_credit_wallet.sql only knew
-- about 'sms' and 'ai_chat'. With the new pricing model, marketing SMS
-- is its own usage_type with its own base quota (sms_limit) on the
-- plan and its own wallet balance (marketing_sms_credit_balance on
-- agent_credit_wallet). Add a third branch so the RPC decrements the
-- correct wallet when the campaign overruns the base allowance.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.log_usage_with_credit(
  p_agent_id uuid,
  p_usage_type text,
  p_period text,
  p_base_limit int
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count int;
  v_balance_row int;
BEGIN
  INSERT INTO public.agent_usage_log (agent_id, usage_type, period, count)
  VALUES (p_agent_id, p_usage_type, p_period, 1)
  ON CONFLICT (agent_id, usage_type, period)
  DO UPDATE SET count = agent_usage_log.count + 1
  RETURNING count INTO v_new_count;

  -- Base allowance still has room — done.
  IF v_new_count <= p_base_limit THEN
    RETURN 'base';
  END IF;

  -- Over the base limit: try to consume one credit from the matching
  -- wallet balance. Create a wallet row first so the UPDATE has a
  -- target.
  INSERT INTO public.agent_credit_wallet (agent_id)
  VALUES (p_agent_id)
  ON CONFLICT (agent_id) DO NOTHING;

  IF p_usage_type = 'sms' THEN
    UPDATE public.agent_credit_wallet
    SET sms_credit_balance = sms_credit_balance - 1,
        updated_at = now()
    WHERE agent_id = p_agent_id AND sms_credit_balance > 0
    RETURNING sms_credit_balance INTO v_balance_row;
  ELSIF p_usage_type = 'marketing_sms' THEN
    UPDATE public.agent_credit_wallet
    SET marketing_sms_credit_balance = marketing_sms_credit_balance - 1,
        updated_at = now()
    WHERE agent_id = p_agent_id AND marketing_sms_credit_balance > 0
    RETURNING marketing_sms_credit_balance INTO v_balance_row;
  ELSIF p_usage_type = 'ai_chat' THEN
    UPDATE public.agent_credit_wallet
    SET ai_credit_balance = ai_credit_balance - 1,
        updated_at = now()
    WHERE agent_id = p_agent_id AND ai_credit_balance > 0
    RETURNING ai_credit_balance INTO v_balance_row;
  ELSE
    RAISE EXCEPTION 'log_usage_with_credit: unknown usage_type %', p_usage_type
      USING ERRCODE = 'P0001';
  END IF;

  -- No credit left: roll back the usage increment (refund) and raise.
  -- The caller should treat this as insufficient_credits.
  IF v_balance_row IS NULL THEN
    UPDATE public.agent_usage_log
    SET count = GREATEST(0, count - 1)
    WHERE agent_id = p_agent_id
      AND usage_type = p_usage_type
      AND period = p_period;

    RAISE EXCEPTION 'insufficient_credits'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN 'credit';
END;
$$;
