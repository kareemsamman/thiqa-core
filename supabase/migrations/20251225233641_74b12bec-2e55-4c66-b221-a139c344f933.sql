-- Add SMTP settings columns to auth_settings table
ALTER TABLE public.auth_settings
ADD COLUMN IF NOT EXISTS smtp_host TEXT DEFAULT 'smtp.hostinger.com',
ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 465,
ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS smtp_user TEXT,
ADD COLUMN IF NOT EXISTS smtp_password TEXT;