-- =============================================================================
-- Replace the wallet-credit adjuster (20260503150000) with a direct
-- agent_usage_log count adjuster.
-- =============================================================================
-- The previous RPC topped up agent_credit_wallet, which the agent's
-- /subscription page renders as "+ N رصيد إضافي" under the usage tile —
-- but Thiqa admin wants the displayed counter itself to change, not a
-- separate "extra credit" line. Now the RPC writes directly to
-- agent_usage_log.count for the current period:
--
--   +N → count += N  (more usage charged against the agent)
--   -N → count -= N  (free up quota; clamped at 0)
--
-- The new count flows back through the same agent_usage_log read on the
-- agent's /subscription tiles, so "8 / 150" becomes whatever the admin
-- sets it to without any extra-credit chrome.
-- =============================================================================

-- Drop the old wallet-credit RPC; nothing else calls it.
DROP FUNCTION IF EXISTS public.adjust_agent_credit(uuid, text, int);

CREATE OR REPLACE FUNCTION public.adjust_agent_usage(
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
  v_period text := to_char(now(), 'YYYY-MM');
  v_new_count int;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only Thiqa super admins can adjust agent usage'
      USING ERRCODE = '42501';
  END IF;

  IF p_usage_type NOT IN ('sms', 'marketing_sms', 'ai_chat') THEN
    RAISE EXCEPTION 'Unknown usage_type: %', p_usage_type
      USING ERRCODE = '22023';
  END IF;

  -- UPSERT the usage row for the current period. INSERT path uses
  -- GREATEST(0, delta) so a negative-delta-on-a-fresh-month doesn't
  -- create a row with count=0 noise; UPDATE path applies the delta
  -- and clamps at 0.
  INSERT INTO public.agent_usage_log (agent_id, usage_type, period, count)
  VALUES (p_agent_id, p_usage_type, v_period, GREATEST(0, p_delta))
  ON CONFLICT (agent_id, usage_type, period)
  DO UPDATE SET count = GREATEST(0, public.agent_usage_log.count + p_delta)
  RETURNING count INTO v_new_count;

  RETURN v_new_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_agent_usage(uuid, text, int) TO authenticated;
