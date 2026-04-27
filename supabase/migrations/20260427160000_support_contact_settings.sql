-- =============================================================================
-- Seed support contact keys (WhatsApp + phone) into thiqa_platform_settings
-- =============================================================================
-- /subscription-expired (and any future support-CTA surface) currently
-- hardcodes the WhatsApp link wa.me/972525143581 and the dial link
-- 052-514-3581. Moving these into thiqa_platform_settings lets the Thiqa
-- admin update the support number without a code deploy.
--
-- The values seeded here match the previous hardcoded ones so the page
-- behaves identically until an admin edits them in the Thiqa settings
-- UI. Both keys store raw national-format digits (no leading + or
-- spaces); the UI normalises them into wa.me / tel: links at render time.
-- =============================================================================

INSERT INTO public.thiqa_platform_settings (setting_key, setting_value)
VALUES
  ('support_whatsapp', '972525143581'),
  ('support_phone', '0525143581')
ON CONFLICT (setting_key) DO NOTHING;
