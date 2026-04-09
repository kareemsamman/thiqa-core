-- Add broker_id to insurance_companies for automatic broker detection
ALTER TABLE public.insurance_companies 
ADD COLUMN IF NOT EXISTS broker_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_insurance_companies_broker_id ON public.insurance_companies(broker_id);

-- Comment explaining the field
COMMENT ON COLUMN public.insurance_companies.broker_id IS 'If set, this company is linked to a broker - policies with this company auto-detect broker direction as from_broker';