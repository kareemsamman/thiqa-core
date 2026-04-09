-- Drop the existing check constraint
ALTER TABLE public.policy_payments DROP CONSTRAINT IF EXISTS policy_payments_cheque_status_check;

-- Add the updated check constraint that includes 'transferred_out'
ALTER TABLE public.policy_payments ADD CONSTRAINT policy_payments_cheque_status_check 
CHECK (cheque_status = ANY (ARRAY['pending'::text, 'cashed'::text, 'returned'::text, 'cancelled'::text, 'transferred_out'::text]));