-- Make company_id nullable for LIGHT mode policies (Health, Life, Property, etc.)
ALTER TABLE public.policies ALTER COLUMN company_id DROP NOT NULL;