-- Add created_by_admin_id to clients table
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS created_by_admin_id uuid REFERENCES public.profiles(id);

-- Add created_by_admin_id to cars table
ALTER TABLE public.cars
ADD COLUMN IF NOT EXISTS created_by_admin_id uuid REFERENCES public.profiles(id);

-- Add SMS settings table
CREATE TABLE IF NOT EXISTS public.sms_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL DEFAULT '019sms',
  sms_user text,
  sms_token text,
  sms_source text,
  is_enabled boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on sms_settings
ALTER TABLE public.sms_settings ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage SMS settings
CREATE POLICY "Admins can view SMS settings"
ON public.sms_settings FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage SMS settings"
ON public.sms_settings FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add trigger for updated_at on sms_settings
CREATE TRIGGER update_sms_settings_updated_at
BEFORE UPDATE ON public.sms_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Customer signatures table
CREATE TABLE IF NOT EXISTS public.customer_signatures (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  signature_image_url text NOT NULL,
  signed_at timestamp with time zone NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  token text UNIQUE,
  token_expires_at timestamp with time zone,
  branch_id uuid REFERENCES public.branches(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on customer_signatures
ALTER TABLE public.customer_signatures ENABLE ROW LEVEL SECURITY;

-- Branch users can view signatures
CREATE POLICY "Branch users can view signatures"
ON public.customer_signatures FOR SELECT
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Branch users can create signatures
CREATE POLICY "Branch users can create signatures"
ON public.customer_signatures FOR INSERT
WITH CHECK (is_active_user(auth.uid()));

-- Add signature_url to clients for quick access
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS signature_url text;

-- Add template_type to invoice_templates for signature vs invoice templates
ALTER TABLE public.invoice_templates
ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'invoice';

-- Create index for fast signature lookup
CREATE INDEX IF NOT EXISTS idx_customer_signatures_client_id ON public.customer_signatures(client_id);
CREATE INDEX IF NOT EXISTS idx_customer_signatures_token ON public.customer_signatures(token) WHERE token IS NOT NULL;