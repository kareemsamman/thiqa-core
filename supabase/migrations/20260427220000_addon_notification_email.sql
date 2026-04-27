-- ============================================================
-- Route addon-purchase notification emails to support@getthiqa.com
--
-- Same pattern as 20260426130000_new_agent_notification_email.sql:
-- request-addon-purchase used to query thiqa_super_admins for
-- recipients, which meant every addon request fanned out to
-- morshed500@gmail.com (the platform admin login). The product
-- team wants a single dedicated mailbox for billing/support
-- notifications.
--
-- This seeds the canonical key. The edge function reads it at
-- send time, so editing the value here (or via a future Thiqa
-- settings UI) reroutes all addon notifications without a deploy.
-- ============================================================

INSERT INTO public.thiqa_platform_settings (setting_key, setting_value)
VALUES ('addon_purchase_notification_email', 'support@getthiqa.com')
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at = now();
