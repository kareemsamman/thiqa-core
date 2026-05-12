-- ============================================================
-- Phase 2b — client_settlements → receipts mirror + voucher stamp
--
-- Two triggers chained on client_settlements:
--
--   BEFORE INSERT  — assign_client_settlement_voucher_number
--     • Stamps voucher_number using allocate_disbursement_number,
--       reusing an existing number when the row shares a
--       settlement_session_id with an already-numbered sibling so
--       multi-line disbursements (cash + cheque) carry one D{nn}/YYYY.
--
--   AFTER INSERT   — sync_receipt_from_client_settlement
--     • Inserts a paired row into receipts with
--       receipt_type='disbursement' so every سند صرف surfaces on
--       /receipts → "سند صرف" tab and on the client's سجل الدفعات
--       without the page having to query a second table.
--
-- Both triggers are idempotent on re-inserts of the same row — they
-- short-circuit when voucher_number / receipts.client_settlement_id
-- are already set.
-- ============================================================

-- Receipts needs a back-link to the originating client_settlement
-- row so the mirror trigger can be re-run safely (skip if already
-- mirrored). One settlement → one receipts row.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS client_settlement_id uuid
    REFERENCES public.client_settlements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS receipts_client_settlement_id_idx
  ON public.receipts (client_settlement_id)
  WHERE client_settlement_id IS NOT NULL;

-- ── Voucher number allocator (BEFORE INSERT) ────────────────────────
CREATE OR REPLACE FUNCTION public.assign_client_settlement_voucher_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int;
  v_existing text;
BEGIN
  IF NEW.voucher_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reuse a sibling line's number when this insert is part of an
  -- already-allocated settlement session. Same-statement siblings
  -- aren't visible at BEFORE INSERT, so this only helps separate
  -- INSERT statements within one session — the application's
  -- session-aware insert path takes care of single-shot
  -- multi-line writes.
  IF NEW.settlement_session_id IS NOT NULL THEN
    SELECT voucher_number INTO v_existing
    FROM public.client_settlements
    WHERE settlement_session_id = NEW.settlement_session_id
      AND voucher_number IS NOT NULL
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      NEW.voucher_number := v_existing;
      RETURN NEW;
    END IF;
  END IF;

  v_year := EXTRACT(YEAR FROM COALESCE(NEW.settlement_date, CURRENT_DATE, now()))::int;
  NEW.voucher_number := public.allocate_disbursement_number(NEW.agent_id, v_year);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_client_settlement_voucher_number
  ON public.client_settlements;
CREATE TRIGGER trg_assign_client_settlement_voucher_number
  BEFORE INSERT ON public.client_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_client_settlement_voucher_number();

-- ── Receipts mirror (AFTER INSERT) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_receipt_from_client_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_already_mirrored uuid;
BEGIN
  -- Skip if a receipts row is already linked back to this
  -- settlement (defensive; the column has no UNIQUE constraint but
  -- application code should only ever create one).
  SELECT id INTO v_already_mirrored
  FROM public.receipts
  WHERE client_settlement_id = NEW.id
  LIMIT 1;
  IF v_already_mirrored IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve the client's display name for the receipts.client_name
  -- column (the /receipts page reads this directly without an extra
  -- join). Missing client just leaves the column NULL.
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
    -- Map AddSettlementDialog's payment_type values to the
    -- payment_method values the receipts page already knows about.
    -- visa + bank_transfer + customer_cheque all become their
    -- closest receipts equivalent so paymentLabelShort() renders
    -- without surprise. cheque + cash pass straight through.
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

DROP TRIGGER IF EXISTS trg_sync_receipt_from_client_settlement
  ON public.client_settlements;
CREATE TRIGGER trg_sync_receipt_from_client_settlement
  AFTER INSERT ON public.client_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_receipt_from_client_settlement();
