-- ============================================================
-- Module 1: Receipts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number serial,
  receipt_type text NOT NULL DEFAULT 'payment' CHECK (receipt_type IN ('payment', 'accident_fee')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('auto', 'manual')),
  client_name text,
  car_number text,
  amount numeric NOT NULL DEFAULT 0,
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text DEFAULT 'cash',
  cheque_number text,
  card_last_four text,
  notes text,
  payment_id uuid REFERENCES public.policy_payments(id) ON DELETE SET NULL,
  policy_id uuid REFERENCES public.policies(id) ON DELETE SET NULL,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_data_select" ON public.receipts FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()));
CREATE POLICY "agent_data_insert" ON public.receipts FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR agent_id IS NULL OR agent_id = public.get_my_agent_id());
CREATE POLICY "agent_data_update" ON public.receipts FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()));
CREATE POLICY "agent_data_delete" ON public.receipts FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()));

CREATE INDEX idx_receipts_agent ON public.receipts(agent_id, receipt_date DESC);
CREATE INDEX idx_receipts_payment ON public.receipts(payment_id);

-- ============================================================
-- Module 3: Renewal Followups
-- ============================================================

CREATE TABLE IF NOT EXISTS public.renewal_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  follow_up_month text NOT NULL, -- 'YYYY-MM'
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'renewed', 'declined_renewal')),
  decline_reason text,
  updated_by uuid REFERENCES auth.users(id),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(client_id, follow_up_month)
);

ALTER TABLE public.renewal_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_data_select" ON public.renewal_followups FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()));
CREATE POLICY "agent_data_insert" ON public.renewal_followups FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR agent_id IS NULL OR agent_id = public.get_my_agent_id());
CREATE POLICY "agent_data_update" ON public.renewal_followups FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()));
CREATE POLICY "agent_data_delete" ON public.renewal_followups FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = public.get_my_agent_id()));

CREATE INDEX idx_renewal_followups_agent ON public.renewal_followups(agent_id, follow_up_month);
CREATE INDEX idx_renewal_followups_client ON public.renewal_followups(client_id);

-- Add voucher_type and entity_type to expenses if missing
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS voucher_type text DEFAULT 'payment';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS entity_type text DEFAULT 'manual';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'cash';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS reference_number text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.insurance_companies(id);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS broker_id uuid REFERENCES public.brokers(id);
