-- Invoice-specific branding fields shown in agent invoices.
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS tax_number TEXT,
  ADD COLUMN IF NOT EXISTS invoice_privacy_text TEXT;
