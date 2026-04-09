-- Create policy_transfers table for audit trail
CREATE TABLE public.policy_transfers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  from_car_id UUID NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  to_car_id UUID NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  adjustment_type TEXT, -- 'none', 'customer_pays', 'refund'
  adjustment_amount NUMERIC,
  created_by_admin_id UUID REFERENCES public.profiles(id),
  branch_id UUID REFERENCES public.branches(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.policy_transfers ENABLE ROW LEVEL SECURITY;

-- RLS policies for branch users
CREATE POLICY "Branch users can view policy transfers"
ON public.policy_transfers
FOR SELECT
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can create policy transfers"
ON public.policy_transfers
FOR INSERT
WITH CHECK (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Add index for faster lookups
CREATE INDEX idx_policy_transfers_policy_id ON public.policy_transfers(policy_id);
CREATE INDEX idx_policy_transfers_client_id ON public.policy_transfers(client_id);