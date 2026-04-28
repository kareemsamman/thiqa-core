-- =============================================================================
-- Make sure support@getthiqa.com has a profiles row, in case a cascade
-- from the previous cleanup migration removed it
-- =============================================================================
-- 20260428120000 deleted the accidentally-created agent tenant. If the
-- profiles table has an ON DELETE CASCADE on profiles.agent_id (some
-- migrations went back and forth on this) the profile would have been
-- nuked too — leaving an auth.users row with no profile. The OTP
-- verify function uses profiles.email to identify the account, and
-- when that lookup misses it returns "لم يتم العثور على الحساب".
--
-- Fix: ensure a minimal profile exists for the auth user. Status is
-- 'active', email_confirmed = true, and we deliberately leave
-- agent_id = NULL — super admin entitlement is via thiqa_super_admins,
-- not via agent_users. Profiles for super admins have always been
-- optional, but having one closes off this OTP-page edge case.
-- =============================================================================

DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users
  WHERE lower(email) = 'support@getthiqa.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No auth user for support@getthiqa.com — skipping profile seed.';
    RETURN;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, status, email_confirmed)
  VALUES (v_user_id, 'support@getthiqa.com', 'Thiqa Support', 'active', true)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    email_confirmed = true,
    status = 'active',
    updated_at = NOW();
END $$;
