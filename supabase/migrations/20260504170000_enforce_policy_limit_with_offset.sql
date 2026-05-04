-- Teach enforce_policy_limit about policies_usage_offset so seed/
-- imported policies don't permanently block creation. Mirrors the
-- subtraction the front-end useAgentLimits + AgentUsageStats now do
-- on the displayed count.
--
-- Logic:
--   actual_count_in_period - offset >= effective_limit  → blocked
--   (offset clamped to >=0; new groups joining an existing in-period
--    package still get the free pass, same as before).

CREATE OR REPLACE FUNCTION public.enforce_policy_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit RECORD;
  v_effective int;
  v_current int;
  v_offset int;
  v_period text;
  v_period_start timestamptz;
  v_already_in_period boolean;
BEGIN
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_limit FROM public.get_agent_effective_limit(NEW.agent_id, 'policies');

  IF v_limit.plan_limit IS NULL THEN
    RETURN NEW;  -- unlimited
  END IF;

  v_effective := v_limit.plan_limit + COALESCE(v_limit.addon_quantity, 0);

  SELECT setting_value INTO v_period
  FROM public.thiqa_platform_settings
  WHERE setting_key = 'policy_limit_period';
  v_period := COALESCE(v_period, 'monthly');

  v_period_start := CASE v_period
    WHEN 'monthly' THEN date_trunc('month', CURRENT_DATE)
    WHEN 'yearly'  THEN date_trunc('year', CURRENT_DATE)
    ELSE 'epoch'::timestamptz
  END;

  -- If this new policy joins a group that already has sibling(s) in
  -- the same period, it's free — the group was already counted.
  IF NEW.group_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.policies
      WHERE agent_id = NEW.agent_id
        AND group_id = NEW.group_id
        AND created_at >= v_period_start
        AND id <> NEW.id
    ) INTO v_already_in_period;

    IF v_already_in_period THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Otherwise count distinct transactions in the period, then
  -- subtract the per-agent offset so seed/imported packages don't
  -- consume quota.
  SELECT COUNT(DISTINCT COALESCE(group_id, id)) INTO v_current
  FROM public.policies
  WHERE agent_id = NEW.agent_id
    AND created_at >= v_period_start
    AND id <> NEW.id;

  SELECT COALESCE(policies_usage_offset, 0) INTO v_offset
  FROM public.agents
  WHERE id = NEW.agent_id;

  v_current := GREATEST(0, v_current - COALESCE(v_offset, 0));

  IF v_current >= v_effective THEN
    RAISE EXCEPTION 'LIMIT_EXCEEDED:policies:%:%:%',
      v_limit.plan_key, v_current, v_effective
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
