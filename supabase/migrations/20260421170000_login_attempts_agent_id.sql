-- login_attempts: scope by agent_id so failed logins are visible to admins.
--
-- Background: AdminUsers renders a "محاولات الدخول الأخيرة" section that
-- queries login_attempts filtered by .in('user_id', userIds). But the
-- auth edge functions never set user_id on failed attempts (unknown
-- email, wrong OTP, etc.), and the existing RLS helper
-- can_view_login_attempt(_attempt_user_id) returns false when user_id
-- IS NULL. Result: admins see zero failed attempts even though we're
-- logging them.
--
-- Fix: add agent_id to the table and populate it via a BEFORE trigger
-- that looks up profiles by user_id or email. No edge function changes
-- needed — the trigger handles both successful and failed attempts
-- uniformly, and backfills the column on update too (used by
-- auth-email-verify / auth-sms-verify once a user eventually exists).
-- RLS then scopes SELECT by agent_id directly, which is what the
-- admin query will start filtering on.

ALTER TABLE public.login_attempts
  ADD COLUMN IF NOT EXISTS agent_id uuid;

-- Backfill existing rows from profiles (prefer user_id match, fall back
-- to case-insensitive email match for rows where user_id is null).
UPDATE public.login_attempts la
SET agent_id = sub.agent_id
FROM (
  SELECT DISTINCT ON (la2.id)
    la2.id,
    p.agent_id
  FROM public.login_attempts la2
  JOIN public.profiles p
    ON (la2.user_id IS NOT NULL AND p.id = la2.user_id)
    OR (la2.user_id IS NULL AND la2.email IS NOT NULL AND lower(p.email) = lower(la2.email))
  WHERE la2.agent_id IS NULL
    AND p.agent_id IS NOT NULL
  ORDER BY la2.id, (p.id = la2.user_id) DESC
) sub
WHERE la.id = sub.id;

CREATE INDEX IF NOT EXISTS idx_login_attempts_agent_id_created_at
  ON public.login_attempts (agent_id, created_at DESC);

-- Trigger: every insert/update, if agent_id wasn't explicitly provided,
-- derive it from profiles. Runs BEFORE so the row lands with the
-- correct scope even when the edge function knows nothing about agents.
CREATE OR REPLACE FUNCTION public.login_attempts_set_agent_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.agent_id IS NULL THEN
    SELECT p.agent_id
    INTO NEW.agent_id
    FROM public.profiles p
    WHERE (NEW.user_id IS NOT NULL AND p.id = NEW.user_id)
       OR (NEW.user_id IS NULL AND NEW.email IS NOT NULL AND lower(p.email) = lower(NEW.email))
    ORDER BY (p.id = NEW.user_id) DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_login_attempts_set_agent_id ON public.login_attempts;
CREATE TRIGGER trg_login_attempts_set_agent_id
BEFORE INSERT OR UPDATE ON public.login_attempts
FOR EACH ROW
EXECUTE FUNCTION public.login_attempts_set_agent_id();

-- RLS: switch from "admin sees rows whose user_id joins to a profile in
-- my agent" to "admin sees rows whose agent_id equals my agent". Same
-- intent, but now also covers failed attempts (user_id NULL) that the
-- trigger was able to resolve via email.
CREATE OR REPLACE FUNCTION public.can_view_login_attempt_agent(_attempt_agent_id uuid, _attempt_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.is_super_admin(auth.uid()) THEN true
    WHEN _attempt_user_id IS NOT NULL AND _attempt_user_id = auth.uid() THEN true
    WHEN _attempt_agent_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles me
      WHERE me.user_id = auth.uid()
        AND me.role = 'admin'::public.app_role
        AND me.agent_id = _attempt_agent_id
    )
  END
$$;

DROP POLICY IF EXISTS "Users/admins can view scoped login attempts" ON public.login_attempts;
CREATE POLICY "Users/admins can view scoped login attempts"
ON public.login_attempts
FOR SELECT
TO authenticated
USING (public.can_view_login_attempt_agent(agent_id, user_id));
