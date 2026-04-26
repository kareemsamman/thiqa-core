-- =============================================================================
-- Backfill starter data for agents that were provisioned without it
-- =============================================================================
-- setup-oauth-user historically did not call performSeed, so Google
-- signups landed without the default insurance_categories / road_services
-- / accident_fee_services / branches rows that register-agent provides.
-- The fix to setup-oauth-user covers new signups; this migration covers
-- the agents that were already created in that broken state.
--
-- Strategy: for each table, only insert when the agent has zero rows of
-- that kind, so we never duplicate over agents that already seeded
-- themselves. Values mirror SEED_* arrays in
-- supabase/functions/_shared/seed-agent-data.ts.
-- =============================================================================

-- --- insurance_categories ----------------------------------------------------
INSERT INTO public.insurance_categories (agent_id, name, name_ar, slug, mode, is_active, is_default, sort_order)
SELECT a.id, v.name, v.name_ar, v.slug, v.mode, true, v.is_default, v.sort_order
FROM public.agents a
CROSS JOIN (VALUES
  ('Car Insurance',      'تأمين السيارات',  'THIRD_FULL', 'FULL',  true,  1),
  ('Health Insurance',   'التأمين الصحي',   'HEALTH',     'LIGHT', false, 10),
  ('Life Insurance',     'التأمين على الحياة', 'LIFE',    'LIGHT', false, 11),
  ('Property Insurance', 'تأمين الممتلكات', 'PROPERTY',   'LIGHT', false, 12),
  ('Travel Insurance',   'تأمين السفر',     'TRAVEL',     'LIGHT', false, 13),
  ('Business Insurance', 'تأمين الشركات',   'BUSINESS',   'LIGHT', false, 14)
) AS v(name, name_ar, slug, mode, is_default, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.insurance_categories ic WHERE ic.agent_id = a.id
);

-- --- road_services ----------------------------------------------------------
INSERT INTO public.road_services (agent_id, name, name_ar, description, active, sort_order, allowed_car_types)
SELECT a.id, v.name, v.name_ar, NULL, true, v.sort_order, v.allowed_car_types::car_type[]
FROM public.agents a
CROSS JOIN (VALUES
  ('زجاج',                                  'زجاج',                                  0, ARRAY['car']),
  ('زجاج +ونش ضفة قدس',                     'زجاج +ونش ضفة قدس',                     1, ARRAY['car']),
  ('زجاج +ونش +سيارة بديلة ضفة قدس',         'زجاج +ونش +سيارة بديلة ضفة قدس',         2, ARRAY['car']),
  ('زجاج + ونش اوتبوس زعير ضفة قدس',         'زجاج + ونش اوتبوس زعير ضفة قدس',         3, ARRAY['small']),
  ('زجاج +ونش تجاري تحت ال 4 طن ضفة قدس',    'زجاج +ونش تجاري تحت ال 4 طن ضفة قدس',    4, ARRAY['tjeradown4']),
  ('زجاج +ونش تجاري حتى ال 12 طن ضفة قدس',   NULL,                                    5, ARRAY['tjeraup4'])
) AS v(name, name_ar, sort_order, allowed_car_types)
WHERE NOT EXISTS (
  SELECT 1 FROM public.road_services rs WHERE rs.agent_id = a.id
);

-- --- accident_fee_services --------------------------------------------------
INSERT INTO public.accident_fee_services (agent_id, name, name_ar, description, active, sort_order)
SELECT a.id, v.name, v.name_ar, NULL, true, v.sort_order
FROM public.agents a
CROSS JOIN (VALUES
  ('اعفاء رسوم حادث حتى 1000',                'اعفاء رسوم حادث حتى 1000',                0),
  ('اعفاء رسوم حادث حتى 1500',                'اعفاء رسوم حادث حتى 1500',                1),
  ('اعفاء رسوم حادث حتى 2000',                'اعفاء رسوم حادث حتى 2000',                2),
  ('اعفاء رسوم حادث فوق 24 حتى 2000 شيكل',    'اعفاء رسوم حادث فوق 24 حتى 2000 شيكل',    3)
) AS v(name, name_ar, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.accident_fee_services af WHERE af.agent_id = a.id
);

-- (branches intentionally left to performSeed / app-level flows — the
--  table has a globally-unique slug constraint that we can't safely
--  fabricate for an arbitrary agent in pure SQL. Agents that have been
--  using the app already have a branches row from somewhere else.)
