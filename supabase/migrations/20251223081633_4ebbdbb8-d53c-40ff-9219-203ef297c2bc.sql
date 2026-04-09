-- Add legacy WP IDs for idempotent imports and reliable mapping
ALTER TABLE public.insurance_companies
ADD COLUMN IF NOT EXISTS legacy_wp_id integer;

ALTER TABLE public.brokers
ADD COLUMN IF NOT EXISTS legacy_wp_id integer;

-- Ensure idempotent imports for policies
CREATE UNIQUE INDEX IF NOT EXISTS policies_legacy_wp_id_uidx
ON public.policies (legacy_wp_id)
WHERE legacy_wp_id IS NOT NULL;

-- Ensure idempotent imports for companies and brokers when legacy IDs exist
CREATE UNIQUE INDEX IF NOT EXISTS insurance_companies_legacy_wp_id_uidx
ON public.insurance_companies (legacy_wp_id)
WHERE legacy_wp_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS brokers_legacy_wp_id_uidx
ON public.brokers (legacy_wp_id)
WHERE legacy_wp_id IS NOT NULL;