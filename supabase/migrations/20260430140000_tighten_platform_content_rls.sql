-- Tighten RLS on platform-wide content tables.
--
-- An external security scan flagged:
--   1. landing_content: any authenticated user can INSERT/UPDATE/DELETE
--      (the original FOR ALL policy used `USING (true) WITH CHECK (true)`
--      despite naming itself "Super admins can manage…"). This is the
--      bug — the predicate never enforced the comment.
--   2. announcements: same shape, addressed by 20260111113233. We
--      re-apply those policies idempotently here in case prod drifted
--      back to the original permissive shape (which is what the
--      scanner appears to be reading).
--
-- Public SELECT stays open for landing_content (the marketing page is
-- public) and announcements (popup display for any signed-in user).
-- Only writes get locked down to is_super_admin().

-- ── landing_content ───────────────────────────────────────────
-- Drop both the original permissive policy and any partial fixes
-- that may have landed manually in the dashboard, so we can rebuild
-- a clean set.
DROP POLICY IF EXISTS "Super admins can manage landing content" ON public.landing_content;
DROP POLICY IF EXISTS "Only super admin can insert landing content" ON public.landing_content;
DROP POLICY IF EXISTS "Only super admin can update landing content" ON public.landing_content;
DROP POLICY IF EXISTS "Only super admin can delete landing content" ON public.landing_content;

CREATE POLICY "Only super admin can insert landing content"
  ON public.landing_content FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admin can update landing content"
  ON public.landing_content FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admin can delete landing content"
  ON public.landing_content FOR DELETE
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- The "Anyone can read landing content" SELECT policy from the
-- table's original migration stays as-is — landing copy must be
-- readable without authentication for the marketing page.

-- ── announcements (defensive re-apply) ────────────────────────
DROP POLICY IF EXISTS "Super admin can manage announcements" ON public.announcements;
DROP POLICY IF EXISTS "Only super admin can manage announcements" ON public.announcements;
DROP POLICY IF EXISTS "Only super admin can update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Only super admin can delete announcements" ON public.announcements;

CREATE POLICY "Only super admin can manage announcements"
  ON public.announcements FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admin can update announcements"
  ON public.announcements FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Only super admin can delete announcements"
  ON public.announcements FOR DELETE
  TO authenticated
  USING (public.is_super_admin(auth.uid()));
