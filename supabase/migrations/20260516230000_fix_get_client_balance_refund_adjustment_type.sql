-- ────────────────────────────────────────────────────────────────
-- get_client_balance — fix the adjustment_type literal mismatch.
--
-- The bug: the RPC's office_pays branch filtered on
-- `pt.adjustment_type = 'office_pays'`, but the actual value the UI
-- writes for the "office owes the customer" case is `'refund'` (see
-- TransferPolicyModal.tsx — adjustmentType state is one of
-- 'none' | 'customer_pays' | 'refund', and it's stored verbatim).
-- The original schema comment in 20251230201844_…sql:10 already
-- spelled this out: `-- 'none', 'customer_pays', 'refund'`. No
-- migration ever renamed 'refund' → 'office_pays', so every
-- office-pays transfer row in production silently fell out of the
-- balance calc.
--
-- Observed symptom: customer's year summary correctly subtracted a
-- 170 ₪ تكلفة تحويل but both the إجمالي المتبقي tile and the
-- footnote (which now also reads this RPC) showed the un-subtracted
-- number. The year summary is correct because it uses a binary
-- check `adjustment_type === 'customer_pays' ? add : subtract` —
-- anything not 'customer_pays' (including 'refund' AND 'none')
-- counts as office credit. The 'none' rows have NULL
-- adjustment_amount so they contribute 0, no harm.
--
-- Fix: accept BOTH legacy 'refund' and the newer 'office_pays'
-- literal on the office-pays branch. Adding 'office_pays' keeps the
-- migration forward-compatible if any code path is updated to write
-- the new name later — costs nothing if no such rows exist.
--
-- Mirrors the same fix that needs to land on:
--   • src/components/policies/wizard/usePolicyWizardState.ts:492
--     (also filters on 'office_pays' only — handled in a separate
--     TS commit so the SQL fix can ship independently.)
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
        CASE WHEN pt.adjustment_type IN ('refund', 'office_pays')
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
