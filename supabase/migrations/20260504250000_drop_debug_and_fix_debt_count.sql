-- Drop the temporary diagnostic helper.
DROP FUNCTION IF EXISTS public._debug_renewals_diff(text);

-- Debt tracking shows policies_count = COUNT(p.id), so a 2-policy
-- package (شامل + خدمات الطريق sharing one group_id) reads as
-- "2 معاملة". Match the renewals rule: one package = one معاملة by
-- counting distinct group_id (falling back to policy id for ungrouped
-- policies).

CREATE OR REPLACE FUNCTION public.report_client_debts(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  client_id uuid, client_name text, client_phone text,
  total_insurance numeric, total_paid numeric, total_refunds numeric,
  total_remaining numeric, oldest_end_date date, days_until_oldest integer,
  policies_count integer, total_rows bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_count bigint;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(DISTINCT c.id)
  INTO v_total_count
  FROM clients c
  WHERE c.deleted_at IS NULL
    AND (v_is_sa OR c.agent_id = v_agent_id)
    AND (v_see_all OR c.branch_id IS NULL OR c.branch_id = v_my_branch)
    AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
    AND (p_search IS NULL
      OR c.full_name ILIKE '%' || p_search || '%'
      OR c.phone_number ILIKE '%' || p_search || '%'
      OR c.id_number ILIKE '%' || p_search || '%')
    AND EXISTS (SELECT 1 FROM get_client_balance(c.id) gcb WHERE gcb.total_remaining > 0);

  RETURN QUERY
  WITH client_balances AS (
    SELECT c.id AS cid, c.full_name AS cname, c.phone_number AS cphone,
      gcb.total_insurance, gcb.total_paid, gcb.total_refunds, gcb.total_remaining
    FROM clients c
    CROSS JOIN LATERAL get_client_balance(c.id) gcb
    WHERE c.deleted_at IS NULL
      AND (v_is_sa OR c.agent_id = v_agent_id)
      AND (v_see_all OR c.branch_id IS NULL OR c.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
      AND gcb.total_remaining > 0
      AND (p_search IS NULL
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%')
  ),
  policy_dates AS (
    SELECT cb.cid, MIN(p.end_date)::date AS oldest_end,
      COUNT(DISTINCT COALESCE(p.group_id::text, p.id::text))::integer AS pol_count
    FROM client_balances cb
    JOIN policies p ON p.client_id = cb.cid
    WHERE COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    GROUP BY cb.cid
  ),
  combined AS (
    SELECT cb.cid, cb.cname, cb.cphone, cb.total_insurance, cb.total_paid,
      cb.total_refunds, cb.total_remaining, pd.oldest_end, pd.pol_count
    FROM client_balances cb
    LEFT JOIN policy_dates pd ON pd.cid = cb.cid
    WHERE (p_filter_days IS NULL
      OR pd.oldest_end IS NULL
      OR pd.oldest_end <= CURRENT_DATE + p_filter_days)
  )
  SELECT c.cid, c.cname, c.cphone, c.total_insurance, c.total_paid,
    c.total_refunds, c.total_remaining, c.oldest_end,
    CASE WHEN c.oldest_end IS NULL THEN NULL
      ELSE (c.oldest_end - CURRENT_DATE)::integer END,
    COALESCE(c.pol_count, 0), v_total_count
  FROM combined c
  ORDER BY c.total_remaining DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_client_debts(text, integer, integer, integer, uuid) TO authenticated;
