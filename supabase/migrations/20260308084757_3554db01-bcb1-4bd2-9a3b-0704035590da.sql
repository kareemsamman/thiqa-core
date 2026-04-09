CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = _user_id
      AND (
        lower(email) = 'morshed500@gmail.com'
        OR lower(email) = '0525143581@phone.local'
        OR lower(email) LIKE '0525143581@%'
      )
  )
$$;