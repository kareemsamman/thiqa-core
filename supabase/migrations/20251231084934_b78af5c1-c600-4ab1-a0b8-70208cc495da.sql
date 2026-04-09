-- Drop and recreate functions with new return type
DROP FUNCTION IF EXISTS public.get_company_wallet_balance(uuid, date, date);
DROP FUNCTION IF EXISTS public.get_all_companies_wallet_summary();

-- Recreate get_company_wallet_balance with elzami_costs
CREATE FUNCTION public.get_company_wallet_balance(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
RETURNS TABLE(total_payable numeric, total_paid numeric, outstanding numeric, elzami_costs numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(-SUM(CASE WHEN l.category = 'company_payable' THEN l.amount ELSE 0 END), 0) AS total_payable,
    COALESCE(SUM(CASE WHEN l.category IN ('company_settlement_paid', 'company_settlement_reversal') THEN l.amount ELSE 0 END), 0) AS total_paid,
    COALESCE(-SUM(CASE WHEN l.category IN ('company_payable', 'company_payable_reversal', 'company_settlement_paid', 'company_settlement_reversal') THEN l.amount ELSE 0 END), 0) AS outstanding,
    COALESCE(-SUM(CASE WHEN l.category = 'commission_expense' THEN l.amount ELSE 0 END), 0) AS elzami_costs
  FROM ab_ledger l
  WHERE l.counterparty_type = 'insurance_company'
    AND l.counterparty_id = p_company_id
    AND l.status = 'posted'
    AND (p_from_date IS NULL OR l.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR l.transaction_date <= p_to_date);
END;
$function$;

-- Recreate get_all_companies_wallet_summary with elzami_costs
CREATE FUNCTION public.get_all_companies_wallet_summary()
RETURNS TABLE(company_id uuid, company_name text, company_name_ar text, total_payable numeric, total_paid numeric, outstanding numeric, elzami_costs numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    ic.id AS company_id,
    ic.name AS company_name,
    ic.name_ar AS company_name_ar,
    COALESCE(-SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS total_payable,
    COALESCE(SUM(CASE WHEN l.category IN ('company_settlement_paid', 'company_settlement_reversal') AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS total_paid,
    COALESCE(-SUM(CASE WHEN l.category IN ('company_payable', 'company_payable_reversal', 'company_settlement_paid', 'company_settlement_reversal') AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS outstanding,
    COALESCE(-SUM(CASE WHEN l.category = 'commission_expense' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS elzami_costs
  FROM public.insurance_companies ic
  LEFT JOIN public.ab_ledger l ON l.counterparty_id = ic.id AND l.counterparty_type = 'insurance_company'
  WHERE ic.active = true
  GROUP BY ic.id, ic.name, ic.name_ar
  HAVING COALESCE(-SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) > 0
  ORDER BY outstanding DESC;
END;
$function$;