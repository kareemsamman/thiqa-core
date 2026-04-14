-- ============================================================
-- Document numbering: per-agent, per-year, per-kind sequences
-- for policies (وثيقة NN/YYYY) and payment receipts (R NN/YYYY).
-- ============================================================

-- Per-agent, per-kind, per-year counters. Rows are created lazily the
-- first time a given (agent, kind, year) triple needs a number.
CREATE TABLE IF NOT EXISTS public.document_sequences (
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('policy', 'receipt')),
  year int NOT NULL,
  next_value int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, kind, year)
);

ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

-- Only service_role touches this table; the client never reads from it
-- directly. It's allocated through the SECURITY DEFINER function below.
CREATE POLICY "document_sequences service_role only"
  ON public.document_sequences FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Allocate and return the next sequence for (agent, kind, year). Runs
-- under SECURITY DEFINER so it bypasses RLS and increments atomically.
CREATE OR REPLACE FUNCTION public.allocate_document_number(
  p_agent_id uuid,
  p_kind text,
  p_year int
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next int;
BEGIN
  IF p_kind NOT IN ('policy', 'receipt') THEN
    RAISE EXCEPTION 'invalid document kind: %', p_kind;
  END IF;

  INSERT INTO public.document_sequences (agent_id, kind, year, next_value)
  VALUES (p_agent_id, p_kind, p_year, 1)
  ON CONFLICT (agent_id, kind, year) DO NOTHING;

  UPDATE public.document_sequences
     SET next_value = next_value + 1,
         updated_at = now()
   WHERE agent_id = p_agent_id
     AND kind = p_kind
     AND year = p_year
  RETURNING next_value - 1 INTO v_next;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_document_number(uuid, text, int) TO authenticated, service_role;

-- Human-readable document number column on policies. Format: "NN/YYYY"
-- padded to at least 2 digits (e.g. "01/2026", "147/2026"). Nullable so
-- old rows can be backfilled lazily.
ALTER TABLE public.policies
  ADD COLUMN IF NOT EXISTS document_number text;

CREATE INDEX IF NOT EXISTS policies_document_number_idx
  ON public.policies (agent_id, document_number);

-- Human-readable receipt number column on policy_payments. Format:
-- "RNN/YYYY". Nullable for the same reason.
ALTER TABLE public.policy_payments
  ADD COLUMN IF NOT EXISTS receipt_number text;

CREATE INDEX IF NOT EXISTS policy_payments_receipt_number_idx
  ON public.policy_payments (receipt_number);

-- Backfill existing rows. We walk each agent's rows in created_at order
-- and assign a sequential number per year so existing data matches the
-- same format new rows will use.
DO $$
DECLARE
  r record;
  seq int;
  y int;
  last_agent uuid := NULL;
  last_year int := NULL;
BEGIN
  FOR r IN
    SELECT id, agent_id, created_at
    FROM public.policies
    WHERE document_number IS NULL
    ORDER BY agent_id, EXTRACT(YEAR FROM created_at), created_at, id
  LOOP
    y := EXTRACT(YEAR FROM r.created_at)::int;
    IF r.agent_id IS DISTINCT FROM last_agent OR y IS DISTINCT FROM last_year THEN
      seq := 1;
      last_agent := r.agent_id;
      last_year := y;
    END IF;
    UPDATE public.policies
       SET document_number = LPAD(seq::text, 2, '0') || '/' || y::text
     WHERE id = r.id;
    -- keep the sequence table in sync so the next allocation doesn't collide
    INSERT INTO public.document_sequences (agent_id, kind, year, next_value)
    VALUES (r.agent_id, 'policy', y, seq + 1)
    ON CONFLICT (agent_id, kind, year) DO UPDATE
      SET next_value = GREATEST(public.document_sequences.next_value, EXCLUDED.next_value);
    seq := seq + 1;
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
  seq int;
  y int;
  last_agent uuid := NULL;
  last_year int := NULL;
BEGIN
  FOR r IN
    SELECT pp.id, p.agent_id, pp.created_at
    FROM public.policy_payments pp
    JOIN public.policies p ON p.id = pp.policy_id
    WHERE pp.receipt_number IS NULL
    ORDER BY p.agent_id, EXTRACT(YEAR FROM pp.created_at), pp.created_at, pp.id
  LOOP
    y := EXTRACT(YEAR FROM r.created_at)::int;
    IF r.agent_id IS DISTINCT FROM last_agent OR y IS DISTINCT FROM last_year THEN
      seq := 1;
      last_agent := r.agent_id;
      last_year := y;
    END IF;
    UPDATE public.policy_payments
       SET receipt_number = 'R' || LPAD(seq::text, 2, '0') || '/' || y::text
     WHERE id = r.id;
    INSERT INTO public.document_sequences (agent_id, kind, year, next_value)
    VALUES (r.agent_id, 'receipt', y, seq + 1)
    ON CONFLICT (agent_id, kind, year) DO UPDATE
      SET next_value = GREATEST(public.document_sequences.next_value, EXCLUDED.next_value);
    seq := seq + 1;
  END LOOP;
END $$;

-- Auto-assign document_number on new policies. Uses the policy's agent_id
-- and the year of its created_at. NEW.document_number is only set if the
-- caller didn't provide one, so manual imports still work.
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
  NEW.document_number := LPAD(v_seq::text, 2, '0') || '/' || v_year::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_policy_document_number ON public.policies;
CREATE TRIGGER trg_assign_policy_document_number
  BEFORE INSERT ON public.policies
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_policy_document_number();

-- Auto-assign receipt_number on new policy_payments. Looks up the
-- policy's agent_id because payments don't store it directly.
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
BEGIN
  IF NEW.receipt_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT agent_id INTO v_agent FROM public.policies WHERE id = NEW.policy_id;
  IF v_agent IS NULL THEN
    RETURN NEW;
  END IF;
  v_year := EXTRACT(YEAR FROM COALESCE(NEW.created_at, now()))::int;
  v_seq := public.allocate_document_number(v_agent, 'receipt', v_year);
  NEW.receipt_number := 'R' || LPAD(v_seq::text, 2, '0') || '/' || v_year::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_policy_payment_receipt_number ON public.policy_payments;
CREATE TRIGGER trg_assign_policy_payment_receipt_number
  BEFORE INSERT ON public.policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_policy_payment_receipt_number();
