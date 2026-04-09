-- Update get_client_balance to include office_commission in debt calculation
CREATE OR REPLACE FUNCTION public.get_client_balance(p_client_id uuid)
 RETURNS TABLE(total_insurance numeric, total_paid numeric, total_refunds numeric, total_remaining numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH 
  -- All active policies (INCLUDING ELZAMI, EXCLUDING broker deals)
  active_policies AS (
    SELECT p.id, 
           COALESCE(p.insurance_price, 0) AS insurance_price,
           COALESCE(p.office_commission, 0) AS office_commission
    FROM policies p
    WHERE p.client_id = p_client_id
      AND COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
  ),
  -- Sum of all policy prices + office commissions
  policy_totals AS (
    SELECT COALESCE(SUM(insurance_price + office_commission), 0) AS total_ins
    FROM active_policies
  ),
  -- All non-refused payments for these policies (from policy_payments - the correct source)
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
$function$;