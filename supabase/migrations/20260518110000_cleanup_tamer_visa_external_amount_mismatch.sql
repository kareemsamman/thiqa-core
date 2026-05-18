-- ────────────────────────────────────────────────────────────────
-- Follow-up cleanup for Tamer Asali's account.
--
-- The previous cleanup (20260518100000) used a date cutoff of
-- 2026-05-16 on the assumption that the elzami_autosplit trigger
-- would prevent new bad rows. That's not enough — the trigger
-- silently logs an alert and lets the row through when the amount
-- matches neither `insurance_price` nor `insurance_price+commission`.
-- New visa_external rows on ELZAMI with arbitrary amounts (e.g.,
-- 4,600 inserted against a policy whose premium is 1,564) still
-- end up as "log-only" entries excluded from total_paid.
--
-- Better criterion: delete visa_external rows on ELZAMI where the
-- amount does NOT match the policy's insurance_price (tolerance
-- ±0.01). This preserves legitimate pass-throughs (amount equals
-- premium — the customer paid the company directly) and clears the
-- mistaken entries that confuse the agent.
--
-- Idempotent (matches nothing on a second run). Same safety rails:
-- scoped to Tamer's agent_id, never touches a row linked to a
-- receipts voucher.
-- ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_agent_id uuid;
  v_deleted_count int;
  v_tolerance numeric := 0.01;
BEGIN
  SELECT p.agent_id INTO v_agent_id
  FROM public.profiles p
  WHERE p.email = 'tamerasali86@gmail.com'
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RAISE NOTICE 'cleanup_tamer_visa_external_amount_mismatch: profile not found, skipping';
    RETURN;
  END IF;

  WITH deleted AS (
    DELETE FROM public.policy_payments pp
    USING public.policies pol
    WHERE pp.policy_id = pol.id
      AND pol.agent_id = v_agent_id
      AND pp.payment_type = 'visa_external'
      AND pol.policy_type_parent = 'ELZAMI'
      AND ABS(COALESCE(pp.amount, 0) - COALESCE(pol.insurance_price, 0)) > v_tolerance
      AND NOT EXISTS (
        SELECT 1 FROM public.receipts r WHERE r.payment_id = pp.id
      )
    RETURNING pp.id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;

  RAISE NOTICE 'cleanup_tamer_visa_external_amount_mismatch: deleted % rows for agent %',
    v_deleted_count, v_agent_id;
END;
$$;
