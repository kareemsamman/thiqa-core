-- Marketing SMS Campaigns table
CREATE TABLE public.marketing_sms_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  image_url TEXT,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'completed', 'failed')),
  created_by_admin_id UUID REFERENCES public.profiles(id),
  branch_id UUID REFERENCES public.branches(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Campaign recipients tracking
CREATE TABLE public.marketing_sms_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.marketing_sms_campaigns(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id),
  phone_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add birthday and license expiry SMS templates to sms_settings
ALTER TABLE public.sms_settings 
ADD COLUMN IF NOT EXISTS birthday_sms_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS birthday_sms_template TEXT DEFAULT 'عيد ميلاد سعيد {client_name}! 🎂 نتمنى لك سنة مليئة بالفرح والسعادة.',
ADD COLUMN IF NOT EXISTS license_expiry_sms_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS license_expiry_sms_template TEXT DEFAULT 'مرحباً {client_name}، نذكرك أن رخصة سيارتك رقم {car_number} ستنتهي خلال شهر. يرجى التواصل معنا لتجديدها.';

-- Track sent automated messages to avoid duplicates
CREATE TABLE public.automated_sms_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sms_type TEXT NOT NULL CHECK (sms_type IN ('birthday', 'license_expiry')),
  client_id UUID NOT NULL REFERENCES public.clients(id),
  car_id UUID REFERENCES public.cars(id),
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  sent_for_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sms_type, client_id, car_id, sent_for_date)
);

-- Enable RLS
ALTER TABLE public.marketing_sms_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_sms_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automated_sms_log ENABLE ROW LEVEL SECURITY;

-- Admin-only policies for marketing campaigns
CREATE POLICY "Admins can manage marketing campaigns"
ON public.marketing_sms_campaigns
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage campaign recipients"
ON public.marketing_sms_recipients
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view automated sms log"
ON public.automated_sms_log
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Indexes for performance
CREATE INDEX idx_marketing_campaigns_status ON public.marketing_sms_campaigns(status);
CREATE INDEX idx_marketing_recipients_campaign ON public.marketing_sms_recipients(campaign_id);
CREATE INDEX idx_marketing_recipients_status ON public.marketing_sms_recipients(status);
CREATE INDEX idx_automated_sms_log_type_date ON public.automated_sms_log(sms_type, sent_for_date);
CREATE INDEX idx_clients_birth_date ON public.clients(birth_date);
CREATE INDEX idx_cars_license_expiry ON public.cars(license_expiry);