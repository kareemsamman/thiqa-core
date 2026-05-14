-- ────────────────────────────────────────────────────────────────
-- get_company_outstanding_summary(agent_id)
--
-- Returns per-company "المستحق للشركة" running-account breakdown so
-- the receipts wizard + the AddSettlementDialog / credit-note dialog
-- can all read from one consistent source.
--
-- Why an RPC rather than a direct PostgREST query: the direct path
-- respects RLS on `policies`, which requires user_belongs_to_agent +
-- can_access_branch. Branch-scoped users sometimes can't see every
-- policy under their agent — but a "kashf 360" of all companies for
-- the agent SHOULD see everything because the user is making a
-- voucher decision for the WHOLE agency, not their branch. Same
-- pattern as report_company_settlement: SECURITY DEFINER, scoped to
-- the caller's agent.
--
-- Formula (per the accountant model the user described):
--   outstanding = Σ payed_for_company                        ← gross from issued policies
--               + Σ receipts(credit_note for company)         ← paper, ADDS to debt
--               − Σ company_settlements(outgoing, !refused)   ← مدفوع للشركة
--               − Σ company_settlements(incoming, !refused)   ← سند قبض من الشركة
--
-- Cancelled / transferred policies are excluded — their
-- company_payable ledger entries get reversed by the existing
-- policy_cancelled trigger.
-- ────────────────────────────────────────────────────────────────

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
  combined AS (
    SELECT
      ic.id AS company_id,
      COALESCE(pt.total_payable, 0)::numeric AS total_payable,
      COALESCE(st.total_paid_out, 0)::numeric AS total_paid_out,
      COALESCE(st.total_paid_in, 0)::numeric AS total_paid_in,
      COALESCE(cn.total_credit_notes, 0)::numeric AS total_credit_notes,
      COALESCE(pt.policies_count, 0)::bigint AS policies_count
    FROM public.insurance_companies ic
    LEFT JOIN policy_totals pt ON pt.company_id = ic.id
    LEFT JOIN settlement_totals st ON st.company_id = ic.id
    LEFT JOIN credit_note_totals cn ON cn.company_id = ic.id
    WHERE ic.agent_id = p_agent_id
  )
  SELECT
    c.company_id,
    c.total_payable,
    c.total_paid_out,
    c.total_paid_in,
    c.total_credit_notes,
    c.policies_count,
    (c.total_payable + c.total_credit_notes - c.total_paid_out - c.total_paid_in)::numeric AS outstanding
  FROM combined c
  WHERE
    c.total_payable > 0
    OR c.total_paid_out > 0
    OR c.total_paid_in > 0
    OR c.total_credit_notes > 0;
END;
$$;

COMMENT ON FUNCTION public.get_company_outstanding_summary(uuid) IS
  'Per-company running account: gross payable + credit notes − settlements (both directions). Scoped to agent_id. Used by the /receipts wizard so balance pills reconcile with /company-settlement.';
