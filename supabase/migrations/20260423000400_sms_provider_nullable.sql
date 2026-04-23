-- =============================================================================
-- SMS: let sms_settings.provider be NULL = "inherit Thiqa platform default"
-- =============================================================================
-- Until now the column was NOT NULL DEFAULT '019sms', which meant every
-- agent row was pinned to a concrete provider — even when the agent had
-- never actually chosen one. Changing the Thiqa platform default from
-- 019sms to HTD wouldn't flow through, because the agent's row still
-- said '019sms' explicitly.
--
-- New semantics:
--   * provider IS NULL (or empty) → inherit the platform default
--     (`thiqa_platform_settings.default_sms_provider`).
--   * provider = '019sms' / 'htd' → agent explicitly picked this one.
-- =============================================================================

ALTER TABLE public.sms_settings
  ALTER COLUMN provider DROP NOT NULL;

ALTER TABLE public.sms_settings
  ALTER COLUMN provider DROP DEFAULT;

-- Rows that existed before the HTD rollout were auto-seeded with
-- '019sms' even though most agents never touched the setting. Flip
-- those to NULL *only* when the agent has no 019 credentials configured
-- (i.e. they're already inheriting credentials from the platform; they
-- should inherit the provider choice too). Rows with real 019 user +
-- token are left alone — those are explicit opt-ins.
UPDATE public.sms_settings
SET provider = NULL
WHERE provider = '019sms'
  AND COALESCE(sms_user, '') = ''
  AND COALESCE(sms_token, '') = '';
