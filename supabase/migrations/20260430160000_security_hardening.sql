-- Three-pronged security hardening flagged by an external scanner:
--
--   1. thiqa_platform_settings: SELECT/INSERT/UPDATE were open to any
--      authenticated user (USING (true)). The table holds SMTP
--      credentials and other platform-wide config — every signed-in
--      agent could read the SMTP password. Locked down to super
--      admin only; the support-notify / public-support-submit edge
--      functions read it via service_role and are unaffected.
--
--   2. SECURITY DEFINER functions inherit Postgres' default
--      EXECUTE-to-PUBLIC grant, which means anon (unauthenticated)
--      callers can invoke them via PostgREST `/rpc/...`. Revoke
--      PUBLIC and re-grant explicitly to authenticated + service_role.
--      Existing explicit grants (e.g. anon access on
--      check_email_provider_public from 20260413260000) are not
--      affected — REVOKE FROM PUBLIC only touches the implicit
--      PUBLIC entry, not role-specific grants.
--
--   3. user_sessions is on the supabase_realtime publication so
--      kicks propagate instantly. Even with RLS, the scanner flags
--      the IP / user-agent / device columns as broadcast. Drop the
--      table from the publication; the existing 30-second heartbeat
--      in useSessionTracker.tsx already polls kicked_at as a
--      fallback, so kicks still take effect — just up to 30s later.

-- ─────────────────────────────────────────────────────────────────
-- 1. thiqa_platform_settings: lock writes (and reads) to super admin
-- ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can read platform settings" ON public.thiqa_platform_settings;
DROP POLICY IF EXISTS "Authenticated users can update platform settings" ON public.thiqa_platform_settings;
DROP POLICY IF EXISTS "Authenticated users can insert platform settings" ON public.thiqa_platform_settings;
DROP POLICY IF EXISTS "Only super admin can read platform settings" ON public.thiqa_platform_settings;
DROP POLICY IF EXISTS "Only super admin can insert platform settings" ON public.thiqa_platform_settings;
DROP POLICY IF EXISTS "Only super admin can update platform settings" ON public.thiqa_platform_settings;
DROP POLICY IF EXISTS "Only super admin can delete platform settings" ON public.thiqa_platform_settings;

CREATE POLICY "Only super admin can read platform settings"
  ON public.thiqa_platform_settings FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admin can insert platform settings"
  ON public.thiqa_platform_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admin can update platform settings"
  ON public.thiqa_platform_settings FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admin can delete platform settings"
  ON public.thiqa_platform_settings FOR DELETE
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 2. Revoke PUBLIC from all SECURITY DEFINER functions in public,
--    grant to authenticated + service_role.
-- ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT
      p.proname  AS func_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC',
      f.func_name, f.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
      f.func_name, f.args
    );
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- 3. Drop user_sessions from supabase_realtime publication.
--    Wrapped in EXCEPTION block in case it's already absent
--    (idempotent re-run).
-- ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.user_sessions;
EXCEPTION
  WHEN undefined_object THEN
    -- Table wasn't in the publication; nothing to do.
    NULL;
END;
$$;
