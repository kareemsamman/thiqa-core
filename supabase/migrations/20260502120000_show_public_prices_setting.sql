-- Public price visibility toggle.
--
-- When 'false', the public /pricing page and the in-app upgrade popup
-- hide the price block but keep the upgrade CTA functional, so a user
-- can still subscribe without seeing the price upfront. Defaults to
-- 'true' so existing installs keep their current behaviour.
INSERT INTO public.thiqa_platform_settings (setting_key, setting_value)
VALUES ('show_public_prices', 'true')
ON CONFLICT (setting_key) DO NOTHING;
