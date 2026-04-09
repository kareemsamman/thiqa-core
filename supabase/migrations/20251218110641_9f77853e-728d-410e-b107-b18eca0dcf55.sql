-- Directory helpers so approved (active) users can see invoice/policy creators without opening full profiles table

CREATE OR REPLACE FUNCTION public.user_directory_list_active()
RETURNS TABLE(id uuid, display_name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(NULLIF(p.full_name, ''), p.email) AS display_name,
    p.email
  FROM public.profiles p
  WHERE p.status = 'active'
  ORDER BY COALESCE(NULLIF(p.full_name, ''), p.email);
END;
$$;

CREATE OR REPLACE FUNCTION public.user_directory_get_by_ids(p_ids uuid[])
RETURNS TABLE(id uuid, display_name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(NULLIF(p.full_name, ''), p.email) AS display_name,
    p.email
  FROM public.profiles p
  WHERE p.id = ANY(p_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_directory_list_active() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_directory_get_by_ids(uuid[]) TO authenticated;