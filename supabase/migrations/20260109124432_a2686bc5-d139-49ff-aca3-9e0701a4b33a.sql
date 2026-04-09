-- Add broker_buy_price column to policies table
ALTER TABLE public.policies 
ADD COLUMN IF NOT EXISTS broker_buy_price numeric DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN public.policies.broker_buy_price IS 'Price paid to broker when policy comes from a broker-linked company. Profit = insurance_price - broker_buy_price';

-- Create an index for better query performance on broker-related policies
CREATE INDEX IF NOT EXISTS idx_policies_broker_buy_price ON public.policies (broker_id) WHERE broker_buy_price > 0;