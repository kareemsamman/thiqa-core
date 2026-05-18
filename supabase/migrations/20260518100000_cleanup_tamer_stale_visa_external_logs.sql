-- ────────────────────────────────────────────────────────────────
-- One-shot cleanup: stale visa_external rows on Tamer Asali's
-- pre-trigger ELZAMI policies.
--
-- Context: before 20260516140000 (the elzami_autosplit trigger),
-- visa_external payments could be inserted on ELZAMI policies at
-- arbitrary amounts. Per get_client_balance these rows are excluded
-- from total_paid (visa_external + ELZAMI + commission<=0 is
-- pass-through, money never reaches the office) — so they appear in
-- the سجل الدفعات tab but don't reduce the debt or count as income.
-- The agent sees confusing "log-only" entries that don't add up.
--
-- Per the agent (Tamer): wipe ONLY these log-only rows for his
-- account so the payment log is clean; he'll re-enter the real
-- collected payments manually. New transactions (post-2026-05-16)
-- are protected by the trigger and the date cutoff.
--
-- Safety rails:
--   • Scoped strictly to the agent_id resolved from his email.
--   • Date cutoff < 2026-05-16 — never touches post-trigger rows.
--   • Skip any payment that has a receipts row pointing at it
--     (سند قبض وثيقة مجمّدة — never orphan a printed voucher).
--   • Packages, policies, receipts, vouchers, payment_receipts are
--     NOT touched. Only individual policy_payments rows.
-- ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_agent_id uuid;
  v_deleted_count int;
BEGIN
  SELECT p.agent_id INTO v_agent_id
  FROM public.profiles p
  WHERE p.email = 'tamerasali86@gmail.com'
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RAISE NOTICE 'cleanup_tamer_stale_visa_external_logs: profile not found, skipping';
    RETURN;
  END IF;

  WITH deleted AS (
    DELETE FROM public.policy_payments pp
    USING public.policies pol
    WHERE pp.policy_id = pol.id
      AND pol.agent_id = v_agent_id
      AND pp.payment_type = 'visa_external'
      AND pol.policy_type_parent = 'ELZAMI'
      AND pol.created_at < '2026-05-16'::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM public.receipts r WHERE r.payment_id = pp.id
      )
    RETURNING pp.id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;

  RAISE NOTICE 'cleanup_tamer_stale_visa_external_logs: deleted % rows for agent %',
    v_deleted_count, v_agent_id;
END;
$$;
