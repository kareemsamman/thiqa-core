-- Add batch_id column to policy_payments for grouping related payments
ALTER TABLE policy_payments ADD COLUMN batch_id UUID DEFAULT NULL;

-- Create index for efficient batch lookups
CREATE INDEX idx_payments_batch_id ON policy_payments(batch_id);