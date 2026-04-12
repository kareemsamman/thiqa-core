-- Convert the overage model from "period-scoped extra quota" to a persistent
-- credit wallet, like a top-up card. The base monthly allowance is still
-- enforced first (e.g. 100 SMS / month), but once the agent crosses it, sends
-- are funded from the wallet and the balance decrements. Credits never expire.

-- ---------------------------------------------------------------------------
-- agent_credit_wallet — one row per agent holding the rolling balance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_credit_wallet (
  agent_id uuid PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
  sms_credit_balance int NOT NULL DEFAULT 0 CHECK (sms_credit_balance >= 0),
  ai_credit_balance int NOT NULL DEFAULT 0 CHECK (ai_credit_balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_credit_wallet ENABLE ROW LEVEL SECURITY;

-- Agents can read their own wallet; super admins can read everything.
DROP POLICY IF EXISTS "agent_data_select" ON public.agent_credit_wallet;
CREATE POLICY "agent_data_select" ON public.agent_credit_wallet FOR SELECT TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id())
  );

-- Only service_role (edge functions) and super admins may mutate.
DROP POLICY IF EXISTS "service_role_all" ON public.agent_credit_wallet;
CREATE POLICY "service_role_all" ON public.agent_credit_wallet FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "super_admin_manage" ON public.agent_credit_wallet;
CREATE POLICY "super_admin_manage" ON public.agent_credit_wallet FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- Backfill: seed wallets from any existing overage purchases. Since overages
-- used to be monthly and resetted, this is a one-time import that converts
-- unused-this-month overages into the new persistent balance.
-- ---------------------------------------------------------------------------
INSERT INTO public.agent_credit_wallet (agent_id, sms_credit_balance, ai_credit_balance)
SELECT
  agent_id,
  COALESCE(SUM(CASE WHEN usage_type = 'sms' THEN extra_count ELSE 0 END), 0)::int,
  COALESCE(SUM(CASE WHEN usage_type = 'ai_chat' THEN extra_count ELSE 0 END), 0)::int
FROM public.agent_usage_overages
GROUP BY agent_id
ON CONFLICT (agent_id) DO UPDATE SET
  sms_credit_balance = agent_credit_wallet.sms_credit_balance + EXCLUDED.sms_credit_balance,
  ai_credit_balance = agent_credit_wallet.ai_credit_balance + EXCLUDED.ai_credit_balance,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- log_usage_with_credit — atomic "use 1 unit" operation.
-- 1. Increments the monthly usage log (agent_usage_log.count += 1).
-- 2. If the new count is still within the base monthly limit, nothing else
--    happens — the send is free from the base allowance.
-- 3. If the new count exceeds base_limit, the function tries to decrement
--    the wallet balance by 1. If the wallet is empty, the log increment is
--    reverted (refund) and the function raises an exception so the caller
--    knows the send should be blocked.
--
-- This function replaces the earlier increment_usage_log for callers that
-- want the credit-wallet semantics. The simpler increment_usage_log is kept
-- for callers that don't need wallet awareness.
-- ---------------------------------------------------------------------------
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
  -- Increment the usage log and capture the new count atomically.
  INSERT INTO public.agent_usage_log (agent_id, usage_type, period, count)
  VALUES (p_agent_id, p_usage_type, p_period, 1)
  ON CONFLICT (agent_id, usage_type, period)
  DO UPDATE SET count = agent_usage_log.count + 1
  RETURNING count INTO v_new_count;

  -- Base allowance still has room — done.
  IF v_new_count <= p_base_limit THEN
    RETURN 'base';
  END IF;

  -- Over the base limit: try to consume one credit from the wallet.
  -- Ensure a wallet row exists first so the UPDATE has a target.
  INSERT INTO public.agent_credit_wallet (agent_id)
  VALUES (p_agent_id)
  ON CONFLICT (agent_id) DO NOTHING;

  IF p_usage_type = 'sms' THEN
    UPDATE public.agent_credit_wallet
    SET sms_credit_balance = sms_credit_balance - 1,
        updated_at = now()
    WHERE agent_id = p_agent_id AND sms_credit_balance > 0
    RETURNING sms_credit_balance INTO v_balance_row;
  ELSIF p_usage_type = 'ai_chat' THEN
    UPDATE public.agent_credit_wallet
    SET ai_credit_balance = ai_credit_balance - 1,
        updated_at = now()
    WHERE agent_id = p_agent_id AND ai_credit_balance > 0
    RETURNING ai_credit_balance INTO v_balance_row;
  ELSE
    -- Unknown usage type: roll back the log bump and complain.
    UPDATE public.agent_usage_log
    SET count = count - 1
    WHERE agent_id = p_agent_id AND usage_type = p_usage_type AND period = p_period;
    RAISE EXCEPTION 'Unknown usage type: %', p_usage_type;
  END IF;

  IF NOT FOUND THEN
    -- Wallet was empty. Refund the log increment so the counter stays
    -- accurate, then fail so the edge function can return a 429.
    UPDATE public.agent_usage_log
    SET count = count - 1
    WHERE agent_id = p_agent_id AND usage_type = p_usage_type AND period = p_period;
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  RETURN 'credit';
END;
$$;

-- ---------------------------------------------------------------------------
-- Add a "wallet" source marker to the audit trail so super admins can see
-- whether an overage row was consumed by the wallet top-up flow or the old
-- monthly model. Existing rows stay as they are — period continues to mean
-- "month the purchase happened in" but is no longer the quota key.
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_usage_overages
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'wallet'
    CHECK (source IN ('wallet', 'legacy_monthly'));

-- Tag historical rows so we don't confuse them with new wallet top-ups.
UPDATE public.agent_usage_overages SET source = 'legacy_monthly' WHERE source IS NULL;

NOTIFY pgrst, 'reload schema';
