-- ─────────────────────────────────────────────────────────────
-- receipts.broker_id + broker_settlement_id — mirror broker
-- vouchers into the receipts table so they surface on /receipts
-- ─────────────────────────────────────────────────────────────
--
-- Until now broker_settlements stayed inside the accounting page
-- (BrokersSection tabs). The user wants every voucher — including
-- broker قبض/صرف — to appear in the central إدارة الإيصالات list
-- the moment it's saved, with the same print/SMS/WhatsApp affordance
-- the customer vouchers have.
--
-- We add two nullable columns to receipts so a broker mirror row can
-- point back at:
--   • the broker entity (broker_id)
--   • the first broker_settlements row it was created from
--     (broker_settlement_id) — multi-line saves still produce ONE
--     receipt row, anchored to the first line for traceability
--
-- The application layer (persistSettlementLines) does the insert
-- — no trigger here, on purpose. The existing client_settlements
-- → receipts trigger is heavy and pulls in policy joins that don't
-- exist for brokers; doing it in code keeps the broker path simple
-- and decoupled.
--
-- Both columns are NULLABLE so every existing receipts row (and
-- every future customer-side receipt) stays valid.

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS broker_id UUID REFERENCES public.brokers(id) ON DELETE SET NULL;

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS broker_settlement_id UUID REFERENCES public.broker_settlements(id) ON DELETE SET NULL;

-- Index for the common access pattern: "list all receipts for this
-- broker". Partial index on broker_id IS NOT NULL keeps it tiny
-- (customer receipts are the vast majority — they don't pay for
-- index space here).
CREATE INDEX IF NOT EXISTS receipts_broker_id_idx
  ON public.receipts (broker_id, created_at DESC)
  WHERE broker_id IS NOT NULL;

COMMENT ON COLUMN public.receipts.broker_id IS
  'When set, this receipt is a broker voucher mirror (سند قبض/صرف لوسيط). Customer receipts leave this NULL.';

COMMENT ON COLUMN public.receipts.broker_settlement_id IS
  'FK to the first broker_settlements row that produced this receipt. Multi-line saves anchor to the first line; the rest are reachable via the broker_id + created_at window.';
