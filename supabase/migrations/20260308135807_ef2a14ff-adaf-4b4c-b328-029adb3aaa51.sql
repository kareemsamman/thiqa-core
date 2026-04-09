
-- Remove duplicate rows from user_roles keeping only one per (user_id, role)
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.role = b.role;

-- Add unique constraint if missing (the old one was on user_id,role but may have been dropped)
-- First check and drop any existing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_role_key'
  ) THEN
    ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;
