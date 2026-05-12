-- ============================================================
-- Per-agent Click2Call.
--
-- Each Thiqa tenant (agent / agency) has its own Click2Call vendor
-- account (Talkchief today; more vendors later) with a single
-- api_key, and a shared pool of extensions every employee in that
-- agency can pick from at call time. The Thiqa super-admin
-- configures this from the agent detail page — never the agent's
-- own admin.
--
-- Schema:
--   click2call_agent_settings   — one row per agent, holds provider
--                                 + api_key + enabled flag. api_key
--                                 is sensitive so direct SELECT is
--                                 super-admin-only; agency employees
--                                 read their state via SECURITY
--                                 DEFINER RPC that omits api_key.
--   click2call_agent_extensions — 0..N rows per agent, the lines
--                                 the agency's employees can place
--                                 calls from. `label` lets the admin
--                                 tag each number (e.g. "خط تامر")
--                                 so the picker is recognisable.
--
-- Old (failed-design) per-user tables get dropped here — they were
-- only ever live in a test deploy with no data, so this is safe.
-- ============================================================

-- Drop the earlier per-user iteration. CASCADE removes the related
-- RPC and policies in one step.
DROP TABLE IF EXISTS public.click2call_user_extensions CASCADE;
DROP TABLE IF EXISTS public.click2call_user_settings CASCADE;
DROP FUNCTION IF EXISTS public.get_my_click2call_state();
DROP FUNCTION IF EXISTS public.touch_click2call_user_settings_updated_at();

-- ── 1. click2call_agent_settings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.click2call_agent_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL UNIQUE REFERENCES public.agents(id) ON DELETE CASCADE,
  -- Provider key. Starts with 'talkchief'; more vendors will be added
  -- as we onboard them. Kept as TEXT (rather than a Postgres enum)
  -- so adding a vendor is a code change, not a migration.
  provider text NOT NULL,
  -- The agency's vendor API key — one per tenant, shared by all
  -- employees who place calls.
  api_key text NOT NULL,
  -- Master switch — false hides the call button everywhere in the
  -- agency without losing the api_key, so toggling back on is
  -- instant.
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.click2call_agent_settings ENABLE ROW LEVEL SECURITY;

-- Super-admin only — agent-side admins never see this row. Mirrors
-- the AgentWhatsAppSettings access model.
DROP POLICY IF EXISTS "Super admins manage click2call_agent_settings"
  ON public.click2call_agent_settings;
CREATE POLICY "Super admins manage click2call_agent_settings"
  ON public.click2call_agent_settings
  FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_click2call_agent_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_click2call_agent_settings_updated_at
  ON public.click2call_agent_settings;
CREATE TRIGGER trg_click2call_agent_settings_updated_at
  BEFORE UPDATE ON public.click2call_agent_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_click2call_agent_settings_updated_at();

-- ── 2. click2call_agent_extensions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.click2call_agent_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  -- The line ID the provider expects in its API (Talkchief calls it
  -- "extension"). TEXT to tolerate non-numeric values.
  extension text NOT NULL,
  -- Display label so the employee can recognise which line they're
  -- dialing from ("خط تامر", "خط أحمد", "مكتب", "موبايل").
  label text,
  -- Default flag for the line the dialog pre-selects. At most one
  -- default per agent enforced by the partial unique index below;
  -- absence of any default is allowed (newly-created config).
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_click2call_agent_extensions_agent
  ON public.click2call_agent_extensions(agent_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_click2call_agent_extension_default
  ON public.click2call_agent_extensions(agent_id)
  WHERE is_default;

ALTER TABLE public.click2call_agent_extensions ENABLE ROW LEVEL SECURITY;

-- Super-admin writes; agency users (any role inside the same agent)
-- can SELECT so the call dialog can list them — these are not
-- sensitive on their own.
DROP POLICY IF EXISTS "Super admins write click2call_agent_extensions"
  ON public.click2call_agent_extensions;
CREATE POLICY "Super admins write click2call_agent_extensions"
  ON public.click2call_agent_extensions
  FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()))
  WITH CHECK (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Agency users read click2call_agent_extensions"
  ON public.click2call_agent_extensions;
CREATE POLICY "Agency users read click2call_agent_extensions"
  ON public.click2call_agent_extensions
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.agent_id = public.click2call_agent_extensions.agent_id
    )
  );

-- ── 3. SECURITY DEFINER helper for the call dialog ──────────────────
-- The dialog runs as an authenticated employee. They need:
--   - is click2call enabled for my agency?
--   - which provider should the edge function use?
--   - which extensions can I pick from?
-- but must NOT see api_key. This RPC returns exactly that subset,
-- scoped to the caller's agent via get_my_agent_id() (or the
-- impersonated one when Thiqa admin is acting as the agency).
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
  WITH ctx AS (
    SELECT COALESCE(get_impersonated_agent_id(), get_my_agent_id()) AS agent_id
  )
  SELECT
    s.is_enabled,
    s.provider,
    e.id           AS extension_id,
    e.extension    AS extension_number,
    e.label        AS extension_label,
    e.is_default   AS extension_is_default
  FROM ctx
  JOIN public.click2call_agent_settings s ON s.agent_id = ctx.agent_id
  LEFT JOIN public.click2call_agent_extensions e ON e.agent_id = s.agent_id
  ORDER BY e.is_default DESC NULLS LAST, e.extension ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_click2call_state() TO authenticated;
