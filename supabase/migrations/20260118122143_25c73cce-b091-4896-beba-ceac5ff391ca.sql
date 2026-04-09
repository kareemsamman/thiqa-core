
-- Fix Debt Tracking to exclude broker-related policies
-- Issue 1: Broker-linked policies should NOT appear in debt tracking
-- Issue 2: Will need to handle visa payments during import (frontend fix)

-- Update report_client_debts to exclude broker-related policies
CREATE OR REPLACE FUNCTION public.report_client_debts(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  phone_number text,
  total_owed numeric,
  policies_count integer,
  earliest_expiry date,
  days_until_expiry integer,
  total_rows bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
WITH policy_debt AS (
  SELECT
    p.id AS policy_id,
    p.client_id,
    p.end_date::date AS end_date,
    (p.insurance_price - COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0))::numeric AS remaining
  FROM public.policies p
  LEFT JOIN public.policy_payments pp ON pp.policy_id = p.id
  WHERE p.cancelled = false
    AND p.deleted_at IS NULL
    -- استثناء وثائق الإلزامي لأنها تُدفع مباشرة عبر الشركة
    AND p.policy_type_parent <> 'ELZAMI'
    -- استثناء الوثائق المرتبطة بوسيط - هذه تُدار عبر محفظة الوسيط وليس عبر تتبع ديون العملاء
    AND p.broker_id IS NULL
  GROUP BY p.id, p.client_id, p.end_date, p.insurance_price
),
client_debt AS (
  SELECT
    c.id AS client_id,
    c.full_name AS client_name,
    c.phone_number AS phone_number,
    SUM(pd.remaining)::numeric AS total_owed,
    COUNT(*)::int AS policies_count,
    MIN(pd.end_date) AS earliest_expiry
  FROM policy_debt pd
  JOIN public.clients c ON c.id = pd.client_id
  WHERE pd.remaining > 0
    AND public.is_active_user(auth.uid())
    AND public.can_access_branch(auth.uid(), c.branch_id)
    AND (
      p_search IS NULL
      OR c.full_name ILIKE ('%' || p_search || '%')
      OR c.phone_number ILIKE ('%' || p_search || '%')
    )
  GROUP BY c.id, c.full_name, c.phone_number
),
filtered AS (
  SELECT
    cd.*,
    (cd.earliest_expiry - CURRENT_DATE)::int AS days_until_expiry
  FROM client_debt cd
  WHERE p_filter_days IS NULL
     OR (cd.earliest_expiry - CURRENT_DATE) <= p_filter_days
)
SELECT
  f.client_id,
  f.client_name,
  f.phone_number,
  f.total_owed,
  f.policies_count,
  f.earliest_expiry,
  f.days_until_expiry,
  COUNT(*) OVER() AS total_rows
FROM filtered f
ORDER BY f.total_owed DESC
LIMIT GREATEST(p_limit, 0)
OFFSET GREATEST(p_offset, 0);
$$;

-- Update report_client_debts_summary to exclude broker-related policies
CREATE OR REPLACE FUNCTION public.report_client_debts_summary(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL
)
RETURNS TABLE(
  total_clients bigint,
  total_owed numeric,
  expiring_soon bigint,
  expired bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
WITH policy_debt AS (
  SELECT
    p.id AS policy_id,
    p.client_id,
    p.end_date::date AS end_date,
    (p.insurance_price - COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0))::numeric AS remaining
  FROM public.policies p
  LEFT JOIN public.policy_payments pp ON pp.policy_id = p.id
  WHERE p.cancelled = false
    AND p.deleted_at IS NULL
    -- استثناء وثائق الإلزامي
    AND p.policy_type_parent <> 'ELZAMI'
    -- استثناء الوثائق المرتبطة بوسيط
    AND p.broker_id IS NULL
  GROUP BY p.id, p.client_id, p.end_date, p.insurance_price
),
client_debt AS (
  SELECT
    c.id AS client_id,
    SUM(pd.remaining)::numeric AS total_owed,
    MIN(pd.end_date) AS earliest_expiry
  FROM policy_debt pd
  JOIN public.clients c ON c.id = pd.client_id
  WHERE pd.remaining > 0
    AND public.is_active_user(auth.uid())
    AND public.can_access_branch(auth.uid(), c.branch_id)
    AND (
      p_search IS NULL
      OR c.full_name ILIKE ('%' || p_search || '%')
      OR c.phone_number ILIKE ('%' || p_search || '%')
    )
  GROUP BY c.id
),
filtered AS (
  SELECT
    cd.*,
    (cd.earliest_expiry - CURRENT_DATE)::int AS days_until_expiry
  FROM client_debt cd
  WHERE p_filter_days IS NULL
     OR (cd.earliest_expiry - CURRENT_DATE) <= p_filter_days
)
SELECT
  COUNT(*) AS total_clients,
  COALESCE(SUM(total_owed), 0)::numeric AS total_owed,
  COUNT(*) FILTER (WHERE days_until_expiry <= 30 AND days_until_expiry >= 0) AS expiring_soon,
  COUNT(*) FILTER (WHERE days_until_expiry < 0) AS expired
FROM filtered;
$$;

-- Update report_debt_policies_for_clients to exclude broker-related policies
CREATE OR REPLACE FUNCTION public.report_debt_policies_for_clients(p_client_ids uuid[])
RETURNS TABLE(
  client_id uuid,
  policy_id uuid,
  policy_number text,
  insurance_price numeric,
  paid numeric,
  remaining numeric,
  end_date date,
  days_until_expiry integer,
  status text,
  policy_type_parent text,
  policy_type_child text,
  car_number text,
  group_id uuid
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
SELECT
  p.client_id,
  p.id AS policy_id,
  p.policy_number,
  p.insurance_price::numeric AS insurance_price,
  COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0)::numeric AS paid,
  (p.insurance_price - COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0))::numeric AS remaining,
  p.end_date::date AS end_date,
  (p.end_date::date - CURRENT_DATE)::int AS days_until_expiry,
  CASE
    WHEN p.end_date::date < CURRENT_DATE THEN 'expired'
    WHEN (p.end_date::date - CURRENT_DATE) <= 30 THEN 'expiring_soon'
    ELSE 'active'
  END AS status,
  p.policy_type_parent::text AS policy_type_parent,
  p.policy_type_child::text AS policy_type_child,
  car.car_number,
  p.group_id
FROM public.policies p
JOIN public.clients c ON c.id = p.client_id
LEFT JOIN public.cars car ON car.id = p.car_id
LEFT JOIN public.policy_payments pp ON pp.policy_id = p.id
WHERE p.cancelled = false
  AND p.deleted_at IS NULL
  AND p.policy_type_parent <> 'ELZAMI'
  -- استثناء الوثائق المرتبطة بوسيط
  AND p.broker_id IS NULL
  AND p.client_id = ANY (p_client_ids)
  AND public.is_active_user(auth.uid())
  AND public.can_access_branch(auth.uid(), c.branch_id)
GROUP BY p.client_id, p.id, p.policy_number, p.insurance_price, p.end_date, 
         p.policy_type_parent, p.policy_type_child, car.car_number, p.group_id
HAVING (p.insurance_price - COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0)) > 0
ORDER BY p.client_id, p.end_date DESC;
$$;
