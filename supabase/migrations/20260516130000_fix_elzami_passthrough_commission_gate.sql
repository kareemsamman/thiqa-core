-- ────────────────────────────────────────────────────────────────
-- get_client_balance — drop the office_commission gate on the
-- ELZAMI pass-through filter.
--
-- The previous filter excluded visa_external payments only when the
-- linked ELZAMI policy had office_commission <= 0. That meant any
-- ELZAMI with a positive commission (the normal case) leaked its
-- ₪{insurance_price} visa_external receipt into the customer's
-- "total_paid", artificially shrinking the outstanding balance.
--
-- The matching debit is already excluded by the policy_owed CTE
-- (which counts only office_commission for ELZAMI), so the leaked
-- credit never had a counterpart. The fix: drop the commission gate.
-- Any visa_external on an ELZAMI policy is the customer paying the
-- insurance company directly — it never enters the office's books,
-- regardless of whether there's also a commission on the row.
--
-- Mirrors the same fix applied to:
--   • supabase/functions/generate-customer-statement/index.ts
--   • src/components/clients/ClientDetails.tsx
--   • src/components/debt/DebtPaymentModal.tsx
--   • src/components/policies/wizard/usePolicyWizardState.ts
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_client_balance(p_client_id uuid)
 RETURNS TABLE(total_insurance numeric, total_paid numeric, total_refunds numeric, total_remaining numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH
  policy_owed AS (
    SELECT COALESCE(SUM(
      CASE
        WHEN p.policy_type_parent = 'ELZAMI'
        THEN COALESCE(p.office_commission, 0)
        ELSE COALESCE(p.insurance_price, 0) + COALESCE(p.office_commission, 0)
      END
    ), 0) AS amount
    FROM policies p
    WHERE p.client_id = p_client_id
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
      AND p.transferred_from_policy_id IS NULL
  ),
  transfer_adjustments AS (
    SELECT
      COALESCE(SUM(
        CASE WHEN pt.adjustment_type = 'customer_pays'
        THEN COALESCE(pt.adjustment_amount, 0) ELSE 0 END
      ), 0) AS customer_pays,
      COALESCE(SUM(
        CASE WHEN pt.adjustment_type = 'office_pays'
        THEN COALESCE(pt.adjustment_amount, 0) ELSE 0 END
      ), 0) AS office_pays
    FROM policy_transfers pt
    WHERE pt.policy_id IN (
      SELECT id FROM policies WHERE client_id = p_client_id AND deleted_at IS NULL
    )
  ),
  receipt_totals AS (
    SELECT
      COALESCE(SUM(
        CASE WHEN r.receipt_type = 'credit_note'
        THEN ABS(COALESCE(r.amount, 0)) ELSE 0 END
      ), 0) AS credit_notes,
      COALESCE(SUM(
        CASE WHEN r.receipt_type = 'debit_note'
        THEN ABS(COALESCE(r.amount, 0)) ELSE 0 END
      ), 0) AS debit_notes
    FROM receipts r
    WHERE r.client_id = p_client_id
      AND r.cancelled_at IS NULL
  ),
  payment_total AS (
    SELECT COALESCE(SUM(pp.amount), 0) AS amount
    FROM policy_payments pp
    JOIN policies p ON p.id = pp.policy_id
    WHERE p.client_id = p_client_id
      AND p.deleted_at IS NULL
      AND COALESCE(pp.refused, FALSE) = FALSE
      AND NOT (
        pp.payment_type = 'visa_external'
        AND p.policy_type_parent = 'ELZAMI'
      )
  )
  SELECT
    (po.amount + ta.customer_pays + rt.debit_notes)::numeric AS total_insurance,
    pt.amount::numeric AS total_paid,
    (rt.credit_notes + ta.office_pays)::numeric AS total_refunds,
    GREATEST(0,
      po.amount + ta.customer_pays + rt.debit_notes
      - pt.amount - rt.credit_notes - ta.office_pays
    )::numeric AS total_remaining
  FROM policy_owed po
  CROSS JOIN transfer_adjustments ta
  CROSS JOIN receipt_totals rt
  CROSS JOIN payment_total pt;
END;
$function$;
