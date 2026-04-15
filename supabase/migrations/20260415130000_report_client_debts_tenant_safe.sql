-- Security: scope report_client_debts to the caller's agent.
--
-- Background: report_client_debts is SECURITY DEFINER and was last
-- rewritten without any tenant filter, so a call from agent A would
-- return every agent's unpaid clients. send-bulk-debt-sms iterates
-- that list and fires an SMS at every returned phone number, so one
-- agent could (accidentally or otherwise) blast SMS to customers of
-- another agent.
--
-- Fix mirrors the 20260308121557 patch that scoped
-- report_client_debts_summary: look up the caller's agent via
-- get_user_agent_id, bail early for users that aren't attached to an
-- agent, and add `c.agent_id = v_agent_id` filters in every CTE that
-- touches `clients` / `policies`. Super admins keep the global view.

CREATE OR REPLACE FUNCTION public.report_client_debts(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_phone text,
  total_insurance numeric,
  total_paid numeric,
  total_refunds numeric,
  total_remaining numeric,
  oldest_end_date date,
  days_until_oldest integer,
  policies_count integer,
  total_rows bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_count bigint;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
BEGIN
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT c.id)
  INTO v_total_count
  FROM clients c
  WHERE c.deleted_at IS NULL
    AND (v_is_sa OR c.agent_id = v_agent_id)
    AND (
      p_search IS NULL
      OR c.full_name ILIKE '%' || p_search || '%'
      OR c.phone_number ILIKE '%' || p_search || '%'
      OR c.id_number ILIKE '%' || p_search || '%'
    )
    AND EXISTS (
      SELECT 1 FROM get_client_balance(c.id) gcb WHERE gcb.total_remaining > 0
    );

  RETURN QUERY
  WITH client_balances AS (
    SELECT
      c.id AS cid,
      c.full_name AS cname,
      c.phone_number AS cphone,
      gcb.total_insurance,
      gcb.total_paid,
      gcb.total_refunds,
      gcb.total_remaining
    FROM clients c
    CROSS JOIN LATERAL get_client_balance(c.id) gcb
    WHERE c.deleted_at IS NULL
      AND (v_is_sa OR c.agent_id = v_agent_id)
      AND gcb.total_remaining > 0
      AND (
        p_search IS NULL
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
      )
  ),
  policy_dates AS (
    SELECT
      cb.cid,
      MIN(p.end_date)::date AS oldest_end,
      COUNT(p.id)::integer AS pol_count
    FROM client_balances cb
    JOIN policies p ON p.client_id = cb.cid
    WHERE COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
    GROUP BY cb.cid
  ),
  combined AS (
    SELECT
      cb.cid,
      cb.cname,
      cb.cphone,
      cb.total_insurance,
      cb.total_paid,
      cb.total_refunds,
      cb.total_remaining,
      pd.oldest_end,
      pd.pol_count
    FROM client_balances cb
    LEFT JOIN policy_dates pd ON pd.cid = cb.cid
    WHERE (
      p_filter_days IS NULL
      OR pd.oldest_end IS NULL
      OR pd.oldest_end <= CURRENT_DATE + p_filter_days
    )
  )
  SELECT
    c.cid,
    c.cname,
    c.cphone,
    c.total_insurance,
    c.total_paid,
    c.total_refunds,
    c.total_remaining,
    c.oldest_end,
    CASE
      WHEN c.oldest_end IS NULL THEN NULL
      ELSE (c.oldest_end - CURRENT_DATE)::integer
    END,
    COALESCE(c.pol_count, 0),
    v_total_count
  FROM combined c
  ORDER BY c.total_remaining DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
