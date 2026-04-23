-- =============================================================================
-- SMS: add HTD (sms.HTD.ps) as a second provider alongside 019sms
-- =============================================================================
-- The agent-level `sms_settings` row and the Thiqa platform defaults now
-- support either provider. Callers (edge functions) read the row, pick
-- the provider, and dispatch to the right API:
--
--   provider='019sms' (or '019') → 019sms.co.il XML API using sms_user,
--                                   sms_token, sms_source
--   provider='htd'               → sms.HTD.ps HTTP API using htd_id, htd_sender
--
-- The Thiqa admin sets the *platform default* provider + credentials in
-- /thiqa/settings. Each agent can override both provider and credentials
-- from /thiqa/agents/:id. If an agent leaves all credentials empty,
-- they inherit the platform default (same fallback flow as before).
-- =============================================================================

-- Agent-level HTD credentials (provider column already exists).
ALTER TABLE public.sms_settings
  ADD COLUMN IF NOT EXISTS htd_id text,
  ADD COLUMN IF NOT EXISTS htd_sender text;

-- Platform-level HTD defaults + which provider is the platform default.
INSERT INTO public.thiqa_platform_settings (setting_key, setting_value) VALUES
  ('default_sms_provider', '019sms'),
  ('default_sms_htd_id', ''),
  ('default_sms_htd_sender', '')
ON CONFLICT (setting_key) DO NOTHING;
