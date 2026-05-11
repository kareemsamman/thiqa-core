-- ============================================================
-- Cancellation vouchers (سند إلغاء): when a payment is voided
-- (refused=true), keep the original receipt and create a paired
-- cancellation voucher row with its own receipt_number. Per the
-- immutable-accounting rule the user wants going forward, money
-- records are never deleted — the original stays as historical
-- evidence and a new voucher documents the cancellation.
--
-- Replaces the behavior in 20260511130000 where the trigger
-- silently DELETE'd the auto receipt on refused=true → the
-- bookkeeper lost any audit trail of the cancellation, and the
-- printed/displayed receipt simply vanished.
-- ============================================================

-- 1. Allow 'cancellation' as a receipt_type. The original CHECK
--    only accepted 'payment' / 'accident_fee'.
ALTER TABLE public.receipts
  DROP CONSTRAINT IF EXISTS receipts_receipt_type_check;
ALTER TABLE public.receipts
  ADD CONSTRAINT receipts_receipt_type_check
    CHECK (receipt_type IN ('payment', 'accident_fee', 'cancellation'));

-- 2. Cancellation tracking columns.
--    On the ORIGINAL receipt: cancelled_at + cancellation_reason
--      so display/print can quickly render "ملغي" + the reason
--      without joining back to the cancellation voucher.
--    On the CANCELLATION VOUCHER: cancels_receipt_id (FK to
--      original) so the voucher knows which receipt it voids.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancels_receipt_id uuid REFERENCES public.receipts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_cancels_receipt_id
  ON public.receipts(cancels_receipt_id)
  WHERE cancels_receipt_id IS NOT NULL;

-- 3. Reason on policy_payments so the trigger can read it directly
--    instead of parsing notes. Cheques.tsx used to append
--    "إلغاء: <reason>" to notes; from this migration on the
--    application sets cancellation_reason cleanly and the trigger
--    picks it up.
ALTER TABLE public.policy_payments
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- 4. Rewrite sync_receipt_from_policy_payment. Only the "refused
--    flips false→true" branch fundamentally changes behavior — we
--    insert a cancellation voucher and mark the original cancelled
--    instead of DELETEing. Other branches stay close to the prior
--    version with one tweak: the plain UPDATE / refused-false
--    branches now skip already-cancelled receipts so a
--    post-cancellation update on the underlying payment row can't
--    re-touch a frozen historical record.
CREATE OR REPLACE FUNCTION public.sync_receipt_from_policy_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_car_number text;
  v_agent_id uuid;
  v_branch_id uuid;
  v_is_imported boolean;
  v_original_id uuid;
  v_original_amount numeric;
  v_original_payment_method text;
  v_original_cheque_number text;
  v_original_card_last_four text;
  v_reason text;
BEGIN
  SELECT
    c.full_name,
    ca.car_number,
    p.agent_id,
    p.branch_id,
    COALESCE(p.skip_recalc, false)
  INTO v_client_name, v_car_number, v_agent_id, v_branch_id, v_is_imported
  FROM public.policies p
  LEFT JOIN public.clients c ON c.id = p.client_id
  LEFT JOIN public.cars ca ON ca.id = p.car_id
  WHERE p.id = NEW.policy_id;

  v_agent_id := COALESCE(v_agent_id, NEW.agent_id);
  v_branch_id := COALESCE(v_branch_id, NEW.branch_id);
  v_is_imported := COALESCE(v_is_imported, false);

  IF v_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.refused, false) = true THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.receipts (
      receipt_type, source, client_name, car_number,
      amount, receipt_date, payment_method, cheque_number,
      card_last_four, notes, payment_id, policy_id,
      agent_id, branch_id, is_imported
    )
    VALUES (
      'payment', 'auto', v_client_name, v_car_number,
      NEW.amount, NEW.payment_date, NEW.payment_type, NEW.cheque_number,
      NEW.card_last_four, NEW.notes, NEW.id, NEW.policy_id,
      v_agent_id, v_branch_id, v_is_imported
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- ──────────────────────────────────────────────────────────
    -- VOID branch: refused goes false → true (إلغاء أو رجع).
    -- Insert a cancellation voucher (gets its own receipt_number
    -- from the SERIAL) and mark the original cancelled. Receipt is
    -- NEVER deleted — accounting needs the historical row.
    -- ──────────────────────────────────────────────────────────
    IF COALESCE(NEW.refused, false) = true AND COALESCE(OLD.refused, false) = false THEN
      v_reason := COALESCE(NEW.cancellation_reason, 'بدون سبب محدد');

      SELECT id, amount, payment_method, cheque_number, card_last_four
      INTO v_original_id, v_original_amount, v_original_payment_method,
           v_original_cheque_number, v_original_card_last_four
      FROM public.receipts
      WHERE payment_id = NEW.id
        AND source = 'auto'
        AND cancelled_at IS NULL
        AND receipt_type = 'payment'
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_original_id IS NOT NULL THEN
        INSERT INTO public.receipts (
          receipt_type, source, client_name, car_number,
          amount, receipt_date, payment_method, cheque_number,
          card_last_four, notes, payment_id, policy_id,
          agent_id, branch_id, is_imported, cancels_receipt_id
        )
        VALUES (
          'cancellation', 'auto', v_client_name, v_car_number,
          v_original_amount, CURRENT_DATE, v_original_payment_method,
          v_original_cheque_number, v_original_card_last_four,
          v_reason, NEW.id, NEW.policy_id,
          v_agent_id, v_branch_id, false, v_original_id
        );

        UPDATE public.receipts
        SET cancelled_at = NOW(),
            cancellation_reason = v_reason
        WHERE id = v_original_id;
      END IF;

      RETURN NEW;
    END IF;

    -- ──────────────────────────────────────────────────────────
    -- RESTORE branch: refused goes true → false. Per the immutable-
    -- accounting rule the UI shouldn't expose this transition
    -- anymore, but if some caller still flips refused back we
    -- create a fresh payment receipt. The original cancelled
    -- receipt and its voucher stay in place as audit history.
    -- ──────────────────────────────────────────────────────────
    IF COALESCE(NEW.refused, false) = false AND COALESCE(OLD.refused, false) = true THEN
      INSERT INTO public.receipts (
        receipt_type, source, client_name, car_number,
        amount, receipt_date, payment_method, cheque_number,
        card_last_four, notes, payment_id, policy_id,
        agent_id, branch_id, is_imported
      )
      VALUES (
        'payment', 'auto', v_client_name, v_car_number,
        NEW.amount, NEW.payment_date, NEW.payment_type, NEW.cheque_number,
        NEW.card_last_four, NEW.notes, NEW.id, NEW.policy_id,
        v_agent_id, v_branch_id, v_is_imported
      );
      RETURN NEW;
    END IF;

    -- ──────────────────────────────────────────────────────────
    -- SYNC branch: plain field update while refused stays false.
    -- Mirror the change onto the live (non-cancelled) auto receipt.
    -- Cancelled receipts are immutable historical records — never
    -- touch them from this path.
    -- ──────────────────────────────────────────────────────────
    IF COALESCE(NEW.refused, false) = false THEN
      UPDATE public.receipts
      SET
        client_name = v_client_name,
        car_number = v_car_number,
        amount = NEW.amount,
        receipt_date = NEW.payment_date,
        payment_method = NEW.payment_type,
        cheque_number = NEW.cheque_number,
        card_last_four = NEW.card_last_four,
        notes = NEW.notes,
        agent_id = v_agent_id,
        branch_id = v_branch_id,
        is_imported = v_is_imported
      WHERE payment_id = NEW.id
        AND source = 'auto'
        AND receipt_type = 'payment'
        AND cancelled_at IS NULL;

      IF NOT FOUND THEN
        INSERT INTO public.receipts (
          receipt_type, source, client_name, car_number,
          amount, receipt_date, payment_method, cheque_number,
          card_last_four, notes, payment_id, policy_id,
          agent_id, branch_id, is_imported
        )
        VALUES (
          'payment', 'auto', v_client_name, v_car_number,
          NEW.amount, NEW.payment_date, NEW.payment_type, NEW.cheque_number,
          NEW.card_last_four, NEW.notes, NEW.id, NEW.policy_id,
          v_agent_id, v_branch_id, v_is_imported
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
