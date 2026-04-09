-- Add company_phone_links JSONB field to store phone numbers with their custom hrefs
-- Format: [{"phone": "026307377", "href": "tel:026307377"}, {"phone": "0544494440", "href": "https://wa.me/9720544494440"}]

ALTER TABLE sms_settings 
ADD COLUMN IF NOT EXISTS company_phone_links JSONB DEFAULT '[]'::jsonb;

-- Add a comment to explain the field
COMMENT ON COLUMN sms_settings.company_phone_links IS 'Array of {phone, href} objects for custom phone links in invoice footer';