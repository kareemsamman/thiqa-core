-- Fix tenant-safe uniqueness for insurance category slugs
-- Previous global unique slug blocks category seeding for new agents.
ALTER TABLE public.insurance_categories
DROP CONSTRAINT IF EXISTS insurance_categories_slug_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_categories_agent_slug
ON public.insurance_categories (agent_id, slug)
WHERE agent_id IS NOT NULL;