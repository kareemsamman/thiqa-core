-- Add columns to store Tranzila card details and installments
ALTER TABLE public.policy_payments 
ADD COLUMN IF NOT EXISTS card_last_four text,
ADD COLUMN IF NOT EXISTS card_expiry text,
ADD COLUMN IF NOT EXISTS installments_count integer,
ADD COLUMN IF NOT EXISTS tranzila_receipt_url text;