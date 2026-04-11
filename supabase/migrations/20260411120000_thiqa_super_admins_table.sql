-- Create thiqa_super_admins table for dynamic super admin management
CREATE TABLE IF NOT EXISTS public.thiqa_super_admins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  added_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Seed with existing hardcoded super admin emails
INSERT INTO public.thiqa_super_admins (email, name)
VALUES
  ('morshed500@gmail.com', 'Morshed'),
  ('0525143581@phone.local', 'Phone Admin')
ON CONFLICT (email) DO NOTHING;

-- RLS: anyone authenticated can read (needed for frontend super admin check)
ALTER TABLE public.thiqa_super_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read super admins"
  ON public.thiqa_super_admins FOR SELECT
  TO authenticated
  USING (true);

-- Only existing super admins can insert/update/delete
CREATE POLICY "Super admins can manage super admins"
  ON public.thiqa_super_admins FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- Update is_super_admin() to check the table instead of hardcoded emails
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.thiqa_super_admins sa ON lower(u.email) = lower(sa.email)
    WHERE u.id = _user_id
  )
$$;
