-- ============================================================
-- Session-aware سند قبض numbering
--
-- Rule (set by the user, absolute): ONE سند قبض per collection
-- event, no matter how many policy_payments rows the event groups.
-- A single submit that contains cash + cheque + transfer should land
-- under one R-number, not three.
--
-- Two problems with the prior trigger we're fixing here:
--
-- 1. Per-row allocation. assign_policy_payment_receipt_number fired
--    once per row in a multi-row INSERT, so every payment_line in a
--    DebtPaymentModal/PackagePaymentModal submit allocated its own
--    R-number from the sequence. Rows that shared the same
--    payment_session_id ended up with sequential but DIFFERENT R-
--    numbers (R10, R11, ...), which violates the one-سند rule.
--
-- 2. Multi-row visibility. BEFORE INSERT triggers can't see the
--    other rows of the same INSERT statement (those rows haven't
--    been added to the table yet), so a naive session-aware lookup
--    inside the trigger wouldn't work for the cash+transfer case
--    that's all done in a single submit but two separate INSERTs.
--
-- Fix: application code pre-allocates ONE receipt_number per submit
-- via the new RPC below and stamps it on every row of the submit.
-- The trigger now ALSO has a session-aware lookup as defense in
-- depth — if some path forgets to pre-allocate, the trigger still
-- collapses to one number per session/batch when one already exists
-- on a previously-committed row.
-- ============================================================

-- 1. RPC the application calls before INSERT. Returns a fresh R-number
--    for the policy's agent + current year.
CREATE OR REPLACE FUNCTION public.allocate_receipt_number_for_policy(p_policy_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent uuid;
  v_year int;
  v_seq int;
BEGIN
  SELECT agent_id INTO v_agent FROM public.policies WHERE id = p_policy_id;
  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'policy not found or has no agent';
  END IF;
  v_year := EXTRACT(YEAR FROM now())::int;
  v_seq := public.allocate_document_number(v_agent, 'receipt', v_year);
  RETURN 'R' || LPAD(v_seq::text, 2, '0') || '/' || v_year::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_receipt_number_for_policy(uuid) TO authenticated, service_role;

-- 2. Tighten the BEFORE INSERT trigger to reuse an existing
--    receipt_number when a sibling row in the same session/batch
--    already has one committed.
CREATE OR REPLACE FUNCTION public.assign_policy_payment_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent uuid;
  v_year int;
  v_seq int;
  v_existing text;
BEGIN
  IF NEW.receipt_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT agent_id INTO v_agent FROM public.policies WHERE id = NEW.policy_id;
  IF v_agent IS NULL THEN
    RETURN NEW;
  END IF;
  v_year := EXTRACT(YEAR FROM COALESCE(NEW.created_at, now()))::int;

  -- Reuse an existing R-number from the same collection event when one
  -- already exists. Prefer payment_session_id (the canonical session
  -- key set by DebtPaymentModal); fall back to batch_id (set by the
  -- multi-cheque allocator and by PackagePaymentModal). Either lookup
  -- only finds previously-committed rows — same-statement siblings
  -- are invisible at BEFORE INSERT time, so the app-side pre-allocate
  -- path is what guarantees the single-number invariant for the
  -- common cash+transfer-in-one-submit case.
  IF NEW.payment_session_id IS NOT NULL THEN
    SELECT receipt_number INTO v_existing
    FROM public.policy_payments
    WHERE payment_session_id = NEW.payment_session_id
      AND receipt_number IS NOT NULL
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      NEW.receipt_number := v_existing;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.batch_id IS NOT NULL THEN
    SELECT receipt_number INTO v_existing
    FROM public.policy_payments
    WHERE batch_id = NEW.batch_id
      AND receipt_number IS NOT NULL
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      NEW.receipt_number := v_existing;
      RETURN NEW;
    END IF;
  END IF;

  -- Genuinely new collection event: allocate from the agent's sequence.
  v_seq := public.allocate_document_number(v_agent, 'receipt', v_year);
  NEW.receipt_number := 'R' || LPAD(v_seq::text, 2, '0') || '/' || v_year::text;
  RETURN NEW;
END;
$$;
