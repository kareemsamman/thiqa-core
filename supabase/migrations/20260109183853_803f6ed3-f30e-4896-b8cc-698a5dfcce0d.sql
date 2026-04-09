-- Add new_policy_id column to track the new policy created during transfer
ALTER TABLE public.policy_transfers 
ADD COLUMN IF NOT EXISTS new_policy_id UUID REFERENCES public.policies(id);

-- Add transferred_from_policy_id to policies to track the source policy
ALTER TABLE public.policies 
ADD COLUMN IF NOT EXISTS transferred_from_policy_id UUID REFERENCES public.policies(id);

-- Add transferred_to_car_number to show where policy was transferred to (for the old policy)
ALTER TABLE public.policies 
ADD COLUMN IF NOT EXISTS transferred_to_car_number TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_policies_transferred_from ON public.policies(transferred_from_policy_id) WHERE transferred_from_policy_id IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.policy_transfers.new_policy_id IS 'The new policy created as a result of the transfer';
COMMENT ON COLUMN public.policies.transferred_from_policy_id IS 'If this policy was created via transfer, references the original policy';
COMMENT ON COLUMN public.policies.transferred_to_car_number IS 'For transferred policies, the car number it was transferred TO';