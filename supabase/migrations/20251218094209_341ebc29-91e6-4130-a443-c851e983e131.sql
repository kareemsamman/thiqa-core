
-- Make car_id nullable for non-car insurance types (LIGHT mode)
ALTER TABLE public.policies ALTER COLUMN car_id DROP NOT NULL;

-- Add category_id column to link policies to insurance_categories
ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.insurance_categories(id);

-- Create index for category_id
CREATE INDEX IF NOT EXISTS idx_policies_category_id ON public.policies(category_id);
