-- ============================================================
-- Phase 1a — Credit Note / Disbursement schema
--
-- Two new receipt categories, parallel to the existing سند قبض /
-- سند إلغاء family:
--
--   • credit_note (اشعار دائن) — the agency owes the client. Mirrors
--     the existing customer_wallet_transactions refund flow but adds
--     a numbered voucher so it can be printed and shown alongside
--     سندات القبض. The wallet balance keeps doing the heavy lifting;
--     this new row is the formal document.
--
--   • disbursement (سند صرف) — actual money out of the agency's pocket
--     to the client. Does NOT increase wallet balance. Mirrors the
--     existing company_settlements / broker_settlements "outgoing"
--     pattern but for clients.
--
-- This migration is purely additive: new CHECK values, new nullable
-- columns. No existing rows change. No triggers added yet — that
-- comes in 20260513100200 once the allocator functions are in place
-- and we're ready to wire backfill + auto-creation.
-- ============================================================

-- ── 1. Extend receipts.receipt_type ─────────────────────────────────
-- Existing values were ('payment', 'accident_fee', 'cancellation');
-- add the two new categories.
ALTER TABLE public.receipts
  DROP CONSTRAINT IF EXISTS receipts_receipt_type_check;
ALTER TABLE public.receipts
  ADD CONSTRAINT receipts_receipt_type_check
    CHECK (receipt_type IN (
      'payment',
      'accident_fee',
      'cancellation',
      'credit_note',
      'disbursement'
    ));

-- ── 2. Voucher number + client link + wallet link on receipts ───────
-- voucher_number holds the formatted "C12/2026" / "D12/2026" string
-- for the new types. Existing payment/cancellation rows keep using
-- the integer receipt_number column the way they do today — the UI
-- helper formatReceiptNumber() already renders that as R{n}/{year}.
-- Splitting the two numbering schemes keeps the existing rows from
-- having to be backfilled into a shared text column.
--
-- client_id makes the link explicit. Today receipts only knows about
-- the client through policy → clients, which is awkward when the
-- receipt isn't tied to any single policy (e.g. a credit note that
-- covers a cancelled package or a one-off disbursement).
--
-- wallet_transaction_id is the FK back to the wallet entry a credit
-- note documents. Disbursements don't touch the wallet so it stays
-- NULL for those.
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS voucher_number text,
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_transaction_id uuid REFERENCES public.customer_wallet_transactions(id) ON DELETE SET NULL;

-- voucher_number must be unique per agent per year per kind so two
-- credit notes can't share C12/2026. We don't enforce a check here —
-- the allocator owns generation — but a btree index speeds up search
-- and partial uniqueness prevents accidental duplicates from the
-- backfill or any future manual insert.
CREATE UNIQUE INDEX IF NOT EXISTS receipts_voucher_number_per_agent_idx
  ON public.receipts (agent_id, voucher_number)
  WHERE voucher_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS receipts_client_id_idx
  ON public.receipts (client_id)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS receipts_wallet_transaction_id_idx
  ON public.receipts (wallet_transaction_id)
  WHERE wallet_transaction_id IS NOT NULL;

-- ── 3. Extend document_sequences.kind ───────────────────────────────
-- The shared per-agent-per-year counter table now also tracks
-- credit_note and disbursement sequences. CHECK constraint mirrors
-- the additions on receipts.receipt_type so the kinds line up.
ALTER TABLE public.document_sequences
  DROP CONSTRAINT IF EXISTS document_sequences_kind_check;
ALTER TABLE public.document_sequences
  ADD CONSTRAINT document_sequences_kind_check
    CHECK (kind IN ('policy', 'receipt', 'credit_note', 'disbursement'));

-- allocate_document_number's body whitelist also needs the new kinds,
-- otherwise it would reject them with "invalid document kind". We
-- replace the function in place (CREATE OR REPLACE keeps GRANTs and
-- dependent triggers wired up).
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
  IF p_kind NOT IN ('policy', 'receipt', 'credit_note', 'disbursement') THEN
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
