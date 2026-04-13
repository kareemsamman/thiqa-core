-- Flag auto-seeded sample companies so the onboarding wizard can distinguish
-- them from companies the user actually added. Without this, the cascade
-- seed from register-agent / ThiqaCreateAgent leaves 3 sample rows in
-- insurance_companies and the onboarding "companies" step auto-completes
-- before the user has done anything.

ALTER TABLE public.insurance_companies
  ADD COLUMN IF NOT EXISTS is_seed boolean NOT NULL DEFAULT false;

-- Backfill existing seed rows by name so agents created before this
-- migration also get a clean onboarding state.
UPDATE public.insurance_companies
   SET is_seed = true
 WHERE name IN ('כלל', 'اراضي مقدسة', 'شركة اكس')
   AND is_seed = false;
