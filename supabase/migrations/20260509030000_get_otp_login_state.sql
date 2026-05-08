-- get_otp_login_state() — single-call gate used by Login.tsx after a
-- successful password sign-in. Returns whether the caller's agency
-- requires an OTP step and the phone the SMS should go to.
--
-- SECURITY DEFINER so the lookup works even for workers (the
-- auth_settings RLS policy is admin-only). The function only ever
-- reads the row matching the caller's own agent, so the elevated
-- privileges don't leak data across tenants.

CREATE OR REPLACE FUNCTION public.get_otp_login_state()
RETURNS TABLE (
  otp_required boolean,
  phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(s.sms_otp_enabled, false) AS otp_required,
    p.phone::text AS phone
  FROM public.profiles p
  LEFT JOIN public.auth_settings s ON s.agent_id = p.agent_id
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_otp_login_state() TO authenticated;
