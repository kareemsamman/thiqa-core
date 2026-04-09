-- Security hardening: reports must not be callable by anonymous users
REVOKE EXECUTE ON FUNCTION public.get_client_renewal_policies(uuid,date,date) FROM anon;
REVOKE ALL ON FUNCTION public.get_client_renewal_policies(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_renewal_policies(uuid,date,date) TO authenticated;
