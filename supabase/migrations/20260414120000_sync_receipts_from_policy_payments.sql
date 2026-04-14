-- ============================================================
-- Auto-sync public.receipts with public.policy_payments
--
-- Every policy payment (except refused ones) should surface as a
-- row in the receipts page so the agent can see, edit, and print
-- it the same way as a manually-entered receipt. We handle this
-- with triggers + a one-time backfill rather than a union view so
-- the existing Receipts page query (which reads the `receipts`
-- table directly) keeps working unchanged.
-- ============================================================

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
BEGIN
  SELECT
    c.full_name,
    ca.car_number,
    p.agent_id,
    p.branch_id
  INTO v_client_name, v_car_number, v_agent_id, v_branch_id
  FROM public.policies p
  LEFT JOIN public.clients c ON c.id = p.client_id
  LEFT JOIN public.cars ca ON ca.id = p.car_id
  WHERE p.id = NEW.policy_id;

  -- Fall back to the payment's own agent/branch when the policy
  -- doesn't carry them (legacy rows had nullable agent_id on policies).
  v_agent_id := COALESCE(v_agent_id, NEW.agent_id);
  v_branch_id := COALESCE(v_branch_id, NEW.branch_id);

  -- receipts.agent_id is NOT NULL — bail out quietly if we can't
  -- resolve an owner, rather than blowing up the payment insert.
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
      agent_id, branch_id
    )
    VALUES (
      'payment', 'auto', v_client_name, v_car_number,
      NEW.amount, NEW.payment_date, NEW.payment_type, NEW.cheque_number,
      NEW.card_last_four, NEW.notes, NEW.id, NEW.policy_id,
      v_agent_id, v_branch_id
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Became refused → drop the auto receipt
    IF COALESCE(NEW.refused, false) = true AND COALESCE(OLD.refused, false) = false THEN
      DELETE FROM public.receipts
      WHERE payment_id = NEW.id AND source = 'auto';
      RETURN NEW;
    END IF;

    -- Came back from refused → recreate the auto receipt
    IF COALESCE(NEW.refused, false) = false AND COALESCE(OLD.refused, false) = true THEN
      INSERT INTO public.receipts (
        receipt_type, source, client_name, car_number,
        amount, receipt_date, payment_method, cheque_number,
        card_last_four, notes, payment_id, policy_id,
        agent_id, branch_id
      )
      VALUES (
        'payment', 'auto', v_client_name, v_car_number,
        NEW.amount, NEW.payment_date, NEW.payment_type, NEW.cheque_number,
        NEW.card_last_four, NEW.notes, NEW.id, NEW.policy_id,
        v_agent_id, v_branch_id
      );
      RETURN NEW;
    END IF;

    -- Normal edit on a non-refused payment → sync the mirror row
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
        branch_id = v_branch_id
      WHERE payment_id = NEW.id AND source = 'auto';

      -- Row might not exist yet (e.g. if the payment was created
      -- before this trigger shipped and the backfill missed it).
      IF NOT FOUND THEN
        INSERT INTO public.receipts (
          receipt_type, source, client_name, car_number,
          amount, receipt_date, payment_method, cheque_number,
          card_last_four, notes, payment_id, policy_id,
          agent_id, branch_id
        )
        VALUES (
          'payment', 'auto', v_client_name, v_car_number,
          NEW.amount, NEW.payment_date, NEW.payment_type, NEW.cheque_number,
          NEW.card_last_four, NEW.notes, NEW.id, NEW.policy_id,
          v_agent_id, v_branch_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_receipt_from_policy_payment ON public.policy_payments;
CREATE TRIGGER trg_sync_receipt_from_policy_payment
AFTER INSERT OR UPDATE ON public.policy_payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_receipt_from_policy_payment();

-- The existing FK uses ON DELETE SET NULL, which would leave orphan
-- auto rows when a payment is deleted. Clean them up first with a
-- BEFORE DELETE trigger so the user-facing list stays in sync.
CREATE OR REPLACE FUNCTION public.delete_receipt_for_policy_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.receipts
  WHERE payment_id = OLD.id AND source = 'auto';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_receipt_for_policy_payment ON public.policy_payments;
CREATE TRIGGER trg_delete_receipt_for_policy_payment
BEFORE DELETE ON public.policy_payments
FOR EACH ROW
EXECUTE FUNCTION public.delete_receipt_for_policy_payment();

-- Backfill: create an auto receipt for every non-refused payment
-- that doesn't already have one. Safe to re-run thanks to the
-- NOT EXISTS guard.
INSERT INTO public.receipts (
  receipt_type, source, client_name, car_number,
  amount, receipt_date, payment_method, cheque_number,
  card_last_four, notes, payment_id, policy_id,
  agent_id, branch_id, created_at
)
SELECT
  'payment',
  'auto',
  c.full_name,
  ca.car_number,
  pp.amount,
  pp.payment_date,
  pp.payment_type,
  pp.cheque_number,
  pp.card_last_four,
  pp.notes,
  pp.id,
  pp.policy_id,
  COALESCE(p.agent_id, pp.agent_id),
  COALESCE(p.branch_id, pp.branch_id),
  pp.created_at
FROM public.policy_payments pp
JOIN public.policies p ON p.id = pp.policy_id
LEFT JOIN public.clients c ON c.id = p.client_id
LEFT JOIN public.cars ca ON ca.id = p.car_id
WHERE COALESCE(pp.refused, false) = false
  AND COALESCE(p.agent_id, pp.agent_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.receipts r
    WHERE r.payment_id = pp.id AND r.source = 'auto'
  );
