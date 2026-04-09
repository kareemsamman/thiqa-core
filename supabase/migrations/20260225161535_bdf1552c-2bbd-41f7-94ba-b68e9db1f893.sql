CREATE OR REPLACE FUNCTION dashboard_company_debts()
RETURNS TABLE(company_id uuid, company_name text, outstanding numeric) AS $$
BEGIN
  RETURN QUERY
  SELECT ic.id, COALESCE(ic.name_ar, ic.name)::text, w.outstanding
  FROM insurance_companies ic
  CROSS JOIN LATERAL get_company_wallet_balance(ic.id, '2026-01-01'::date) w
  WHERE w.outstanding > 0
  ORDER BY w.outstanding DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';