-- Add transfer tracking columns to outside_cheques
ALTER TABLE outside_cheques 
ADD COLUMN IF NOT EXISTS transferred_to_type text,
ADD COLUMN IF NOT EXISTS transferred_to_id uuid,
ADD COLUMN IF NOT EXISTS transferred_payment_id uuid,
ADD COLUMN IF NOT EXISTS transferred_at timestamp with time zone;

-- Add similar columns to policy_payments (customer cheques)
ALTER TABLE policy_payments 
ADD COLUMN IF NOT EXISTS transferred_to_type text,
ADD COLUMN IF NOT EXISTS transferred_to_id uuid,
ADD COLUMN IF NOT EXISTS transferred_payment_id uuid,
ADD COLUMN IF NOT EXISTS transferred_at timestamp with time zone;

-- Add receipt support to broker_settlements
ALTER TABLE broker_settlements
ADD COLUMN IF NOT EXISTS receipt_images jsonb DEFAULT '[]'::jsonb;

-- Add similar to company_settlements
ALTER TABLE company_settlements
ADD COLUMN IF NOT EXISTS receipt_images jsonb DEFAULT '[]'::jsonb;

-- Add index for quick cheque lookup by status
CREATE INDEX IF NOT EXISTS idx_policy_payments_cheque_status ON policy_payments(cheque_status) WHERE payment_type = 'cheque';
CREATE INDEX IF NOT EXISTS idx_outside_cheques_status ON outside_cheques(used, refused);
CREATE INDEX IF NOT EXISTS idx_policy_payments_transferred ON policy_payments(transferred_to_type, transferred_to_id) WHERE transferred_to_type IS NOT NULL;