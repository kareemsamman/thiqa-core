-- Add phone column to thiqa_super_admins
ALTER TABLE public.thiqa_super_admins ADD COLUMN IF NOT EXISTS phone text;
