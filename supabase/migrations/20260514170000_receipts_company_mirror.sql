-- ─────────────────────────────────────────────────────────────
-- receipts.company_id + company_settlement_id — mirror company
-- vouchers into the receipts table so they surface on /receipts
-- alongside customer + broker vouchers.
-- ─────────────────────────────────────────────────────────────
--
-- Pattern follows client_settlements (trigger-based mirror) rather
-- than broker_settlements (application-layer mirror): the trigger
-- ensures the existing /company-settlement page also produces
-- /receipts rows automatically — no app-side changes needed there.
--
-- Direction mapping:
--   • company_settlements.direction = 'outgoing'  → سند صرف   → receipts.receipt_type = 'disbursement', voucher_number = D{nn}/{year}
--   • company_settlements.direction = 'incoming'  → سند قبض   → receipts.receipt_type = 'payment',      voucher_number left NULL (uses serial receipt_number for R{n}/{year} display)
--
-- إشعار دائن (credit_note) for companies does NOT go through
-- company_settlements — it writes directly to receipts with
-- company_id set and amount that INCREASES the outstanding-to-company
-- balance (opposite sign convention from customer credit notes,
-- because we OWE the company; crediting their account in our books
-- means our liability grows).

-- ── 1. company_settlements: session + voucher columns ──────────
-- Multi-line saves (cash + cheque + …) within one collection event
-- share a settlement_session_id so the BEFORE INSERT trigger reuses
-- a single D{nn}/{year} across all rows.
ALTER TABLE public.company_settlements
  ADD COLUMN IF NOT EXISTS settlement_session_id uuid,
  ADD COLUMN IF NOT EXISTS voucher_number text;

CREATE UNIQUE INDEX IF NOT EXISTS company_settlements_voucher_per_agent_idx
  ON public.company_settlements (agent_id, voucher_number)
  WHERE voucher_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS company_settlements_session_idx
  ON public.company_settlements (settlement_session_id)
  WHERE settlement_session_id IS NOT NULL;

-- ── 2. receipts: company FK columns ────────────────────────────
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS company_id uuid
    REFERENCES public.insurance_companies(id) ON DELETE SET NULL;

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS company_settlement_id uuid
    REFERENCES public.company_settlements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS receipts_company_id_idx
  ON public.receipts (company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS receipts_company_settlement_id_idx
  ON public.receipts (company_settlement_id)
  WHERE company_settlement_id IS NOT NULL;

COMMENT ON COLUMN public.receipts.company_id IS
  'When set, this receipt is a company voucher (سند قبض/صرف/إشعار دائن لشركة). Customer + broker receipts leave this NULL.';

COMMENT ON COLUMN public.receipts.company_settlement_id IS
  'FK to the company_settlements row that produced this receipt. NULL for paper credit notes (إشعار دائن) which never touch company_settlements.';

-- ── 3. Voucher allocator (BEFORE INSERT) ───────────────────────
-- Stamps voucher_number using allocate_disbursement_number for
-- outgoing settlements. Incoming (company paid us) leaves
-- voucher_number NULL so the receipts page's R{n}/{year} formatter
-- takes over via the serial receipt_number column.
CREATE OR REPLACE FUNCTION public.assign_company_settlement_voucher_number()
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
  IF NEW.direction <> 'outgoing' THEN
    RETURN NEW;
  END IF;

  -- Reuse a sibling's number when this insert is part of an
  -- already-allocated session.
  IF NEW.settlement_session_id IS NOT NULL THEN
    SELECT voucher_number INTO v_existing
    FROM public.company_settlements
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

DROP TRIGGER IF EXISTS trg_assign_company_settlement_voucher_number
  ON public.company_settlements;
CREATE TRIGGER trg_assign_company_settlement_voucher_number
  BEFORE INSERT ON public.company_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_company_settlement_voucher_number();

-- ── 4. Receipts mirror (AFTER INSERT + AFTER UPDATE OF refused) ──
CREATE OR REPLACE FUNCTION public.sync_receipt_from_company_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_name text;
  v_already_mirrored uuid;
  v_original_receipt_id uuid;
  v_original_amount numeric;
  v_original_payment_method text;
  v_original_cheque_number text;
  v_original_card_last_four text;
BEGIN
  -- Legacy rows without an agent_id can't be mirrored — they'd
  -- violate the receipts.agent_id NOT NULL constraint. Skip silently.
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve the company's display name once.
  SELECT COALESCE(name_ar, name) INTO v_company_name
  FROM public.insurance_companies
  WHERE id = NEW.company_id;

  -- ─── INSERT branch ────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    -- Defensive: skip if a mirror already exists (e.g. re-inserts).
    SELECT id INTO v_already_mirrored
    FROM public.receipts
    WHERE company_settlement_id = NEW.id
    LIMIT 1;
    IF v_already_mirrored IS NOT NULL THEN
      RETURN NEW;
    END IF;

    -- Refused-on-creation rows shouldn't surface as live receipts.
    IF COALESCE(NEW.refused, false) = true THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.receipts (
      receipt_type,
      source,
      voucher_number,
      company_id,
      company_settlement_id,
      client_name,
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
      CASE NEW.direction WHEN 'outgoing' THEN 'disbursement' ELSE 'payment' END,
      'auto',
      NEW.voucher_number,
      NEW.company_id,
      NEW.id,
      v_company_name,
      NEW.total_amount,
      NEW.settlement_date,
      -- Map AddSettlementDialog payment_type values to receipts
      -- payment_method values — same mapping the client mirror uses.
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
  END IF;

  -- ─── UPDATE branch: refused flips false → true ────────────────
  -- Create a cancellation voucher (matching the customer payment
  -- cancellation pattern) and mark the live mirror cancelled. The
  -- existing trigger_company_settlement_refused already reverses
  -- the ledger entry — this trigger only handles the /receipts
  -- presentation side.
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.refused, false) = true
     AND COALESCE(OLD.refused, false) = false
  THEN
    SELECT id, amount, payment_method, cheque_number, card_last_four
    INTO v_original_receipt_id, v_original_amount, v_original_payment_method,
         v_original_cheque_number, v_original_card_last_four
    FROM public.receipts
    WHERE company_settlement_id = NEW.id
      AND source = 'auto'
      AND cancelled_at IS NULL
      AND receipt_type IN ('payment', 'disbursement')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_original_receipt_id IS NOT NULL THEN
      INSERT INTO public.receipts (
        receipt_type,
        source,
        client_name,
        company_id,
        amount,
        receipt_date,
        payment_method,
        cheque_number,
        card_last_four,
        notes,
        agent_id,
        branch_id,
        cancels_receipt_id
      )
      VALUES (
        'cancellation',
        'auto',
        v_company_name,
        NEW.company_id,
        v_original_amount,
        CURRENT_DATE,
        v_original_payment_method,
        v_original_cheque_number,
        v_original_card_last_four,
        'إلغاء سند شركة — دفعة مرفوضة/شيك راجع',
        NEW.agent_id,
        NEW.branch_id,
        v_original_receipt_id
      );

      UPDATE public.receipts
      SET cancelled_at = NOW(),
          cancellation_reason = 'دفعة مرفوضة/شيك راجع'
      WHERE id = v_original_receipt_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_receipt_from_company_settlement_ins
  ON public.company_settlements;
CREATE TRIGGER trg_sync_receipt_from_company_settlement_ins
  AFTER INSERT ON public.company_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_receipt_from_company_settlement();

DROP TRIGGER IF EXISTS trg_sync_receipt_from_company_settlement_upd
  ON public.company_settlements;
CREATE TRIGGER trg_sync_receipt_from_company_settlement_upd
  AFTER UPDATE OF refused ON public.company_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_receipt_from_company_settlement();
