-- Add payment method fields to broker_settlements table
ALTER TABLE public.broker_settlements 
ADD COLUMN IF NOT EXISTS payment_type text DEFAULT 'cash',
ADD COLUMN IF NOT EXISTS cheque_number text,
ADD COLUMN IF NOT EXISTS cheque_image_url text,
ADD COLUMN IF NOT EXISTS bank_reference text,
ADD COLUMN IF NOT EXISTS refused boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS card_last_four text,
ADD COLUMN IF NOT EXISTS card_expiry text,
ADD COLUMN IF NOT EXISTS installments_count integer,
ADD COLUMN IF NOT EXISTS tranzila_transaction_id text,
ADD COLUMN IF NOT EXISTS tranzila_approval_code text;

-- Add constraint for payment_type values
ALTER TABLE public.broker_settlements 
DROP CONSTRAINT IF EXISTS broker_settlements_payment_type_check;

ALTER TABLE public.broker_settlements 
ADD CONSTRAINT broker_settlements_payment_type_check 
CHECK (payment_type IN ('cash', 'cheque', 'bank_transfer', 'visa'));

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_broker_settlements_broker_payment ON public.broker_settlements(broker_id, payment_type);
CREATE INDEX IF NOT EXISTS idx_broker_settlements_date ON public.broker_settlements(settlement_date DESC);