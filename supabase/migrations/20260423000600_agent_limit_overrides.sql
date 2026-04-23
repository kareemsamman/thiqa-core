-- =============================================================================
-- Per-agent limit overrides
-- =============================================================================
-- Lets the Thiqa super admin bump / clamp an individual agent's quota
-- for any of the six resources (users / branches / policies / sms /
-- marketing_sms / ai) without creating an addon row or changing the
-- plan. Useful when a specific agency is mid-migration, is on a custom
-- deal, or just needs a temporary bump.
--
-- Encoding for every `<resource>_limit_override` column:
--   NULL  → inherit the plan value
--   -1    → override to unlimited
--    >=0  → override to exactly this number
-- =============================================================================

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS users_limit_override         int,
  ADD COLUMN IF NOT EXISTS branches_limit_override      int,
  ADD COLUMN IF NOT EXISTS policies_limit_override      int,
  ADD COLUMN IF NOT EXISTS sms_limit_override           int,
  ADD COLUMN IF NOT EXISTS marketing_sms_limit_override int,
  ADD COLUMN IF NOT EXISTS ai_limit_override            int;

-- Teach get_agent_effective_limit to check the override first. NULL
-- override → fall back to the plan value (existing behavior). Non-null
-- override replaces the plan value, and -1 is the sentinel for
-- "unlimited" so the caller (enforce_*_limit) gets NULL back.
CREATE OR REPLACE FUNCTION public.get_agent_effective_limit(
  p_agent_id uuid,
  p_resource text
)
RETURNS TABLE(plan_key text, plan_limit int, addon_quantity int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_key text;
  v_plan_limit int;
  v_override int;
  v_addon_qty int := 0;
  v_addon_type text;
BEGIN
  SELECT
    a.plan,
    CASE p_resource
      WHEN 'users'         THEN a.users_limit_override
      WHEN 'branches'      THEN a.branches_limit_override
      WHEN 'policies'      THEN a.policies_limit_override
      WHEN 'sms'           THEN a.sms_limit_override
      WHEN 'marketing_sms' THEN a.marketing_sms_limit_override
      WHEN 'ai'            THEN a.ai_limit_override
    END
  INTO v_plan_key, v_override
  FROM public.agents a
  WHERE a.id = p_agent_id;

  IF v_override IS NOT NULL THEN
    -- -1 means "unlimited" — return NULL so the trigger treats it as
    -- "no cap" exactly like a plan column that was NULL.
    v_plan_limit := CASE WHEN v_override = -1 THEN NULL ELSE v_override END;
  ELSE
    SELECT
      CASE p_resource
        WHEN 'users'         THEN sp.users_limit
        WHEN 'branches'      THEN sp.branches_limit
        WHEN 'policies'      THEN sp.policies_limit
        WHEN 'sms'           THEN sp.sms_limit
        WHEN 'marketing_sms' THEN sp.marketing_sms_limit
        WHEN 'ai'            THEN sp.ai_limit
      END
    INTO v_plan_limit
    FROM public.subscription_plans sp
    WHERE sp.plan_key = v_plan_key;
  END IF;

  -- Addons (users/branches/sms/marketing_sms/ai only — same as before).
  v_addon_type := CASE p_resource
    WHEN 'users'         THEN 'extra_user'
    WHEN 'branches'      THEN 'extra_branch'
    WHEN 'sms'           THEN 'extra_sms'
    WHEN 'marketing_sms' THEN 'extra_marketing_sms'
    WHEN 'ai'            THEN 'extra_ai'
    ELSE NULL
  END;

  IF v_addon_type IS NOT NULL THEN
    SELECT COALESCE(SUM(quantity), 0) INTO v_addon_qty
    FROM public.agent_addons
    WHERE agent_id = p_agent_id
      AND addon_type = v_addon_type
      AND status = 'active'
      AND billing_cycle = 'monthly'
      AND starts_at <= CURRENT_DATE
      AND (ends_at IS NULL OR ends_at >= CURRENT_DATE);
  END IF;

  RETURN QUERY SELECT v_plan_key, v_plan_limit, v_addon_qty;
END;
$$;
