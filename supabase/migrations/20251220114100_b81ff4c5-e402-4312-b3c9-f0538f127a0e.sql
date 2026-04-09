-- Add policy_number column to policies table
ALTER TABLE public.policies
ADD COLUMN IF NOT EXISTS policy_number text;

-- Create index for fast policy number search
CREATE INDEX IF NOT EXISTS idx_policies_policy_number ON public.policies(policy_number)
WHERE policy_number IS NOT NULL;

-- Add full-text search index for faster searching
CREATE INDEX IF NOT EXISTS idx_policies_policy_number_gin ON public.policies
USING gin(to_tsvector('simple', COALESCE(policy_number, '')));

-- Add invoice_sent_at column to track when invoices were sent
ALTER TABLE public.policies
ADD COLUMN IF NOT EXISTS invoices_sent_at timestamp with time zone;