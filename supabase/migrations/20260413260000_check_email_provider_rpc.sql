-- The check-email-provider edge function relied on
-- auth.admin.listUsers() whose response objects don't reliably include
-- the identities array — tested against kareem@elevate.co.il and got
-- {"exists": true, "providers": [], "is_google_only": false} even
-- though auth.identities has a single google row for that user. Since
-- the UI needs this signal for the Google-login hint dialog, expose a
-- SECURITY DEFINER RPC that reads auth.users + auth.identities directly
-- and returns the shape the frontend expects.
--
-- Security: reveals email existence and linked auth providers to
-- anonymous callers. Supabase already leaks this via the password-reset
-- and sign-in error flows, so no new enumeration surface is created.
-- The RPC never returns user_id, email, or identity_data.

CREATE OR REPLACE FUNCTION public.check_email_provider_public(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_providers text[];
  v_is_google_only boolean;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object(
      'exists', false,
      'providers', '[]'::jsonb,
      'is_google_only', false
    );
  END IF;

  SELECT id INTO v_user_id
    FROM auth.users
   WHERE lower(email) = lower(trim(p_email))
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'exists', false,
      'providers', '[]'::jsonb,
      'is_google_only', false
    );
  END IF;

  SELECT COALESCE(array_agg(DISTINCT provider), ARRAY[]::text[])
    INTO v_providers
    FROM auth.identities
   WHERE user_id = v_user_id;

  v_is_google_only := array_length(v_providers, 1) IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM unnest(v_providers) p
                     WHERE p <> 'google'
                   );

  RETURN jsonb_build_object(
    'exists', true,
    'providers', to_jsonb(v_providers),
    'is_google_only', v_is_google_only
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_email_provider_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_provider_public(text) TO anon, authenticated;
