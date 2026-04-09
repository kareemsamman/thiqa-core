-- Fix get_company_wallet_balance function
-- company_settlement_reversal is negative, we should ADD it (which effectively subtracts from paid)
CREATE OR REPLACE FUNCTION public.get_company_wallet_balance(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
RETURNS TABLE(total_payable numeric, total_paid numeric, outstanding numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payable NUMERIC := 0;
  v_paid NUMERIC := 0;
  v_payable_reversal NUMERIC := 0;
  v_settlement_reversal NUMERIC := 0;
BEGIN
  -- المستحق للشركة من البوالص (قيم سالبة)
  SELECT COALESCE(-SUM(amount), 0) INTO v_payable
  FROM ab_ledger
  WHERE counterparty_type = 'insurance_company'
    AND counterparty_id = p_company_id
    AND category = 'company_payable'
    AND status = 'posted'
    AND (p_from_date IS NULL OR transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR transaction_date <= p_to_date);

  -- المدفوع للشركة (قيم موجبة)
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM ab_ledger
  WHERE counterparty_type = 'insurance_company'
    AND counterparty_id = p_company_id
    AND category = 'company_settlement_paid'
    AND status = 'posted'
    AND (p_from_date IS NULL OR transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR transaction_date <= p_to_date);

  -- عكس المستحق من الإلغاء (قيم موجبة - تنقص المستحق)
  SELECT COALESCE(SUM(amount), 0) INTO v_payable_reversal
  FROM ab_ledger
  WHERE counterparty_type = 'insurance_company'
    AND counterparty_id = p_company_id
    AND category = 'company_payable_reversal'
    AND status = 'posted'
    AND (p_from_date IS NULL OR transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR transaction_date <= p_to_date);

  -- عكس التسديد من الرفض (قيم سالبة - تنقص المدفوع)
  SELECT COALESCE(SUM(amount), 0) INTO v_settlement_reversal
  FROM ab_ledger
  WHERE counterparty_type = 'insurance_company'
    AND counterparty_id = p_company_id
    AND category = 'company_settlement_reversal'
    AND status = 'posted'
    AND (p_from_date IS NULL OR transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR transaction_date <= p_to_date);

  -- المتبقي = (المستحق - عكس المستحق) - (المدفوع + عكس المدفوع)
  -- v_payable_reversal موجب ينقص المستحق
  -- v_settlement_reversal سالب ينقص المدفوع (نضيفه لأنه سالب)
  RETURN QUERY SELECT 
    v_payable,
    v_paid + v_settlement_reversal,  -- المدفوع الفعلي بعد خصم الرفض
    (v_payable - v_payable_reversal) - (v_paid + v_settlement_reversal) AS outstanding;
END;
$function$;

-- Fix get_all_companies_wallet_summary function
CREATE OR REPLACE FUNCTION public.get_all_companies_wallet_summary()
RETURNS TABLE(company_id uuid, company_name text, company_name_ar text, total_payable numeric, total_paid numeric, outstanding numeric)
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
    -- المستحق: مجموع السالب معكوس
    COALESCE(-SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS total_payable,
    -- المدفوع: مجموع الموجب + عكس التسديد (سالب)
    COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    + COALESCE(SUM(CASE WHEN l.category = 'company_settlement_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS total_paid,
    -- المتبقي = (المستحق - عكس المستحق) - (المدفوع + عكس المدفوع)
    (COALESCE(-SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
     - COALESCE(SUM(CASE WHEN l.category = 'company_payable_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0))
    - (COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
     + COALESCE(SUM(CASE WHEN l.category = 'company_settlement_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)) AS outstanding
  FROM public.insurance_companies ic
  LEFT JOIN public.ab_ledger l ON l.counterparty_id = ic.id AND l.counterparty_type = 'insurance_company'
  WHERE ic.active = true
  GROUP BY ic.id, ic.name, ic.name_ar
  HAVING COALESCE(-SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) > 0
  ORDER BY outstanding DESC;
END;
$function$;