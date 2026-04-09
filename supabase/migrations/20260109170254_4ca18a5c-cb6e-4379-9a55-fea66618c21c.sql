-- Add accident_fee_service_id column to policies table
ALTER TABLE public.policies 
ADD COLUMN IF NOT EXISTS accident_fee_service_id uuid REFERENCES public.accident_fee_services(id);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_policies_accident_fee_service_id ON public.policies(accident_fee_service_id);