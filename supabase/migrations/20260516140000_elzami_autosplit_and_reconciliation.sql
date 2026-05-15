-- ────────────────────────────────────────────────────────────────
-- ELZAMI visa_external auto-split + reconciliation alerts
--
-- Two safeguards against the bug we just fixed:
--
-- 1) BEFORE INSERT trigger on policy_payments that, for every
--    visa_external payment against an ELZAMI policy, enforces the
--    deterministic split rule:
--      • amount == insurance_price        → pass-through, no action
--      • amount == insurance_price + commission
--                                         → split into two rows:
--          - this row becomes amount=commission, payment_type='visa'
--            (ledger credit for the office's share)
--          - a sibling row is inserted with amount=insurance_price,
--            payment_type='visa_external' (the actual pass-through)
--      • any other amount                 → log to reconciliation_alerts
--          and let the row through untouched (don't guess; an
--          operator reviews via the alerts table)
--    Tolerance is ₪0.01 (the schema is numeric, this is a defensive
--    epsilon for rounding artifacts on imports).
--
-- 2) reconciliation_alerts table — a structured log the trigger and
--    the daily scan both write to. Used by the operator UI to surface
--    "X clients have suspect data" without spamming Postgres logs.
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reconciliation_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.policies(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.policy_payments(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_alerts_unresolved
  ON public.reconciliation_alerts (alert_type, created_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.reconciliation_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliation_alerts_select ON public.reconciliation_alerts;
CREATE POLICY reconciliation_alerts_select
  ON public.reconciliation_alerts
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = reconciliation_alerts.client_id
        AND c.agent_id = public.get_user_agent_id(auth.uid())
    )
  );

GRANT SELECT ON public.reconciliation_alerts TO authenticated;


CREATE OR REPLACE FUNCTION public.elzami_autosplit_passthrough()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_policy_type text;
  v_premium numeric;
  v_commission numeric;
  v_total numeric;
  v_tolerance numeric := 0.01;
  v_skip text;
  v_client_id uuid;
BEGIN
  -- Recursion guard: when this trigger inserts the sibling pass-through
  -- row, it sets app.elzami_autosplit_in_progress = 'true' so the
  -- second invocation skips the split logic.
  v_skip := current_setting('app.elzami_autosplit_in_progress', true);
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_type IS DISTINCT FROM 'visa_external' THEN
    RETURN NEW;
  END IF;

  SELECT
    p.policy_type_parent::text,
    COALESCE(p.insurance_price, 0),
    COALESCE(p.office_commission, 0),
    p.client_id
  INTO v_policy_type, v_premium, v_commission, v_client_id
  FROM public.policies p
  WHERE p.id = NEW.policy_id;

  IF v_policy_type IS DISTINCT FROM 'ELZAMI' THEN
    RETURN NEW;
  END IF;

  v_total := v_premium + v_commission;

  IF ABS(NEW.amount - v_premium) <= v_tolerance THEN
    RETURN NEW;
  END IF;

  IF v_commission > 0 AND ABS(NEW.amount - v_total) <= v_tolerance THEN
    PERFORM set_config('app.elzami_autosplit_in_progress', 'true', true);

    INSERT INTO public.policy_payments (
      agent_id, amount, bank_code, batch_id, branch_code, branch_id,
      cancellation_reason, card_expiry, card_last_four,
      cheque_date, cheque_due_date, cheque_image_url, cheque_issue_date,
      cheque_number, cheque_status, created_by_admin_id,
      installments_count, locked, notes, payment_date, payment_session_id,
      payment_type, policy_id, provider, refused, source,
      tranzila_approval_code, tranzila_index, tranzila_receipt_url,
      tranzila_response_code, tranzila_transaction_id
    ) VALUES (
      NEW.agent_id, v_premium, NEW.bank_code, NEW.batch_id, NEW.branch_code, NEW.branch_id,
      NEW.cancellation_reason, NEW.card_expiry, NEW.card_last_four,
      NEW.cheque_date, NEW.cheque_due_date, NEW.cheque_image_url, NEW.cheque_issue_date,
      NEW.cheque_number, NEW.cheque_status, NEW.created_by_admin_id,
      NEW.installments_count, NEW.locked, NEW.notes, NEW.payment_date, NEW.payment_session_id,
      'visa_external'::public.payment_type, NEW.policy_id, NEW.provider, NEW.refused, NEW.source,
      NEW.tranzila_approval_code, NEW.tranzila_index, NEW.tranzila_receipt_url,
      NEW.tranzila_response_code, NEW.tranzila_transaction_id
    );

    PERFORM set_config('app.elzami_autosplit_in_progress', 'false', true);

    NEW.amount := v_commission;
    NEW.payment_type := 'visa'::public.payment_type;
    RETURN NEW;
  END IF;

  INSERT INTO public.reconciliation_alerts (alert_type, client_id, policy_id, payload)
  VALUES (
    'elzami_visa_external_amount_mismatch',
    v_client_id,
    NEW.policy_id,
    jsonb_build_object(
      'amount', NEW.amount,
      'expected_premium', v_premium,
      'expected_total', v_total,
      'payment_date', NEW.payment_date,
      'source', NEW.source
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_elzami_autosplit_passthrough ON public.policy_payments;
CREATE TRIGGER trg_elzami_autosplit_passthrough
BEFORE INSERT ON public.policy_payments
FOR EACH ROW
EXECUTE FUNCTION public.elzami_autosplit_passthrough();


-- ────────────────────────────────────────────────────────────────
-- Daily reconciliation scan.
--
-- Sweeps every non-deleted, non-refused visa_external payment whose
-- linked policy is ELZAMI and whose amount falls outside the two
-- known good shapes (premium, or premium + commission). New findings
-- become reconciliation_alerts rows.
--
-- Deduplicated by payment_id — the same suspect row won't generate
-- a fresh alert every day.
--
-- Schedule via pg_cron from the Supabase dashboard (Database →
-- Extensions → pg_cron). One-liner:
--   SELECT cron.schedule('reconciliation-scan-daily', '0 3 * * *',
--     $$SELECT public.run_reconciliation_scan()$$);
-- We don't enable pg_cron from this migration so operators control
-- when the first run lands.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_reconciliation_scan()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted integer;
BEGIN
  WITH suspects AS (
    SELECT
      pp.id AS payment_id,
      p.client_id,
      pp.policy_id,
      pp.amount,
      COALESCE(p.insurance_price, 0) AS premium,
      COALESCE(p.office_commission, 0) AS commission,
      pp.payment_date,
      pp.source
    FROM public.policy_payments pp
    JOIN public.policies p ON p.id = pp.policy_id
    WHERE pp.payment_type = 'visa_external'
      AND p.policy_type_parent = 'ELZAMI'
      AND p.deleted_at IS NULL
      AND COALESCE(pp.refused, false) = false
      AND ABS(pp.amount - COALESCE(p.insurance_price, 0)) > 0.01
      AND ABS(pp.amount - (COALESCE(p.insurance_price, 0) + COALESCE(p.office_commission, 0))) > 0.01
  ),
  inserts AS (
    INSERT INTO public.reconciliation_alerts (alert_type, client_id, policy_id, payment_id, payload)
    SELECT
      'elzami_visa_external_amount_mismatch',
      s.client_id,
      s.policy_id,
      s.payment_id,
      jsonb_build_object(
        'amount', s.amount,
        'expected_premium', s.premium,
        'expected_total', s.premium + s.commission,
        'payment_date', s.payment_date,
        'source', s.source,
        'detected_by', 'daily_scan'
      )
    FROM suspects s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.reconciliation_alerts a
      WHERE a.payment_id = s.payment_id
        AND a.alert_type = 'elzami_visa_external_amount_mismatch'
        AND a.resolved_at IS NULL
    )
    RETURNING 1
  )
  SELECT COUNT(*)::integer INTO v_inserted FROM inserts;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_reconciliation_scan() TO authenticated;
