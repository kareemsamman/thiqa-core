-- Add created_by_admin_id to policies table
ALTER TABLE public.policies 
ADD COLUMN IF NOT EXISTS created_by_admin_id uuid REFERENCES public.profiles(id);

-- Create invoice_templates table
CREATE TABLE public.invoice_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  language text NOT NULL CHECK (language IN ('ar', 'he', 'both')),
  direction text NOT NULL DEFAULT 'rtl' CHECK (direction IN ('rtl', 'ltr')),
  logo_url text,
  header_html text,
  body_html text,
  footer_html text,
  is_active boolean DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_by_admin_id uuid REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create invoices table
CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number text NOT NULL UNIQUE,
  policy_id uuid NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.invoice_templates(id),
  language text NOT NULL CHECK (language IN ('ar', 'he')),
  issued_at timestamp with time zone NOT NULL DEFAULT now(),
  pdf_url text,
  created_by_admin_id uuid REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'generated', 'failed', 'regenerated')),
  metadata_json jsonb,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_invoices_policy_id ON public.invoices(policy_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_invoices_language ON public.invoices(language);
CREATE INDEX idx_invoices_issued_at ON public.invoices(issued_at DESC);
CREATE INDEX idx_invoice_templates_active ON public.invoice_templates(is_active, language);

-- Enable RLS
ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- RLS policies for invoice_templates
CREATE POLICY "Active users can view invoice templates"
ON public.invoice_templates FOR SELECT
USING (is_active_user(auth.uid()));

CREATE POLICY "Admins can manage invoice templates"
ON public.invoice_templates FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS policies for invoices
CREATE POLICY "Active users can view invoices"
ON public.invoices FOR SELECT
USING (is_active_user(auth.uid()));

CREATE POLICY "Active users can create invoices"
ON public.invoices FOR INSERT
WITH CHECK (is_active_user(auth.uid()));

CREATE POLICY "Admins can manage invoices"
ON public.invoices FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Function to generate next invoice number (format: YYYY-NNNNNN)
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_year text;
  next_num integer;
  year_prefix text;
BEGIN
  current_year := to_char(now(), 'YYYY');
  year_prefix := current_year || '-';
  
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 6) AS integer)), 0) + 1
  INTO next_num
  FROM public.invoices
  WHERE invoice_number LIKE year_prefix || '%';
  
  RETURN year_prefix || LPAD(next_num::text, 6, '0');
END;
$$;

-- Trigger for updated_at on invoice_templates
CREATE TRIGGER update_invoice_templates_updated_at
BEFORE UPDATE ON public.invoice_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger for updated_at on invoices
CREATE TRIGGER update_invoices_updated_at
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default templates
INSERT INTO public.invoice_templates (name, language, direction, is_active, header_html, body_html, footer_html)
VALUES 
(
  'سند قبض افتراضي',
  'ar',
  'rtl',
  true,
  '<div style="text-align: center; margin-bottom: 20px;"><h1 style="font-size: 24px; margin: 0;">سند قبض</h1><p style="margin: 5px 0;">رقم: {{invoice_number}}</p><p style="margin: 5px 0;">التاريخ: {{issue_date}}</p></div>',
  '<div style="padding: 20px;"><table style="width: 100%; border-collapse: collapse;"><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>اسم العميل:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{client_name}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>رقم الهوية:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{client_id_number}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>رقم السيارة:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{car_number}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>نوع التأمين:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{insurance_type}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>شركة التأمين:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{company_name}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>فترة التأمين:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{start_date}} - {{end_date}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>المبلغ:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{total_amount}} ₪</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>طريقة الدفع:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{payment_method}}</td></tr></table></div>',
  '<div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;"><p>شكراً لثقتكم</p><p>{{admin_name}}</p></div>'
),
(
  'קבלה ברירת מחדל',
  'he',
  'rtl',
  true,
  '<div style="text-align: center; margin-bottom: 20px;"><h1 style="font-size: 24px; margin: 0;">קבלה</h1><p style="margin: 5px 0;">מספר: {{invoice_number}}</p><p style="margin: 5px 0;">תאריך: {{issue_date}}</p></div>',
  '<div style="padding: 20px;"><table style="width: 100%; border-collapse: collapse;"><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>שם הלקוח:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{client_name}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>תעודת זהות:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{client_id_number}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>מספר רכב:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{car_number}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>סוג ביטוח:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{insurance_type}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>חברת ביטוח:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{company_name}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>תקופת ביטוח:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{start_date}} - {{end_date}}</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>סכום:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{total_amount}} ₪</td></tr><tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>אמצעי תשלום:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{{payment_method}}</td></tr></table></div>',
  '<div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;"><p>תודה על אמונכם</p><p>{{admin_name}}</p></div>'
);