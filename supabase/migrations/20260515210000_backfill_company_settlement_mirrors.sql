-- ─────────────────────────────────────────────────────────────
-- Backfill receipts mirrors for pre-trigger company_settlements
-- ─────────────────────────────────────────────────────────────
--
-- The mirror trigger in 20260514170000_receipts_company_mirror.sql
-- runs on INSERT only — rows created before that migration never
-- produced a /receipts mirror, so:
--   • the accounting page renders "تسوية" instead of a voucher number
--   • ReceiptActionsDialog can't print/send (no receipts.id to feed
--     generate-voucher / send-voucher), so clicking on those rows
--     toasts "السند غير متوفر للطباعة/الإرسال"
--
-- Two-step backfill mirrors exactly what the BEFORE / AFTER INSERT
-- triggers do for live rows: allocate voucher_number for outgoing
-- rows that lack one, then INSERT a mirror for every settlement that
-- doesn't have one yet. Refused-on-creation rows stay out of the
-- mirror (matches the trigger's IF COALESCE(NEW.refused, false) skip).

-- Step 1: allocate D{nn}/{year} for outgoing rows missing voucher_number.
-- Uses the same allocate_disbursement_number RPC the BEFORE INSERT
-- trigger uses; per-agent + per-year sequence keeps numbering monotonic.
DO $$
DECLARE
  rec RECORD;
  v_year INT;
BEGIN
  FOR rec IN
    SELECT id, agent_id, settlement_date
    FROM public.company_settlements
    WHERE direction = 'outgoing'
      AND voucher_number IS NULL
      AND agent_id IS NOT NULL
  LOOP
    v_year := EXTRACT(YEAR FROM COALESCE(rec.settlement_date, CURRENT_DATE))::INT;
    UPDATE public.company_settlements
    SET voucher_number = public.allocate_disbursement_number(rec.agent_id, v_year)
    WHERE id = rec.id;
  END LOOP;
END $$;

-- Step 2: INSERT mirrors. Body matches the AFTER INSERT trigger 1:1
-- (same column mapping, same payment_type → payment_method translation)
-- so the rows the backfill produces are indistinguishable from rows
-- the trigger would produce going forward.
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
SELECT
  CASE cs.direction WHEN 'outgoing' THEN 'disbursement' ELSE 'payment' END,
  'auto',
  cs.voucher_number,
  cs.company_id,
  cs.id,
  COALESCE(ic.name_ar, ic.name),
  cs.total_amount,
  cs.settlement_date,
  CASE cs.payment_type
    WHEN 'bank_transfer' THEN 'transfer'
    WHEN 'customer_cheque' THEN 'cheque'
    ELSE cs.payment_type
  END,
  cs.cheque_number,
  cs.card_last_four,
  cs.notes,
  cs.agent_id,
  cs.branch_id,
  cs.created_by_admin_id
FROM public.company_settlements cs
LEFT JOIN public.insurance_companies ic ON ic.id = cs.company_id
WHERE cs.agent_id IS NOT NULL
  AND COALESCE(cs.refused, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM public.receipts r WHERE r.company_settlement_id = cs.id
  );
