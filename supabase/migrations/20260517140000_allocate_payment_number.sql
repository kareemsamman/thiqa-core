-- ============================================================
-- allocate_payment_number — missing sibling allocator for the
-- "external-party سند قبض" flavor of AddOtherVoucherDialog.
--
-- Background: 20260513100100_credit_note_disbursement_allocators
-- introduced allocate_credit_note_number ('C') and
-- allocate_disbursement_number ('D'), and 20260515110000_debit_note_schema
-- added allocate_debit_note_number ('M'). The AddOtherVoucherDialog
-- ships four voucher kinds — payment / disbursement / credit_note /
-- debit_note — but only three had allocator RPCs, so saving an
-- "آخر" سند قبض blew up with PGRST202 "Could not find the function
-- public.allocate_payment_number". This fills the gap.
--
-- Format mirrors the other three: prefix-letter + 2-digit zero-pad
-- below 10 + pass-through for 10+ + '/year'. Examples: 'R07/2026',
-- 'R142/2026'. Uses a dedicated sequence (document_sequences.kind =
-- 'payment') so the counter doesn't share namespace with the
-- per-policy receipt numbers (which live in receipts.receipt_number
-- and use a separate allocator), and rows from this allocator land
-- in receipts.voucher_number (text) — different column, no collision.
-- ============================================================

CREATE OR REPLACE FUNCTION public.allocate_payment_number(p_agent_id uuid, p_year int)
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
  v_seq := public.allocate_document_number(p_agent_id, 'payment', p_year);
  RETURN 'R' ||
    CASE WHEN v_seq < 10 THEN '0' || v_seq::text ELSE v_seq::text END
    || '/' || p_year::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_payment_number(uuid, int) TO authenticated, service_role;
