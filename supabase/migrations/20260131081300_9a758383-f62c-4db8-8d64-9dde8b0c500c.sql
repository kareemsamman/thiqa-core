-- Add car_id and payment_method to customer_wallet_transactions for manual refunds
ALTER TABLE customer_wallet_transactions 
ADD COLUMN IF NOT EXISTS car_id UUID REFERENCES cars(id) ON DELETE SET NULL;

ALTER TABLE customer_wallet_transactions 
ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';

ALTER TABLE customer_wallet_transactions 
ADD COLUMN IF NOT EXISTS refund_date DATE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_customer_wallet_transactions_car_id 
ON customer_wallet_transactions(car_id);

CREATE INDEX IF NOT EXISTS idx_customer_wallet_transactions_client_id 
ON customer_wallet_transactions(client_id);

-- Add comment for documentation
COMMENT ON COLUMN customer_wallet_transactions.car_id IS 'Reference to the car this refund is associated with';
COMMENT ON COLUMN customer_wallet_transactions.payment_method IS 'Payment method: cash, transfer';
COMMENT ON COLUMN customer_wallet_transactions.refund_date IS 'Date when the refund was made to the customer';