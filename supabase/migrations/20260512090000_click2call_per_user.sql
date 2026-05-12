-- ============================================================
-- Per-user Click2Call.
--
-- Until now Click2Call was wired through a single global IPPBX
-- config (auth_settings.ippbx_enabled + pbx_extensions). That model
-- couldn't represent the reality on the ground: each worker has
-- their own provider account (Talkchief today; more vendors later)
-- with their own api_key, and may have several extensions/lines
-- attached to that account. So we move the configuration off the
-- agent and onto the individual profile.
--
-- Schema:
--   click2call_user_settings   — one row per profile, holds provider
--                                + api_key + enabled flag. api_key
--                                is sensitive so SELECT is admin-only;
--                                end-users read their own state via a
--                                SECURITY DEFINER RPC that omits it.
--   click2call_user_extensions — 0..N rows per profile, the lines
--                                the worker can place a call from.
--
-- The legacy global IPPBX flow stays in place; the edge function
-- prefers the per-user config and falls back to the old one only
-- when the user has no per-user row, so existing tenants keep
-- working until the admin opts them into the new model.
-- ============================================================

-- ── 1. click2call_user_settings ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.click2call_user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  -- Provider key. Starts with 'talkchief'; more vendors will be added
  -- here as we onboard them. Kept as TEXT (rather than a Postgres
  -- enum) so adding a vendor is a code change, not a migration.
  provider text NOT NULL,
  -- The vendor's API key for this specific worker's account.
  api_key text NOT NULL,
  -- Master switch — false means the worker keeps a configured row
  -- (so the admin doesn't lose the api_key) but the call button is
  -- hidden and the edge function refuses the call.
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One config row per (user, agent). The composite shape (vs. just
  -- user_id) matches every other per-user/per-agent table in the
  -- schema and tolerates a worker re-appearing under a second tenant.
  CONSTRAINT click2call_user_settings_unique UNIQUE (user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_click2call_user_settings_agent
  ON public.click2call_user_settings(agent_id);

ALTER TABLE public.click2call_user_settings ENABLE ROW LEVEL SECURITY;

-- Admin of the same tenant manages the row. Super admin always.
-- End-users do NOT get a direct SELECT — api_key is sensitive and
-- they read their own enabled flag via the RPC below instead.
DROP POLICY IF EXISTS "Agent admins manage click2call_user_settings" ON public.click2call_user_settings;
CREATE POLICY "Agent admins manage click2call_user_settings"
  ON public.click2call_user_settings
  FOR ALL
  TO authenticated
  USING (
    is_super_admin(auth.uid())
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND (
        (get_impersonated_agent_id() IS NOT NULL AND agent_id = get_impersonated_agent_id())
        OR (get_impersonated_agent_id() IS NULL AND agent_id = get_my_agent_id())
      )
    )
  )
  WITH CHECK (
    is_super_admin(auth.uid())
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND (
        (get_impersonated_agent_id() IS NOT NULL AND agent_id = get_impersonated_agent_id())
        OR (get_impersonated_agent_id() IS NULL AND agent_id = get_my_agent_id())
      )
    )
  );

CREATE OR REPLACE FUNCTION public.touch_click2call_user_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_click2call_user_settings_updated_at ON public.click2call_user_settings;
CREATE TRIGGER trg_click2call_user_settings_updated_at
  BEFORE UPDATE ON public.click2call_user_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_click2call_user_settings_updated_at();

-- ── 2. click2call_user_extensions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.click2call_user_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  -- The line ID the provider expects in its API (Talkchief calls it
  -- "extension"). Stored as TEXT to tolerate non-numeric values some
  -- vendors use (e.g. "ext-501-mobile").
  extension text NOT NULL,
  -- Display label so the worker can recognise which line they're
  -- placing the call from ("مكتب", "موبايل", "خط الفرع").
  label text,
  -- Default flag for the line the dialog should pre-select. At most
  -- one default per (user_id, agent_id); the partial unique index
  -- below enforces it.
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_click2call_user_extensions_user
  ON public.click2call_user_extensions(user_id, agent_id);

-- Only one default extension per worker per tenant. Partial unique
-- index instead of a CHECK so we don't accidentally block a worker
-- from owning *zero* defaults (newly-created config before they pick).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_click2call_user_extension_default
  ON public.click2call_user_extensions(user_id, agent_id)
  WHERE is_default;

ALTER TABLE public.click2call_user_extensions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agent admins manage click2call_user_extensions" ON public.click2call_user_extensions;
CREATE POLICY "Agent admins manage click2call_user_extensions"
  ON public.click2call_user_extensions
  FOR ALL
  TO authenticated
  USING (
    is_super_admin(auth.uid())
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND (
        (get_impersonated_agent_id() IS NOT NULL AND agent_id = get_impersonated_agent_id())
        OR (get_impersonated_agent_id() IS NULL AND agent_id = get_my_agent_id())
      )
    )
  )
  WITH CHECK (
    is_super_admin(auth.uid())
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND (
        (get_impersonated_agent_id() IS NOT NULL AND agent_id = get_impersonated_agent_id())
        OR (get_impersonated_agent_id() IS NULL AND agent_id = get_my_agent_id())
      )
    )
  );

-- ── 3. SECURITY DEFINER helper for the call dialog ───────────────────
-- The dialog runs as the logged-in worker (not an admin). It needs
-- to know:
--   - is click2call enabled for me?
--   - which provider should the edge function use?
--   - which extensions can I pick from?
-- but it must NOT see api_key. This RPC returns exactly that subset.
CREATE OR REPLACE FUNCTION public.get_my_click2call_state()
RETURNS TABLE (
  is_enabled boolean,
  provider text,
  extension_id uuid,
  extension_number text,
  extension_label text,
  extension_is_default boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.is_enabled,
    s.provider,
    e.id           AS extension_id,
    e.extension    AS extension_number,
    e.label        AS extension_label,
    e.is_default   AS extension_is_default
  FROM public.click2call_user_settings s
  LEFT JOIN public.click2call_user_extensions e
    ON  e.user_id  = s.user_id
    AND e.agent_id = s.agent_id
  WHERE s.user_id  = auth.uid()
    AND s.agent_id = COALESCE(get_impersonated_agent_id(), get_my_agent_id())
  ORDER BY e.is_default DESC NULLS LAST, e.extension ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_click2call_state() TO authenticated;
