
-- Fix dashboard_total_client_debt to use the same source as debt-tracking page
CREATE OR REPLACE FUNCTION dashboard_total_client_debt()
RETURNS numeric AS $$
DECLARE v_total numeric;
BEGIN
  SELECT total_remaining INTO v_total
  FROM report_client_debts_summary(NULL::text, NULL::integer);
  RETURN COALESCE(v_total, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';

-- Create dashboard_company_debts RPC
CREATE OR REPLACE FUNCTION dashboard_company_debts()
RETURNS TABLE(company_id uuid, company_name text, outstanding numeric)
AS $$
BEGIN
  RETURN QUERY
  SELECT ic.id, COALESCE(ic.name_ar, ic.name)::text, w.outstanding
  FROM insurance_companies ic
  CROSS JOIN LATERAL get_company_wallet_balance(ic.id) w
  WHERE w.outstanding > 0
  ORDER BY w.outstanding DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';
