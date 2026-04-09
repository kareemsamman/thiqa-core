
-- تبسيط دالة get_company_wallet_balance
-- القاعدة: الرصيد = -SUM(amount) للـ posted فقط على قيود الشركة
-- company_payable سالب = مستحق للشركة، company_settlement_paid موجب = دفعنا

DROP FUNCTION IF EXISTS public.get_company_wallet_balance(uuid, date, date);

CREATE OR REPLACE FUNCTION public.get_company_wallet_balance(
  p_company_id UUID,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS TABLE (
  total_payable NUMERIC,
  total_paid NUMERIC,
  outstanding NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payable NUMERIC := 0;
  v_paid NUMERIC := 0;
  v_reversals NUMERIC := 0;
BEGIN
  -- المستحق للشركة من البوالص (قيم سالبة في الـ ledger)
  -- نجمع القيم السالبة ثم نعكسها للحصول على قيمة موجبة
  SELECT COALESCE(-SUM(amount), 0) INTO v_payable
  FROM ab_ledger
  WHERE counterparty_type = 'insurance_company'
    AND counterparty_id = p_company_id
    AND category = 'company_payable'
    AND status = 'posted'
    AND (p_from_date IS NULL OR transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR transaction_date <= p_to_date);

  -- المدفوع للشركة (قيم موجبة في الـ ledger)
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM ab_ledger
  WHERE counterparty_type = 'insurance_company'
    AND counterparty_id = p_company_id
    AND category = 'company_settlement_paid'
    AND status = 'posted'
    AND (p_from_date IS NULL OR transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR transaction_date <= p_to_date);

  -- خصم عكس المستحق (من الإلغاء) وإضافة عكس التسديد (شيك راجع)
  -- company_payable_reversal = موجب (ينقص المستحق)
  -- company_settlement_reversal = سالب (يزيد المستحق)
  SELECT COALESCE(SUM(
    CASE 
      WHEN category = 'company_payable_reversal' THEN -amount  -- موجب -> ينقص المستحق
      WHEN category = 'company_settlement_reversal' THEN amount  -- سالب -> يزيد المستحق (ينقص المدفوع)
      ELSE 0
    END
  ), 0) INTO v_reversals
  FROM ab_ledger
  WHERE counterparty_type = 'insurance_company'
    AND counterparty_id = p_company_id
    AND category IN ('company_payable_reversal', 'company_settlement_reversal')
    AND status = 'posted'
    AND (p_from_date IS NULL OR transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR transaction_date <= p_to_date);

  -- المتبقي = المستحق - عكس المستحق - المدفوع + عكس المدفوع
  RETURN QUERY SELECT 
    v_payable,
    v_paid,
    (v_payable - v_reversals - v_paid) AS outstanding;
END;
$function$;

-- تبسيط get_all_companies_wallet_summary بنفس المنطق
DROP FUNCTION IF EXISTS public.get_all_companies_wallet_summary();

CREATE OR REPLACE FUNCTION public.get_all_companies_wallet_summary()
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  company_name_ar TEXT,
  total_payable NUMERIC,
  total_paid NUMERIC,
  outstanding NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only allow active users
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
    -- المدفوع: مجموع الموجب
    COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS total_paid,
    -- المتبقي = المستحق - عكس المستحق - المدفوع + عكس المدفوع
    COALESCE(-SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN l.category = 'company_payable_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN l.category = 'company_settlement_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS outstanding
  FROM public.insurance_companies ic
  LEFT JOIN public.ab_ledger l ON l.counterparty_id = ic.id AND l.counterparty_type = 'insurance_company'
  WHERE ic.active = true
  GROUP BY ic.id, ic.name, ic.name_ar
  HAVING COALESCE(-SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) > 0
  ORDER BY outstanding DESC;
END;
$function$;

-- تبسيط get_ab_balance للتأكد من status='posted' فقط
DROP FUNCTION IF EXISTS public.get_ab_balance(date, date, uuid);

CREATE OR REPLACE FUNCTION public.get_ab_balance(
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  total_income NUMERIC,
  total_expense NUMERIC,
  net_balance NUMERIC,
  company_payables NUMERIC,
  broker_payables NUMERIC,
  broker_receivables NUMERIC,
  customer_refunds_due NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN l.amount > 0 AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN l.amount < 0 AND l.status = 'posted' THEN ABS(l.amount) ELSE 0 END), 0) AS total_expense,
    COALESCE(SUM(CASE WHEN l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS net_balance,
    -- المستحق للشركات = سالب company_payable + موجب company_payable_reversal - موجب settlement
    COALESCE(-SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN l.category = 'company_payable_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN l.category = 'company_settlement_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS company_payables,
    -- المستحق للوسطاء
    COALESCE(-SUM(CASE WHEN l.category = 'broker_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN l.category = 'broker_settlement_paid' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS broker_payables,
    -- المستحق من الوسطاء
    COALESCE(SUM(CASE WHEN l.category = 'broker_receivable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN l.category = 'broker_settlement_received' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS broker_receivables,
    -- مرتجعات العملاء
    COALESCE(-SUM(CASE WHEN l.category = 'refund_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS customer_refunds_due
  FROM public.ab_ledger l
  WHERE (p_from_date IS NULL OR l.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR l.transaction_date <= p_to_date)
    AND (p_branch_id IS NULL OR l.branch_id = p_branch_id);
END;
$function$;
