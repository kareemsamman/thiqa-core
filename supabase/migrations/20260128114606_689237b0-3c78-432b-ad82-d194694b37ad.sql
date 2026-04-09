-- Add IPPBX settings columns to auth_settings table
ALTER TABLE auth_settings 
ADD COLUMN IF NOT EXISTS ippbx_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ippbx_token_id TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ippbx_extension_password TEXT DEFAULT NULL;

COMMENT ON COLUMN auth_settings.ippbx_enabled IS 'Enable Click-to-Call functionality';
COMMENT ON COLUMN auth_settings.ippbx_token_id IS 'IPPBX API Token ID';
COMMENT ON COLUMN auth_settings.ippbx_extension_password IS 'IPPBX Extension Password (MD5)';