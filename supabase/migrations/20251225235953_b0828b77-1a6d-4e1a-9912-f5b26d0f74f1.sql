-- Add elzami_commission column to insurance_companies table
-- This stores the commission amount for ELZAMI companies (can be negative)
ALTER TABLE public.insurance_companies 
ADD COLUMN IF NOT EXISTS elzami_commission numeric DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN public.insurance_companies.elzami_commission IS 'Commission for ELZAMI insurance type. Can be negative. Used as profit for ELZAMI policies.';