-- Fix tenant-safe uniqueness for insurance company names
-- Previous global unique index on lower(name) blocks seeding for new agents.
DROP INDEX IF EXISTS public.idx_insurance_companies_name_lower;

CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_companies_agent_name_lower
ON public.insurance_companies (agent_id, lower(name))
WHERE agent_id IS NOT NULL;