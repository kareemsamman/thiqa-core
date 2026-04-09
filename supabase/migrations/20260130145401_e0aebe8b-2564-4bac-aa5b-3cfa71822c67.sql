-- Add company contact information columns to sms_settings
ALTER TABLE sms_settings
ADD COLUMN IF NOT EXISTS company_email TEXT,
ADD COLUMN IF NOT EXISTS company_phones TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS company_whatsapp TEXT,
ADD COLUMN IF NOT EXISTS company_location TEXT;

-- Insert example data if row exists
UPDATE sms_settings SET 
  company_email = 'info@basheer-ab.com',
  company_phones = ARRAY['04-6555123', '052-1234567'],
  company_whatsapp = '0521234567',
  company_location = 'الناصرة - شارع المركز'
WHERE company_email IS NULL;