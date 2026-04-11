-- Atomic increment for usage log counters (avoids race conditions)
CREATE OR REPLACE FUNCTION public.increment_usage_log(
  p_agent_id uuid,
  p_usage_type text,
  p_period text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.agent_usage_log (agent_id, usage_type, period, count)
  VALUES (p_agent_id, p_usage_type, p_period, 1)
  ON CONFLICT (agent_id, usage_type, period)
  DO UPDATE SET count = agent_usage_log.count + 1;
END;
$$;
