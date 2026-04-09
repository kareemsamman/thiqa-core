-- Add calc_status field to policies for tracking background processing
ALTER TABLE public.policies 
ADD COLUMN IF NOT EXISTS calc_status text DEFAULT 'done' CHECK (calc_status IN ('pending', 'done', 'error'));

-- Create index for calc_status queries
CREATE INDEX IF NOT EXISTS idx_policies_calc_status ON public.policies(calc_status) WHERE calc_status = 'pending';