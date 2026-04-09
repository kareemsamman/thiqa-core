
-- Debt tracking support: summary + policies for paginated client list

CREATE OR REPLACE FUNCTION public.report_client_debts_summary(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL
)
RETURNS TABLE (
  total_clients bigint,
  total_owed numeric,
  expiring_soon bigint,
  expired bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.report_client_debts_summary(text, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.report_debt_policies_for_clients(
  p_client_ids uuid[]
)
RETURNS TABLE (
  client_id uuid,
  policy_id uuid,
  policy_number text,
  insurance_price numeric,
  paid numeric,
  remaining numeric,
  end_date date,
  days_until_expiry integer,
  status text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
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
  END AS status
FROM public.policies p
JOIN public.clients c ON c.id = p.client_id
LEFT JOIN public.policy_payments pp ON pp.policy_id = p.id
WHERE p.cancelled = false
  AND p.deleted_at IS NULL
  AND p.client_id = ANY (p_client_ids)
  AND public.is_active_user(auth.uid())
  AND public.can_access_branch(auth.uid(), c.branch_id)
GROUP BY p.client_id, p.id, p.policy_number, p.insurance_price, p.end_date
HAVING (p.insurance_price - COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0)) > 0
ORDER BY p.client_id, p.end_date DESC;
$$;

GRANT EXECUTE ON FUNCTION public.report_debt_policies_for_clients(uuid[]) TO authenticated;
