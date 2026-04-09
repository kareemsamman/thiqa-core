-- Create payment_settings table for Tranzila configuration
CREATE TABLE public.payment_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL DEFAULT 'tranzila',
  terminal_name text,
  api_password text,
  success_url text,
  fail_url text,
  notify_url text,
  is_enabled boolean NOT NULL DEFAULT false,
  test_mode boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payment_settings_provider_unique UNIQUE (provider)
);

-- Add Tranzila transaction tracking columns to policy_payments
ALTER TABLE public.policy_payments
ADD COLUMN IF NOT EXISTS tranzila_transaction_id text,
ADD COLUMN IF NOT EXISTS tranzila_approval_code text,
ADD COLUMN IF NOT EXISTS tranzila_response_code text,
ADD COLUMN IF NOT EXISTS tranzila_index text,
ADD COLUMN IF NOT EXISTS provider text DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS created_by_admin_id uuid REFERENCES profiles(id);

-- Create index for transaction lookups
CREATE INDEX IF NOT EXISTS idx_policy_payments_tranzila_index ON public.policy_payments(tranzila_index);

-- Enable RLS
ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage payment settings
CREATE POLICY "Admins can view payment settings"
ON public.payment_settings
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage payment settings"
ON public.payment_settings
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for updated_at
CREATE TRIGGER update_payment_settings_updated_at
BEFORE UPDATE ON public.payment_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default Tranzila settings row
INSERT INTO public.payment_settings (provider, is_enabled, test_mode)
VALUES ('tranzila', false, true)
ON CONFLICT (provider) DO NOTHING;