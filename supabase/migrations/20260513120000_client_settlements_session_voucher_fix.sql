-- ============================================================
-- Fix: multi-line client_settlements sharing a voucher_number
--
-- The original schema ran into two design conflicts the first time
-- a multi-line disbursement was attempted from CancelPolicyModal:
--
--   1. client_settlements_voucher_per_agent_idx forbade two rows
--      from sharing (agent_id, voucher_number) — but the assignment
--      trigger deliberately reuses one voucher_number across siblings
--      that share settlement_session_id (so a cash + cheque split
--      under one "D08/2026" reads as a single document, not two).
--   2. sync_receipt_from_client_settlement created one receipts row
--      per settlement line, so a multi-line disbursement also tried
--      to mint duplicate receipts rows under the same voucher.
--
-- Both surfaces broke with:
--     duplicate key value violates unique constraint
--     "client_settlements_voucher_per_agent_idx"
--
-- on the second INSERT of the session. The cancel modal had already
-- updated policies.cancelled=true by that point, leaving the policy
-- cancelled but the disbursement only partially recorded.
--
-- Fix:
--   • Drop the overly strict uniqueness on client_settlements; the
--     allocator function (allocate_disbursement_number) owns
--     cross-session uniqueness, and same-session sharing is the
--     whole point of settlement_session_id.
--   • Rewrite the mirror trigger so the FIRST row of a session
--     creates the receipts row, and subsequent rows just add their
--     amount to it. /receipts then shows one D{nn}/YYYY entry per
--     disbursement operation (matching how staff read it), while
--     generate-disbursement-voucher still has every line available
--     via the existing settlement_session_id join.
-- ============================================================

DROP INDEX IF EXISTS public.client_settlements_voucher_per_agent_idx;

CREATE OR REPLACE FUNCTION public.sync_receipt_from_client_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_existing_receipt_id uuid;
BEGIN
  -- 1. Idempotency for re-inserts of the same row.
  SELECT id INTO v_existing_receipt_id
  FROM public.receipts
  WHERE client_settlement_id = NEW.id
  LIMIT 1;
  IF v_existing_receipt_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2. If a sibling row in the same session already minted a
  --    receipt, bump that receipt's amount instead of creating a
  --    second one. We look up by joining receipts → settlements →
  --    siblings sharing settlement_session_id. The receipts row
  --    keeps its anchor client_settlement_id (the first row), so
  --    the print function still finds every line via the session
  --    join on the anchor.
  IF NEW.settlement_session_id IS NOT NULL THEN
    SELECT r.id INTO v_existing_receipt_id
    FROM public.receipts r
    JOIN public.client_settlements cs ON cs.id = r.client_settlement_id
    WHERE cs.settlement_session_id = NEW.settlement_session_id
    LIMIT 1;
    IF v_existing_receipt_id IS NOT NULL THEN
      UPDATE public.receipts
      SET amount = COALESCE(amount, 0) + COALESCE(NEW.total_amount, 0)
      WHERE id = v_existing_receipt_id;
      RETURN NEW;
    END IF;
  END IF;

  -- 3. First row of a session (or a single-row session): create the
  --    receipt for real.
  SELECT full_name INTO v_client_name
  FROM public.clients
  WHERE id = NEW.client_id;

  INSERT INTO public.receipts (
    receipt_type,
    source,
    voucher_number,
    client_id,
    client_name,
    policy_id,
    client_settlement_id,
    amount,
    receipt_date,
    payment_method,
    cheque_number,
    card_last_four,
    notes,
    agent_id,
    branch_id,
    created_by
  )
  VALUES (
    'disbursement',
    'auto',
    NEW.voucher_number,
    NEW.client_id,
    v_client_name,
    NEW.policy_id,
    NEW.id,
    NEW.total_amount,
    NEW.settlement_date,
    CASE NEW.payment_type
      WHEN 'bank_transfer' THEN 'transfer'
      WHEN 'customer_cheque' THEN 'cheque'
      ELSE NEW.payment_type
    END,
    NEW.cheque_number,
    NEW.card_last_four,
    NEW.notes,
    NEW.agent_id,
    NEW.branch_id,
    NEW.created_by_admin_id
  );

  RETURN NEW;
END;
$$;
