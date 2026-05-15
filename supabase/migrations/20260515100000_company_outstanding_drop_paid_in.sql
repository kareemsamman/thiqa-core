-- ────────────────────────────────────────────────────────────────
-- get_company_outstanding_summary — formula simplification
--
-- Per the user's accountant model: the company-side dialog should
-- surface ONE number, "المستحق للشركة", and exactly the three rows
-- that produce it:
--
--   المستحق للشركة = Σ payed_for_company         ← من البوليصات
--                  − Σ company_settlements(outgoing)  ← سندات الصرف
--                  − Σ receipts(credit_note for company) ← إشعارات دائنة
--
-- Two changes vs. the previous formula:
--
--   • سندات القبض من الشركة (incoming settlements) used to subtract
--     here too. They're rare (the company refunding the agent) and
--     belong on the receipts page, not in this summary — they were
--     muddying the number. Dropped from the formula. Still SELECTed
--     as total_paid_in for any caller that wants the figure for
--     informational display.
--
--   • Credit notes used to ADD (paper liability the agent owes the
--     company). Per the user's model the إشعار دائن in this flow is
--     the COMPANY recording the agent's payment "على الحساب" — it
--     SUBTRACTS from what the agent still owes, same as a سند صرف
--     would, just unsettled. Direction flipped accordingly.
--
-- Cancelled / transferred policies stay excluded — their company
-- payable gets reversed by the policy_cancelled trigger.
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
    (c.total_payable - c.total_paid_out - c.total_credit_notes)::numeric AS outstanding
  FROM combined c
  WHERE
    c.total_payable > 0
    OR c.total_paid_out > 0
    OR c.total_paid_in > 0
    OR c.total_credit_notes > 0;
END;
$$;

COMMENT ON FUNCTION public.get_company_outstanding_summary(uuid) IS
  'Per-company outstanding owed to the insurance company: payed_for_company − outgoing settlements − credit notes. Incoming settlements (rare) are returned for display but excluded from outstanding. Scoped to agent_id.';
