-- ============================================================
-- Phase 2b — client_settlements (سند صرف للعميل)
--
-- Mirrors company_settlements / broker_settlements for clients on
-- the receiving side of a refund. One row per payment-line within a
-- disbursement event (cash, cheque, transfer, visa, customer cheque),
-- same as the other two settlement tables — multiple methods for one
-- refund land as multiple rows that the UI groups by session_id.
--
-- A separate table (vs. writing straight into receipts) buys us:
--   • the cheque columns (bank_code, branch_code, cheque_due_date,
--     cheque_issue_date, cheque_image_urls) without bloating receipts
--   • a place for customer_cheque_ids when the agent settles by
--     handing the client one of his own cheques back
--   • an audit row that survives even if the receipts mirror has to
--     be rebuilt
--
-- The next migration adds the AFTER INSERT trigger that allocates a
-- D{nn}/{year} voucher number AND creates the mirrored receipts row
-- of type 'disbursement'.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.client_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The customer the agency is paying. RESTRICT so a client with
  -- live disbursements can't be hard-deleted; soft-delete via
  -- clients.deleted_at instead.
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,

  -- Optional: the policy that triggered this disbursement (cancel
  -- or transfer flow). NULL for standalone manual disbursements.
  policy_id UUID REFERENCES public.policies(id) ON DELETE SET NULL,

  total_amount NUMERIC NOT NULL DEFAULT 0,
  settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_type TEXT NOT NULL DEFAULT 'cash',

  -- Cheque-line columns (NULL for non-cheque rows).
  cheque_number TEXT,
  bank_code TEXT,
  branch_code TEXT,
  cheque_image_url TEXT,
  cheque_image_urls TEXT[] DEFAULT '{}',
  cheque_due_date DATE,
  cheque_issue_date DATE,

  bank_reference TEXT,                  -- bank transfer reference number
  card_last_four TEXT,                  -- visa
  card_expiry TEXT,

  -- Settling by handing back one of the client's own cheques the
  -- agent is holding. The cheque ids come from policy_payments
  -- (same flow as company/broker settlements).
  customer_cheque_ids UUID[] DEFAULT '{}',

  notes TEXT,

  -- One UUID stamped per disbursement event groups the lines (cash
  -- 200 + cheque 300 = one settlement_session_id). The UI uses it
  -- to fold the lines back into one row on /receipts → سند صرف.
  -- Allocated client-side at insert time.
  settlement_session_id UUID,

  -- D{nn}/{year} stamped by the BEFORE INSERT trigger in the next
  -- migration. All lines that share a settlement_session_id also
  -- share a voucher_number (one document, multiple methods).
  voucher_number TEXT,

  status TEXT NOT NULL DEFAULT 'completed',
  refused BOOLEAN DEFAULT false,

  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id),
  created_by_admin_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_settlements_client_idx
  ON public.client_settlements (client_id);
CREATE INDEX IF NOT EXISTS client_settlements_agent_idx
  ON public.client_settlements (agent_id, settlement_date DESC);
CREATE INDEX IF NOT EXISTS client_settlements_session_idx
  ON public.client_settlements (settlement_session_id)
  WHERE settlement_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_settlements_voucher_per_agent_idx
  ON public.client_settlements (agent_id, voucher_number)
  WHERE voucher_number IS NOT NULL;

ALTER TABLE public.client_settlements ENABLE ROW LEVEL SECURITY;

-- RLS mirrors company_settlements: active users with branch access
-- can read and write their own branch's rows. Admin override comes
-- via is_active_user + branch helpers, same pattern as the rest of
-- the app's tables.
DROP POLICY IF EXISTS "Branch users can view client settlements"
  ON public.client_settlements;
CREATE POLICY "Branch users can view client settlements"
  ON public.client_settlements FOR SELECT
  USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can manage client settlements"
  ON public.client_settlements;
CREATE POLICY "Branch users can manage client settlements"
  ON public.client_settlements FOR ALL
  USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- updated_at maintenance — reuse the project's existing helper.
DROP TRIGGER IF EXISTS update_client_settlements_updated_at
  ON public.client_settlements;
CREATE TRIGGER update_client_settlements_updated_at
  BEFORE UPDATE ON public.client_settlements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
