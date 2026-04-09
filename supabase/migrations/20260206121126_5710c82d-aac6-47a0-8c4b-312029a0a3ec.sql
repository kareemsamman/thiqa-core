-- =====================================================
-- UNIFIED CUSTOMER BALANCE SYSTEM
-- Single source of truth for "إجمالي المتبقي"
-- =====================================================

-- 1. Create get_client_balance RPC
-- This is the AUTHORITATIVE source for customer balance
CREATE OR REPLACE FUNCTION get_client_balance(p_client_id uuid)
RETURNS TABLE(
  total_insurance numeric,
  total_paid numeric,
  total_refunds numeric,
  total_remaining numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH 
  -- All active policies (INCLUDING ELZAMI, EXCLUDING broker deals)
  active_policies AS (
    SELECT p.id, COALESCE(p.insurance_price, 0) AS insurance_price
    FROM policies p
    WHERE p.client_id = p_client_id
      AND COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL  -- Exclude broker deals
  ),
  -- Sum of all policy prices
  policy_totals AS (
    SELECT COALESCE(SUM(insurance_price), 0) AS total_ins
    FROM active_policies
  ),
  -- All non-refused payments for these policies
  payment_totals AS (
    SELECT COALESCE(SUM(pp.amount), 0) AS total_pay
    FROM policy_payments pp
    JOIN active_policies ap ON ap.id = pp.policy_id
    WHERE COALESCE(pp.refused, FALSE) = FALSE
  ),
  -- Wallet transactions (refunds reduce debt)
  wallet_totals AS (
    SELECT COALESCE(SUM(
      CASE 
        WHEN transaction_type IN ('refund', 'transfer_refund_owed', 'manual_refund') 
        THEN amount
        WHEN transaction_type = 'transfer_adjustment_due' 
        THEN -amount
        ELSE 0 
      END
    ), 0) AS total_ref
    FROM customer_wallet_transactions
    WHERE client_id = p_client_id
  )
  SELECT
    pt.total_ins::numeric AS total_insurance,
    pay.total_pay::numeric AS total_paid,
    wt.total_ref::numeric AS total_refunds,
    GREATEST(0, pt.total_ins - pay.total_pay - wt.total_ref)::numeric AS total_remaining
  FROM policy_totals pt
  CROSS JOIN payment_totals pay
  CROSS JOIN wallet_totals wt;
END;
$$;

-- 2. Drop existing report_client_debts functions (all overloads)
DROP FUNCTION IF EXISTS report_client_debts(text, integer, integer, integer);
DROP FUNCTION IF EXISTS report_client_debts_summary(text, integer);

-- 3. Recreate report_client_debts using unified balance logic
CREATE OR REPLACE FUNCTION report_client_debts(
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
BEGIN
  -- Calculate total count for pagination
  SELECT COUNT(DISTINCT c.id)
  INTO v_total_count
  FROM clients c
  WHERE c.deleted_at IS NULL
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

-- 4. Recreate summary function
CREATE OR REPLACE FUNCTION report_client_debts_summary(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL
)
RETURNS TABLE(
  total_clients bigint,
  total_remaining numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH client_balances AS (
    SELECT 
      c.id AS cid,
      gcb.total_remaining
    FROM clients c
    CROSS JOIN LATERAL get_client_balance(c.id) gcb
    WHERE c.deleted_at IS NULL
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
      MIN(p.end_date)::date AS oldest_end
    FROM client_balances cb
    JOIN policies p ON p.client_id = cb.cid
    WHERE COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY cb.cid
  ),
  filtered AS (
    SELECT cb.cid, cb.total_remaining
    FROM client_balances cb
    LEFT JOIN policy_dates pd ON pd.cid = cb.cid
    WHERE (
      p_filter_days IS NULL 
      OR pd.oldest_end IS NULL 
      OR pd.oldest_end <= CURRENT_DATE + p_filter_days
    )
  )
  SELECT 
    COUNT(DISTINCT f.cid)::bigint,
    COALESCE(SUM(f.total_remaining), 0)::numeric
  FROM filtered f;
END;
$$;