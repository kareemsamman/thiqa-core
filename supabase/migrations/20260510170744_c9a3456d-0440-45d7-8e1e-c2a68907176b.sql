CREATE OR REPLACE FUNCTION public.exec_one_off_sql(_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE _sql;
END;
$$;
REVOKE ALL ON FUNCTION public.exec_one_off_sql(text) FROM public, anon, authenticated;