-- ============================================================
-- get_company_balances_bulk
--
-- Bulk variant of get_company_balance — returns the same three
-- aggregates (total_payable, total_paid, outstanding) but for every
-- company_id passed in, in one round-trip.
--
-- FinancialReports.fetchFinancialData was firing the per-company
-- variant in a loop (Promise.all over N companies → N concurrent
-- RPCs). With 20 active companies that's 20 network calls + 20
-- CORS preflights = 40 HTTP requests just for the per-company
-- ledger sums. Same Postgres work, just split across N statements.
-- This RPC folds the loop server-side via GROUP BY counterparty_id.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_company_balances_bulk(
  p_company_ids uuid[],
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE(
  company_id uuid,
  total_payable numeric,
  total_paid numeric,
  outstanding numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.counterparty_id AS company_id,
    COALESCE(SUM(CASE WHEN l.category = 'company_payable' THEN ABS(l.amount) ELSE 0 END), 0)::numeric AS total_payable,
    COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' THEN l.amount ELSE 0 END), 0)::numeric AS total_paid,
    (
      COALESCE(SUM(CASE WHEN l.category = 'company_payable' THEN ABS(l.amount) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' THEN l.amount ELSE 0 END), 0)
    )::numeric AS outstanding
  FROM public.ab_ledger l
  WHERE l.status = 'posted'
    AND l.counterparty_type = 'insurance_company'
    AND l.counterparty_id = ANY(p_company_ids)
    AND (p_from_date IS NULL OR l.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR l.transaction_date <= p_to_date)
  GROUP BY l.counterparty_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_balances_bulk(uuid[], date, date) TO authenticated;
