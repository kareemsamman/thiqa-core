-- Denormalize policies.skip_recalc onto receipts.is_imported.
--
-- The /receipts page used to exclude imported-from-EXE rows by
-- pre-fetching every skip_recalc=true policy id and stuffing them
-- into a `policy_id.not.in.(...)` clause. For agents with hundreds
-- of imported policies that URL exceeds the proxy limit and the
-- whole listing returns 400 Bad Request — observed on the Tamer
-- Asali agent (f37f11e5-…) where workers saw an empty list with
-- "خطأ في تحميل الإيصالات".
--
-- Fix: mirror the flag onto receipts so the page filter becomes a
-- single indexed `is_imported = false` predicate. The sync trigger
-- (policy_payments → receipts) already runs SECURITY DEFINER and
-- knows the parent policy, so it can stamp the flag at INSERT.
-- Manual receipts never have a policy and stay is_imported=false.

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS is_imported boolean NOT NULL DEFAULT false;

-- Backfill from the parent policy. Manual receipts (policy_id IS NULL)
-- already have is_imported=false via the column default.
UPDATE public.receipts AS r
SET is_imported = true
FROM public.policies AS p
WHERE r.policy_id = p.id
  AND p.skip_recalc = true
  AND r.is_imported = false;

CREATE INDEX IF NOT EXISTS idx_receipts_agent_is_imported
  ON public.receipts(agent_id, is_imported)
  WHERE is_imported = false;

-- Update the sync trigger so newly-mirrored auto receipts inherit
-- the flag. INSERT and the "came back from refused" branch both
-- read it from the parent policy at the same SELECT that fetches
-- client_name / car_number / agent_id / branch_id.
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
    IF COALESCE(NEW.refused, false) = true AND COALESCE(OLD.refused, false) = false THEN
      DELETE FROM public.receipts
      WHERE payment_id = NEW.id AND source = 'auto';
      RETURN NEW;
    END IF;

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
      WHERE payment_id = NEW.id AND source = 'auto';

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
