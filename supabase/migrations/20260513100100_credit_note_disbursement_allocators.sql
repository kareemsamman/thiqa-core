-- ============================================================
-- Phase 1a — Credit Note / Disbursement number allocators
--
-- Wrapper functions around allocate_document_number that return the
-- formatted "C{nn}/{year}" / "D{nn}/{year}" strings used on screen
-- and in print. Format mirrors the receipt + policy allocators:
--
--   • prefix-letter ('C' for credit note, 'D' for disbursement)
--   • sequence padded to at least 2 digits ('01'..'09'); larger
--     values pass through unchanged (avoids the lpad truncation
--     bug that bit assign_policy_payment_receipt_number once
--     sequences crossed 99 — see 20260512100000_fix_receipt_number_truncation)
--   • '/' year
--
-- Examples: 'C07/2026', 'D142/2026'.
--
-- Both functions are SECURITY DEFINER so the client can call them
-- through PostgREST without seeing document_sequences directly.
-- ============================================================

CREATE OR REPLACE FUNCTION public.allocate_credit_note_number(p_agent_id uuid, p_year int)
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
  v_seq := public.allocate_document_number(p_agent_id, 'credit_note', p_year);
  RETURN 'C' ||
    CASE WHEN v_seq < 10 THEN '0' || v_seq::text ELSE v_seq::text END
    || '/' || p_year::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_credit_note_number(uuid, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.allocate_disbursement_number(p_agent_id uuid, p_year int)
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
  v_seq := public.allocate_document_number(p_agent_id, 'disbursement', p_year);
  RETURN 'D' ||
    CASE WHEN v_seq < 10 THEN '0' || v_seq::text ELSE v_seq::text END
    || '/' || p_year::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_disbursement_number(uuid, int) TO authenticated, service_role;
