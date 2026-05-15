-- ============================================================
-- إشعار مدين (Debit Note) — schema + allocator + math wiring
--
-- The exact mirror of إشعار دائن (credit_note), but in the opposite
-- direction: the office records that the OTHER PARTY owes money to
-- the office. Per the user's model: "بدنا نحكي الجهة المقابله احنا
-- كوكيل بدنا منوا مصاري". Used for late fees, admin charges,
-- accident bills, miscellaneous service charges.
--
-- Per-party semantics (all live as receipt_type='debit_note' rows):
--   • client_id set  → customer owes the office X (ADDS to debt)
--   • company_id set → company owes the office X
--                      (REDUCES المستحق للشركة, can flip to credit)
--   • broker_id set  → broker owes the office X (ADDS to broker.owesUs)
--
-- Voucher numbering: M{nn}/{year} (M = مدين), parallel to:
--   R for payment / cancellation, C for credit_note, D for disbursement.
--
-- Wallet integration: customer-side debit notes also write a
-- customer_wallet_transactions row of type 'manual_debit' so the
-- wallet-net helpers (DebtPaymentModal, get_client_balance) reflect
-- the new debt without rewriting their query shape — same pattern
-- credit notes use with 'manual_refund'.
--
-- Out of scope for v1 (per user):
--   • cancellation flow (frozen-once-issued)
--   • UI hooks outside the receipts page
-- ============================================================

-- ── 1. Extend receipts.receipt_type CHECK ───────────────────────────
ALTER TABLE public.receipts
  DROP CONSTRAINT IF EXISTS receipts_receipt_type_check;
ALTER TABLE public.receipts
  ADD CONSTRAINT receipts_receipt_type_check
    CHECK (receipt_type IN (
      'payment',
      'accident_fee',
      'cancellation',
      'credit_note',
      'disbursement',
      'debit_note'
    ));

-- ── 2. Extend document_sequences.kind CHECK ────────────────────────
ALTER TABLE public.document_sequences
  DROP CONSTRAINT IF EXISTS document_sequences_kind_check;
ALTER TABLE public.document_sequences
  ADD CONSTRAINT document_sequences_kind_check
    CHECK (kind IN ('policy', 'receipt', 'credit_note', 'disbursement', 'debit_note'));

-- ── 3. Extend allocate_document_number whitelist ───────────────────
-- CREATE OR REPLACE preserves existing GRANTs and SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.allocate_document_number(
  p_agent_id uuid,
  p_kind text,
  p_year int
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next int;
BEGIN
  IF p_kind NOT IN ('policy', 'receipt', 'credit_note', 'disbursement', 'debit_note') THEN
    RAISE EXCEPTION 'invalid document kind: %', p_kind;
  END IF;

  INSERT INTO public.document_sequences (agent_id, kind, year, next_value)
  VALUES (p_agent_id, p_kind, p_year, 1)
  ON CONFLICT (agent_id, kind, year) DO NOTHING;

  UPDATE public.document_sequences
     SET next_value = next_value + 1,
         updated_at = now()
   WHERE agent_id = p_agent_id
     AND kind = p_kind
     AND year = p_year
  RETURNING next_value - 1 INTO v_next;

  RETURN v_next;
END;
$$;

-- ── 4. Debit-note number allocator (M-prefix) ─────────────────────
-- Mirrors allocate_credit_note_number / allocate_disbursement_number.
-- Format: 'M07/2026', 'M142/2026' — 2-digit zero-pad below 10, then
-- pass-through for 10+ to avoid the lpad-truncation issue from the
-- 20260512100000 fix.
CREATE OR REPLACE FUNCTION public.allocate_debit_note_number(p_agent_id uuid, p_year int)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq int;
BEGIN
  IF p_agent_id IS NULL THEN
    RAISE EXCEPTION 'agent_id is required';
  END IF;
  v_seq := public.allocate_document_number(p_agent_id, 'debit_note', p_year);
  RETURN 'M' ||
    CASE WHEN v_seq < 10 THEN '0' || v_seq::text ELSE v_seq::text END
    || '/' || p_year::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_debit_note_number(uuid, int) TO authenticated, service_role;

-- ── 5. get_client_balance — net manual_debit on customerOwes side ──
-- The wallet_totals CASE used to count refund-family entries as
-- weOwe (+amount) and transfer_adjustment_due as customerOwes
-- (−amount). manual_debit joins the customerOwes side with the same
-- minus sign so a debit note pushes total_remaining UP without
-- changing the function's return shape. This means the legacy debt
-- list (Debt Tracking page) reflects manual debits the same way the
-- kashf will.
CREATE OR REPLACE FUNCTION public.get_client_balance(p_client_id uuid)
 RETURNS TABLE(total_insurance numeric, total_paid numeric, total_refunds numeric, total_remaining numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH
  active_groups AS (
    SELECT DISTINCT p.group_id
    FROM policies p
    WHERE p.client_id = p_client_id
      AND p.group_id IS NOT NULL
      AND COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
  ),
  group_balances AS (
    SELECT
      ag.group_id,
      (
        SELECT COALESCE(SUM(
          COALESCE(po.insurance_price, 0) + COALESCE(po.office_commission, 0)
        ), 0)
        FROM policies po
        WHERE po.group_id = ag.group_id
          AND po.client_id = p_client_id
          AND po.broker_id IS NULL
          AND COALESCE(po.cancelled, FALSE) = FALSE
          AND COALESCE(po.transferred, FALSE) = FALSE
          AND po.deleted_at IS NULL
      ) AS group_owed,
      (
        SELECT COALESCE(SUM(pp.amount), 0)
        FROM policy_payments pp
        JOIN policies pg ON pg.id = pp.policy_id
        WHERE pg.group_id = ag.group_id
          AND pg.client_id = p_client_id
          AND COALESCE(pg.cancelled, FALSE) = FALSE
          AND COALESCE(pg.transferred, FALSE) = FALSE
          AND pg.deleted_at IS NULL
          AND COALESCE(pp.refused, FALSE) = FALSE
      ) AS group_paid
    FROM active_groups ag
  ),
  single_policies AS (
    SELECT
      p.id,
      COALESCE(p.insurance_price, 0) + COALESCE(p.office_commission, 0) AS owed,
      (
        SELECT COALESCE(SUM(pp.amount), 0)
        FROM policy_payments pp
        WHERE pp.policy_id = p.id
          AND COALESCE(pp.refused, FALSE) = FALSE
      ) AS paid
    FROM policies p
    WHERE p.client_id = p_client_id
      AND p.group_id IS NULL
      AND p.broker_id IS NULL
      AND COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
  ),
  totals AS (
    SELECT
      COALESCE((SELECT SUM(group_owed) FROM group_balances), 0) +
      COALESCE((SELECT SUM(owed)       FROM single_policies), 0) AS total_ins,
      COALESCE((SELECT SUM(LEAST(group_paid, group_owed)) FROM group_balances), 0) +
      COALESCE((SELECT SUM(paid) FROM single_policies), 0) AS total_pay
  ),
  wallet_totals AS (
    SELECT COALESCE(SUM(
      CASE
        WHEN transaction_type IN ('refund', 'transfer_refund_owed', 'manual_refund')
        THEN amount
        WHEN transaction_type IN ('transfer_adjustment_due', 'manual_debit')
        THEN -amount
        ELSE 0
      END
    ), 0) AS total_ref
    FROM customer_wallet_transactions
    WHERE client_id = p_client_id
  )
  SELECT
    t.total_ins::numeric AS total_insurance,
    t.total_pay::numeric AS total_paid,
    wt.total_ref::numeric AS total_refunds,
    GREATEST(0, t.total_ins - t.total_pay - wt.total_ref)::numeric AS total_remaining
  FROM totals t
  CROSS JOIN wallet_totals wt;
END;
$function$;

-- ── 6. get_company_outstanding_summary — subtract debit notes ────
-- Per the user's company-side model, an إشعار مدين on a company
-- means "the company owes us X" — which REDUCES our outstanding
-- (المستحق للشركة) the same way a سند صرف does. If it overshoots,
-- outstanding flips negative and the card surfaces "رصيد دائن لدى
-- الشركة" already wired in 20260515100000.
--
-- Return shape is unchanged (CREATE OR REPLACE preserves the
-- function signature). The debit-note total folds into the existing
-- outstanding column rather than getting a new breakdown field —
-- per the user's "بدي بس المستحق للشركات فقط لا غير" the dialog
-- doesn't surface debit notes separately anyway.
CREATE OR REPLACE FUNCTION public.get_company_outstanding_summary(
  p_agent_id uuid
)
RETURNS TABLE (
  company_id uuid,
  total_payable numeric,
  total_paid_out numeric,
  total_paid_in numeric,
  total_credit_notes numeric,
  policies_count bigint,
  outstanding numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH policy_totals AS (
    SELECT
      p.company_id,
      COUNT(*)::bigint AS policies_count,
      COALESCE(SUM(p.payed_for_company), 0)::numeric AS total_payable
    FROM public.policies p
    WHERE p.deleted_at IS NULL
      AND p.company_id IS NOT NULL
      AND p.agent_id = p_agent_id
      AND COALESCE(p.cancelled, false) = false
      AND COALESCE(p.transferred, false) = false
    GROUP BY p.company_id
  ),
  settlement_totals AS (
    SELECT
      s.company_id,
      COALESCE(SUM(CASE WHEN s.direction = 'outgoing' THEN s.total_amount ELSE 0 END), 0)::numeric AS total_paid_out,
      COALESCE(SUM(CASE WHEN s.direction = 'incoming' THEN s.total_amount ELSE 0 END), 0)::numeric AS total_paid_in
    FROM public.company_settlements s
    WHERE s.agent_id = p_agent_id
      AND COALESCE(s.refused, false) = false
    GROUP BY s.company_id
  ),
  credit_note_totals AS (
    SELECT
      r.company_id,
      COALESCE(SUM(r.amount), 0)::numeric AS total_credit_notes
    FROM public.receipts r
    WHERE r.agent_id = p_agent_id
      AND r.receipt_type = 'credit_note'
      AND r.company_id IS NOT NULL
      AND r.cancelled_at IS NULL
    GROUP BY r.company_id
  ),
  debit_note_totals AS (
    SELECT
      r.company_id,
      COALESCE(SUM(r.amount), 0)::numeric AS total_debit_notes
    FROM public.receipts r
    WHERE r.agent_id = p_agent_id
      AND r.receipt_type = 'debit_note'
      AND r.company_id IS NOT NULL
      AND r.cancelled_at IS NULL
    GROUP BY r.company_id
  ),
  combined AS (
    SELECT
      ic.id AS company_id,
      COALESCE(pt.total_payable, 0)::numeric AS total_payable,
      COALESCE(st.total_paid_out, 0)::numeric AS total_paid_out,
      COALESCE(st.total_paid_in, 0)::numeric AS total_paid_in,
      COALESCE(cn.total_credit_notes, 0)::numeric AS total_credit_notes,
      COALESCE(dn.total_debit_notes, 0)::numeric AS total_debit_notes,
      COALESCE(pt.policies_count, 0)::bigint AS policies_count
    FROM public.insurance_companies ic
    LEFT JOIN policy_totals pt ON pt.company_id = ic.id
    LEFT JOIN settlement_totals st ON st.company_id = ic.id
    LEFT JOIN credit_note_totals cn ON cn.company_id = ic.id
    LEFT JOIN debit_note_totals dn ON dn.company_id = ic.id
    WHERE ic.agent_id = p_agent_id
  )
  SELECT
    c.company_id,
    c.total_payable,
    c.total_paid_out,
    c.total_paid_in,
    c.total_credit_notes,
    c.policies_count,
    (c.total_payable - c.total_paid_out - c.total_credit_notes - c.total_debit_notes)::numeric AS outstanding
  FROM combined c
  WHERE
    c.total_payable > 0
    OR c.total_paid_out > 0
    OR c.total_paid_in > 0
    OR c.total_credit_notes > 0
    OR c.total_debit_notes > 0;
END;
$$;

COMMENT ON FUNCTION public.get_company_outstanding_summary(uuid) IS
  'Per-company outstanding owed to the insurance company: payed_for_company - outgoing settlements - credit notes - debit notes. Incoming settlements (rare) are returned for display but excluded from outstanding. Scoped to agent_id.';
