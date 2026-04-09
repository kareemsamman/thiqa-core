-- Add column to store customer cheque payment IDs used in settlements
ALTER TABLE public.company_settlements 
ADD COLUMN IF NOT EXISTS customer_cheque_ids jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.broker_settlements 
ADD COLUMN IF NOT EXISTS customer_cheque_ids jsonb DEFAULT '[]'::jsonb;

-- Add comments for clarity
COMMENT ON COLUMN public.company_settlements.customer_cheque_ids IS 'Array of policy_payment IDs when payment_type is customer_cheque';
COMMENT ON COLUMN public.broker_settlements.customer_cheque_ids IS 'Array of policy_payment IDs when payment_type is customer_cheque';