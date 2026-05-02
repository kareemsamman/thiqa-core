-- The 20260430160000 security-hardening migration locked
-- thiqa_platform_settings to super-admin only (it also stores SMTP
-- credentials). That broke `show_public_prices`: the public /pricing
-- page, the in-app upgrade popup, and the agent /subscription page
-- all need to read this single boolean to know whether to hide prices,
-- but authenticated agents and anon visitors are blocked from reading
-- the table.
--
-- Add an additive SELECT policy with an explicit allow-list of
-- public-safe keys. Postgres combines policies with OR, so super
-- admins still read everything (via the hardening migration's policy),
-- and anyone — anon or authenticated — can read just the keys named
-- here. SMTP credentials and other sensitive rows stay locked down.
CREATE POLICY "Anyone can read public-safe platform settings"
  ON public.thiqa_platform_settings FOR SELECT
  TO authenticated, anon
  USING (setting_key IN ('show_public_prices'));
