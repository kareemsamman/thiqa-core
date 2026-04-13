-- Fix phantom customer debt coming from office_commission on non-ELZAMI
-- policies. The UI (Step3PolicyDetails + PolicyEditDrawer) only exposes
-- the "عمولة للمكتب" input when policy_type_parent = 'ELZAMI', because
-- that's the only flow where the office commission is a charge the
-- customer owes on top of the insurance price. For every other policy
-- type the column is a legacy/unused field that should NEVER be part
-- of the client balance.
--
-- The previous get_client_balance summed insurance_price + office_commission
-- unconditionally, so any non-ELZAMI policy with a non-zero
-- office_commission (seen on imported / edited rows) produced a permanent
-- phantom remaining balance even after the customer had paid the full
-- insurance_price. Example from prod: أسامة حسام, policy 2650, paid 2650,
-- office_commission 250, balance showed 250.
--
-- Fix: wrap the office_commission addition in a CASE that only applies
-- when policy_type_parent = 'ELZAMI'. This is a single-function change
-- that flows through report_client_debts, report_client_debts_summary,
-- and any other caller of get_client_balance.

CREATE OR REPLACE FUNCTION public.get_client_balance(p_client_id uuid)
 RETURNS TABLE(total_insurance numeric, total_paid numeric, total_refunds numeric, total_remaining numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH
  active_policies AS (
    SELECT p.id,
           COALESCE(p.insurance_price, 0) AS insurance_price,
           CASE
             WHEN p.policy_type_parent = 'ELZAMI'
             THEN COALESCE(p.office_commission, 0)
             ELSE 0
           END AS office_commission
    FROM policies p
    WHERE p.client_id = p_client_id
      AND COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
  ),
  policy_totals AS (
    SELECT COALESCE(SUM(insurance_price + office_commission), 0) AS total_ins
    FROM active_policies
  ),
  payment_totals AS (
    SELECT COALESCE(SUM(pp.amount), 0) AS total_pay
    FROM policy_payments pp
    JOIN active_policies ap ON ap.id = pp.policy_id
    WHERE COALESCE(pp.refused, FALSE) = FALSE
  ),
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
