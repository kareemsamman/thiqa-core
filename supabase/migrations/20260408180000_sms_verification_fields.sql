-- SMS verification fields for agent self-service onboarding
ALTER TABLE public.sms_settings ADD COLUMN IF NOT EXISTS sms_verification_status text NOT NULL DEFAULT 'not_verified'
  CHECK (sms_verification_status IN ('not_verified', 'pending', 'verified', 'failed'));
ALTER TABLE public.sms_settings ADD COLUMN IF NOT EXISTS sms_verification_message text;
ALTER TABLE public.sms_settings ADD COLUMN IF NOT EXISTS sms_verified_at timestamptz;
