-- Add SMS message templates settings to sms_settings
ALTER TABLE public.sms_settings 
ADD COLUMN IF NOT EXISTS invoice_sms_template TEXT DEFAULT 'مرحباً {{client_name}}، تم إصدار فواتير وثيقة التأمين رقم {{policy_number}}. فاتورة AB: {{ab_invoice_url}} فاتورة شركة التأمين: {{insurance_invoice_url}}';

-- Add default invoice template IDs to sms_settings
ALTER TABLE public.sms_settings 
ADD COLUMN IF NOT EXISTS default_ab_invoice_template_id UUID REFERENCES public.invoice_templates(id),
ADD COLUMN IF NOT EXISTS default_insurance_invoice_template_id UUID REFERENCES public.invoice_templates(id),
ADD COLUMN IF NOT EXISTS default_signature_template_id UUID REFERENCES public.invoice_templates(id),
ADD COLUMN IF NOT EXISTS signature_sms_template TEXT DEFAULT 'مرحباً {{client_name}}، يرجى التوقيع على الرابط التالي: {{signature_url}}';

-- Add signature-related columns to customer_signatures
ALTER TABLE public.customer_signatures 
ADD COLUMN IF NOT EXISTS policy_id UUID REFERENCES public.policies(id);

-- Create index on customer_signatures for policy_id
CREATE INDEX IF NOT EXISTS idx_customer_signatures_policy_id ON public.customer_signatures(policy_id);