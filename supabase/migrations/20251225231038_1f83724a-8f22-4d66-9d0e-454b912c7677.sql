-- Auth settings table for OTP configuration
CREATE TABLE public.auth_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Email OTP settings
  email_otp_enabled boolean NOT NULL DEFAULT false,
  gmail_sender_email text,
  gmail_app_password text,
  email_subject_template text DEFAULT 'رمز التحقق: {code}',
  email_body_template text DEFAULT 'رمز التحقق الخاص بك هو: {code}\n\nهذا الرمز صالح لمدة 5 دقائق.',
  -- SMS OTP settings  
  sms_otp_enabled boolean NOT NULL DEFAULT false,
  sms_019_user text,
  sms_019_token text,
  sms_019_source text,
  sms_message_template text DEFAULT 'رمز التحقق الخاص بك هو: {code}',
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- OTP codes table
CREATE TABLE public.otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL, -- email or phone
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  otp_hash text NOT NULL, -- hashed OTP for security
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add indexes for OTP lookup
CREATE INDEX idx_otp_codes_identifier ON public.otp_codes(identifier, channel) WHERE used_at IS NULL;
CREATE INDEX idx_otp_codes_expires ON public.otp_codes(expires_at) WHERE used_at IS NULL;

-- Update login_attempts to support OTP methods
ALTER TABLE public.login_attempts 
  ADD COLUMN IF NOT EXISTS method text DEFAULT 'google',
  ADD COLUMN IF NOT EXISTS identifier text;

-- Update existing login_attempts to have method = 'google'
UPDATE public.login_attempts SET method = 'google' WHERE method IS NULL;

-- Enable RLS
ALTER TABLE public.auth_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

-- Auth settings: only admins can view/manage
CREATE POLICY "Admins can view auth settings"
ON public.auth_settings FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage auth settings"
ON public.auth_settings FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- OTP codes: service only (edge functions via service role)
-- No user access needed since edge functions use service role

-- Insert default auth settings row
INSERT INTO public.auth_settings (id) VALUES (gen_random_uuid());

-- Add trigger for updated_at
CREATE TRIGGER update_auth_settings_updated_at
BEFORE UPDATE ON public.auth_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();