-- =============================================================================
-- One-off: confirm support@getthiqa.com so the new super admin can log in
-- =============================================================================
-- The Thiqa Super Admin signup went through the app's regular signup
-- form by mistake, which:
--   1. Created an entry in auth.users with email_confirmed_at = NULL
--      (Supabase auth's own confirmation gate)
--   2. Created an agent tenant + agent_users link
--   3. Created a profiles row with email_confirmed = false
--      (the app's secondary OTP gate that Login.tsx checks)
--   4. Sent a 4-digit OTP that has since expired
--
-- The thiqa_super_admins entitlement we seeded means useAuth will
-- correctly flag this user as super admin and Login.tsx redirects
-- them to /thiqa BEFORE checking email_confirmed — but only after
-- Supabase auth itself accepts the login. With email_confirmed_at
-- still NULL, Supabase returns "email_not_confirmed" and the user
-- is bounced to /verify-email.
--
-- Fix:
--   1. Confirm the auth.users row so Supabase lets them sign in.
--   2. Mark profiles.email_confirmed = true as a belt-and-suspenders
--      so even if isSuperAdmin race-conditions somewhere, the app's
--      gate also passes.
--   3. Delete the accidentally-created agent tenant + agent_users
--      link so they don't muddy the dashboard with a phantom agent.
--      The super admin themselves don't need an agent_id.
-- =============================================================================

DO $$
DECLARE
  v_user_id uuid;
  v_agent_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users
  WHERE lower(email) = 'support@getthiqa.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'No auth user for support@getthiqa.com — nothing to clean up.';
    RETURN;
  END IF;

  -- 1. Confirm the auth.users row.
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
      updated_at = NOW()
  WHERE id = v_user_id;

  -- 2. Mark the profile as confirmed if it exists.
  UPDATE public.profiles
  SET email_confirmed = true,
      updated_at = NOW()
  WHERE id = v_user_id;

  -- 3. Detach + drop the accidental agent tenant. agent_users is the
  --    join table; deleting from agents cascades to its dependents
  --    (branches, agent_feature_flags, etc) via existing FKs.
  SELECT agent_id INTO v_agent_id FROM public.agent_users
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_agent_id IS NOT NULL THEN
    -- Sanity: only delete if we created this agent for the same email
    -- (i.e. it's the orphan from the misclicked signup flow). Avoids
    -- nuking an unrelated agent if support@getthiqa.com ever gets
    -- impersonation-linked to a real tenant in the future.
    DELETE FROM public.agents
    WHERE id = v_agent_id
      AND lower(email) = 'support@getthiqa.com';
  END IF;
END $$;
