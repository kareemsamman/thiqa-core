-- Broker Wallet/Settlement System

-- Table for broker settlement invoices (تسويات الوسطاء)
CREATE TABLE public.broker_settlements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  broker_id uuid NOT NULL REFERENCES public.brokers(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  
  -- Direction: "we_owe" = we owe broker, "broker_owes" = broker owes us
  direction text NOT NULL CHECK (direction IN ('we_owe', 'broker_owes')),
  
  -- Total amount of this settlement
  total_amount numeric NOT NULL DEFAULT 0,
  
  -- Settlement reference (like invoice number)
  settlement_number text,
  settlement_date date NOT NULL DEFAULT CURRENT_DATE,
  
  -- Status
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'completed')),
  
  notes text,
  created_by_admin_id uuid REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table for settlement line items (allocation to policies)
CREATE TABLE public.broker_settlement_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  settlement_id uuid NOT NULL REFERENCES public.broker_settlements(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES public.policies(id) ON DELETE RESTRICT,
  
  -- Amount allocated to this policy
  amount numeric NOT NULL DEFAULT 0,
  
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.broker_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_settlement_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for broker_settlements
CREATE POLICY "Branch users can view broker settlements"
  ON public.broker_settlements
  FOR SELECT
  USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can manage broker settlements"
  ON public.broker_settlements
  FOR ALL
  USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- RLS Policies for broker_settlement_items
CREATE POLICY "Branch users can view settlement items"
  ON public.broker_settlement_items
  FOR SELECT
  USING (is_active_user(auth.uid()) AND EXISTS (
    SELECT 1 FROM broker_settlements bs WHERE bs.id = settlement_id AND can_access_branch(auth.uid(), bs.branch_id)
  ));

CREATE POLICY "Branch users can manage settlement items"
  ON public.broker_settlement_items
  FOR ALL
  USING (is_active_user(auth.uid()) AND EXISTS (
    SELECT 1 FROM broker_settlements bs WHERE bs.id = settlement_id AND can_access_branch(auth.uid(), bs.branch_id)
  ));

-- Indexes
CREATE INDEX idx_broker_settlements_broker_id ON public.broker_settlements(broker_id);
CREATE INDEX idx_broker_settlements_branch_id ON public.broker_settlements(branch_id);
CREATE INDEX idx_broker_settlements_status ON public.broker_settlements(status);
CREATE INDEX idx_broker_settlement_items_settlement_id ON public.broker_settlement_items(settlement_id);
CREATE INDEX idx_broker_settlement_items_policy_id ON public.broker_settlement_items(policy_id);

-- Trigger for updated_at
CREATE TRIGGER update_broker_settlements_updated_at
  BEFORE UPDATE ON public.broker_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();