-- Add template_layout_json column to store visual builder data
ALTER TABLE public.invoice_templates 
ADD COLUMN IF NOT EXISTS template_layout_json jsonb DEFAULT '[]'::jsonb;

-- Add pdf_url to invoices if not exists (for actual PDF files)
-- Also add template_version_used to track which version was used
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS template_version_used integer DEFAULT 1;