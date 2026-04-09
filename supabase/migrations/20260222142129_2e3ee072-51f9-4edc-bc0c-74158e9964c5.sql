
-- Add dlr_id and dlr_status columns to marketing_sms_recipients for delivery tracking
ALTER TABLE public.marketing_sms_recipients 
ADD COLUMN IF NOT EXISTS dlr_id TEXT,
ADD COLUMN IF NOT EXISTS dlr_status TEXT,
ADD COLUMN IF NOT EXISTS dlr_message TEXT,
ADD COLUMN IF NOT EXISTS dlr_checked_at TIMESTAMPTZ;

-- Add delivered/failed counts to campaigns
ALTER TABLE public.marketing_sms_campaigns
ADD COLUMN IF NOT EXISTS delivered_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dlr_failed_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_dlr_check_at TIMESTAMPTZ;

-- Index for efficient DLR lookups
CREATE INDEX IF NOT EXISTS idx_marketing_sms_recipients_dlr_id ON public.marketing_sms_recipients(dlr_id) WHERE dlr_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_sms_recipients_campaign_status ON public.marketing_sms_recipients(campaign_id, status);
