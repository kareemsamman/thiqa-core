-- Fix 1: Simplify get_company_wallet_balance
-- outstanding = -SUM(amount) for ALL posted entries
CREATE OR REPLACE FUNCTION public.get_company_wallet_balance(p_company_id uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
RETURNS TABLE(total_payable numeric, total_paid numeric, outstanding numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    -- المستحق الأصلي (قيود company_payable فقط)
    COALESCE(-SUM(CASE WHEN l.category = 'company_payable' THEN l.amount ELSE 0 END), 0) AS total_payable,
    -- المدفوع = settlement_paid + settlement_reversal
    COALESCE(SUM(CASE WHEN l.category IN ('company_settlement_paid', 'company_settlement_reversal') THEN l.amount ELSE 0 END), 0) AS total_paid,
    -- المتبقي = -SUM(الكل) بكل بساطة
    COALESCE(-SUM(l.amount), 0) AS outstanding
  FROM ab_ledger l
  WHERE l.counterparty_type = 'insurance_company'
    AND l.counterparty_id = p_company_id
    AND l.status = 'posted'
    AND (p_from_date IS NULL OR l.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR l.transaction_date <= p_to_date);
END;
$function$;

-- Fix 2: Simplify get_all_companies_wallet_summary
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
    COALESCE(-SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS total_payable,
    COALESCE(SUM(CASE WHEN l.category IN ('company_settlement_paid', 'company_settlement_reversal') AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS total_paid,
    COALESCE(-SUM(CASE WHEN l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS outstanding
  FROM public.insurance_companies ic
  LEFT JOIN public.ab_ledger l ON l.counterparty_id = ic.id AND l.counterparty_type = 'insurance_company'
  WHERE ic.active = true
  GROUP BY ic.id, ic.name, ic.name_ar
  HAVING COALESCE(-SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) > 0
  ORDER BY outstanding DESC;
END;
$function$;

-- Fix 3: Update ledger_on_company_settlement_refused
-- DON'T mark original as reversed, just add reversal entry
CREATE OR REPLACE FUNCTION public.ledger_on_company_settlement_refused()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only trigger when refused changes from false to true
  IF NEW.refused = true AND (OLD.refused IS NULL OR OLD.refused = false) THEN
    -- Create reversal entry only (don't change original to reversed)
    PERFORM insert_ledger_entry(
      'company_settlement_reversal'::ledger_reference_type,
      NEW.id,
      'insurance_company'::ledger_counterparty_type,
      NEW.company_id,
      -NEW.total_amount,  -- سالب = إلغاء الدفعة
      'company_settlement_reversal'::ledger_category,
      'عكس تسديد - دفعة مرفوضة/شيك راجع',
      NULL,
      NULL,
      NEW.branch_id,
      NULL,
      CURRENT_DATE
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Fix 4: Restore the original settlement entry that was marked reversed
UPDATE ab_ledger
SET status = 'posted'
WHERE reference_id = 'e03792f1-5416-4525-a724-c3b0c9fd6d2a'
  AND category = 'company_settlement_paid'
  AND status = 'reversed';