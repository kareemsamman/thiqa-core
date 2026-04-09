-- Add broker_id to clients table (source of truth)
ALTER TABLE public.clients 
ADD COLUMN broker_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL;

-- Add broker_id to policies table (for fast queries)
ALTER TABLE public.policies 
ADD COLUMN broker_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL;

-- Create indexes for performance
CREATE INDEX idx_clients_broker_id ON public.clients(broker_id);
CREATE INDEX idx_policies_broker_id ON public.policies(broker_id);

-- Add image_url and notes to brokers table
ALTER TABLE public.brokers 
ADD COLUMN image_url text,
ADD COLUMN notes text;

-- Add status column to policy_payments for cheque tracking
ALTER TABLE public.policy_payments 
ADD COLUMN cheque_status text CHECK (cheque_status IN ('pending', 'cashed', 'returned', 'cancelled')) DEFAULT 'pending';