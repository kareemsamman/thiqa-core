-- Invoice-specific contact info shown in the agent's invoices.
-- Kept separate from sms_settings.company_phones so agents can
-- display a different "billing address" set from their SMS sender.
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS invoice_phones TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS invoice_address TEXT;
