-- ============================================================
-- Fix: receipt_number / document_number truncation past 99
--
-- The original `LPAD(v_seq::text, 2, '0')` in assign_policy_payment_-
-- receipt_number, assign_policy_document_number, and the recently
-- added allocate_receipt_number_for_policy was actively LOSING data
-- once an agent's sequence crossed 99.
--
-- PostgreSQL's `lpad(string, length, fill)` truncates from the RIGHT
-- when `string` is already longer than `length`:
--   lpad('122', 2, '0')  →  '12'
--   lpad('267', 2, '0')  →  '26'
--   lpad('283', 2, '0')  →  '28'
--
-- That truncation caused the symptom the user reported: every new
-- payment on agent علاء مطيع (sequence at 122) was getting receipt_
-- number "R12/2026"; agents with sequences in the 200s landed on
-- "R26/2026", "R28/2026", etc. The actual document_sequences row was
-- incrementing correctly — it was the STRING that was being chopped
-- off, masquerading hundreds of distinct سندات قبض as a handful of
-- duplicates.
--
-- Fix: replace the broken lpad with an explicit conditional —
--   v_seq < 10  →  '0' || v_seq::text     (keeps R01..R09 cosmetics)
--   v_seq >= 10 →  v_seq::text             (no truncation past 99)
--
-- This migration is idempotent (CREATE OR REPLACE) and touches only
-- the three function bodies. The underlying sequence values are
-- unaffected; existing rows keep their (truncated) receipt_numbers
-- as historical data — we can't recover the original sequence value
-- from a truncated string, so backfilling would require re-assigning
-- new numbers which the user has not asked for.
-- ============================================================

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
  RETURN 'R' ||
    CASE WHEN v_seq < 10 THEN '0' || v_seq::text ELSE v_seq::text END
    || '/' || v_year::text;
END;
$$;

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
  -- already exists. Prefer payment_session_id (canonical session key);
  -- fall back to batch_id (multi-cheque allocator + PackagePaymentModal).
  -- Same-statement siblings are invisible at BEFORE INSERT time, so
  -- this only helps for separate INSERT statements within the same
  -- session — the application-side pre-allocate path
  -- (allocate_receipt_number_for_policy) is the primary fix.
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

  v_seq := public.allocate_document_number(v_agent, 'receipt', v_year);
  NEW.receipt_number := 'R' ||
    CASE WHEN v_seq < 10 THEN '0' || v_seq::text ELSE v_seq::text END
    || '/' || v_year::text;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_policy_document_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int;
  v_seq int;
BEGIN
  IF NEW.document_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_year := EXTRACT(YEAR FROM COALESCE(NEW.created_at, now()))::int;
  v_seq := public.allocate_document_number(NEW.agent_id, 'policy', v_year);
  NEW.document_number :=
    (CASE WHEN v_seq < 10 THEN '0' || v_seq::text ELSE v_seq::text END)
    || '/' || v_year::text;
  RETURN NEW;
END;
$$;
