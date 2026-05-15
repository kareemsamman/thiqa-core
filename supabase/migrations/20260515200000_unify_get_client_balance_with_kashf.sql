-- ────────────────────────────────────────────────────────────────
-- get_client_balance — full alignment with the kashf (الكشف).
--
-- Per the user: every surface that quotes a customer's debt MUST
-- match the printed كشف. Up to now three slightly different formulas
-- coexisted:
--
--   1. Kashf (generate-customer-statement):
--        billed   = office_claim + transfer_customer_pays + debit_notes
--        credits  = paid + credit_notes + transfer_office_pays
--        remaining = max(0, billed − credits)
--      Cancelled policies STAY at full price (per "إلغاء المعاملة ≠
--      إلغاء الدين"); only an explicit إشعار دائن / سند صرف refund
--      reduces the balance. ELZAMI base is paid directly to the
--      insurance company (external Visa) — only the office_commission
--      enters the books.
--
--   2. ClientDetails tile + DebtPaymentModal cap (just rewritten):
--      same formula as #1.
--
--   3. get_client_balance (this RPC, used by /debt-tracking and
--      report_client_debts): pre-rewrite formula was different —
--      excluded cancelled policies, summed ELZAMI insurance_price,
--      pulled refunds from the wallet (which double-counts when the
--      wallet 'refund' row pairs with a 'credit_note' receipt), no
--      transfer-fee handling.
--
-- This migration brings #3 in line with #1 and #2 so /debt-tracking
-- and the customer page show the same number for the same person.
--
-- Behavioural impacts vs. the old RPC:
--   • Cancelled policies now contribute their full office_claim until
--     a refund voucher (credit_note / disbursement) is issued. Per
--     the user's rule this is correct; previously they silently
--     dropped out, hiding the debt.
--   • ELZAMI insurance_price no longer enters the debt total; only
--     office_commission does. Most ELZAMI policies have commission=0
--     so they fall out entirely (the customer paid the company, not
--     us). Customers with very old data may see their debt drop.
--   • Transfer adjustments (تكلفة التحويل) are now reflected:
--     customer_pays adds, office_pays subtracts.
--   • debit_note ADDS to the debt (إشعار مدين charged extra to the
--     customer); credit_note SUBTRACTS (we owed him a refund).
--   • Disbursements stay independent — per the user's "each voucher
--     is independent" rule, a سند صرف doesn't auto-settle a paired
--     credit_note. It's tracked separately.
--   • Per-group payment clamping is removed. The kashf doesn't clamp,
--     and an overpayment on one package now offsets debt elsewhere.
--     Same behaviour as the kashf's all-time overall balance.
--
-- Risk: a few customers may see different totals than before. Per
-- user direction: "حتى لو خطر بس لازم نصلح هاي المشكلة". The numbers
-- they'll now see match the printed kashf — which is what they
-- already trust.
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
  -- Insurance side: every non-broker, non-destination policy at its
  -- office_claim. ELZAMI base price excluded (paid directly to the
  -- insurance company); only commission enters. Cancelled stays.
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
  -- Transfer adjustments — customer_pays ADDS to debt, office_pays
  -- SUBTRACTS. Pulled across every policy the customer is a party
  -- to (source side filtered to non-deleted).
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
  -- Receipts: credit_note SUBTRACTS, debit_note ADDS, disbursement
  -- stays independent (matches kashf's "each voucher is independent"
  -- rule). Cancelled receipts excluded.
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
  -- Payments: every non-refused row, excluding ELZAMI passthrough
  -- (visa_external on a no-commission ELZAMI is the customer paying
  -- the insurance company directly; never enters our books).
  -- Includes payments mirrored to transfer destinations so the
  -- customer's total paid stays accurate after a transfer.
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
        AND COALESCE(p.office_commission, 0) <= 0
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

COMMENT ON FUNCTION public.get_client_balance(uuid) IS
  'Per-client outstanding balance — kashf-aligned formula. billed (policy office_claim + transfer_customer_pays + debit_notes) − credits (paid + credit_notes + transfer_office_pays). Used by report_client_debts and the legacy debt summaries; ClientDetails / DebtPaymentModal compute the same in TS.';
