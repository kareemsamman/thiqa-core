-- =============================================================================
-- Route new-agent notification emails to a dedicated mailbox
-- =============================================================================
-- Previously the "new agent registered" email was sent to every row in
-- thiqa_super_admins (currently morshed500@gmail.com), conflating platform
-- admin access with notification routing. The product team wants those
-- notifications to land in the shared support inbox instead, while keeping
-- platform-admin login rights unchanged.
--
-- This migration introduces a single platform setting key that the
-- register-agent and setup-oauth-user edge functions read at send time.
-- Editing the value here (or via a future Thiqa settings UI) reroutes
-- notifications without redeploying any code.
-- =============================================================================

INSERT INTO public.thiqa_platform_settings (setting_key, setting_value)
VALUES ('new_agent_notification_email', 'support@getthiqa.com')
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at = now();
