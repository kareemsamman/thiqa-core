-- "CRM" is the wrong product category for Thiqa. It's an Agency
-- Management System — policies, claims, commissions, checks, etc.
-- CRM is only the customer layer. This migration upserts the two
-- public-facing headlines in landing_content so the live site
-- reads as "نظام الإدارة الأذكى / لوكالات التأمين التي تريد أن
-- تربح أكثر" on the landing hero, and the pricing title drops the
-- "CRM" word too.
--
-- Upsert-by-section_key so the migration is safe to re-run and
-- handles the case where the row doesn't exist yet.

INSERT INTO public.landing_content (section_key, content_type, text_value)
VALUES (
  'hero_title',
  'text',
  E'نظام الإدارة الأذكى\nلوكالات التأمين التي تريد أن تربح أكثر'
)
ON CONFLICT (section_key) DO UPDATE
  SET text_value  = EXCLUDED.text_value,
      content_type = EXCLUDED.content_type;

INSERT INTO public.landing_content (section_key, content_type, text_value)
VALUES (
  'pricing_title',
  'text',
  'جرّب نظام الإدارة لمدة 35 يوم مجاناً *'
)
ON CONFLICT (section_key) DO UPDATE
  SET text_value  = EXCLUDED.text_value,
      content_type = EXCLUDED.content_type;
