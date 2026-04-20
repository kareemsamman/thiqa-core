-- Per-agent keyboard shortcut bindings.
--
-- The canonical list of shortcut ACTIONS lives in code (src/lib/shortcuts.ts)
-- — that's the source of truth for what's bindable (new policy, search,
-- drafts, new client, edit client, nav to clients/policies, …).
-- This table stores per-agent OVERRIDES: which key combination an action
-- is bound to, or whether it's disabled outright. One row per (agent,
-- action). Absent row = use the default combo defined in code.
--
-- Only the agent's admin writes to this table; every active user of the
-- agent can read from it (so the staff's shortcuts apply immediately).

CREATE TABLE IF NOT EXISTS public.agent_shortcuts (
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  -- Stable identifier from src/lib/shortcuts.ts. Free-form text so the
  -- app can add new actions without a schema migration.
  action_key text NOT NULL,
  -- Normalized combo string: "ctrl+k" / "ctrl+shift+n" / "alt+/".
  -- NULL = binding cleared (no key assigned). Modifiers are always
  -- listed before the main key, lowercase, separated by '+'.
  key_combination text,
  -- Admin can temporarily disable an action without forgetting the key.
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (agent_id, action_key)
);

CREATE INDEX IF NOT EXISTS agent_shortcuts_agent_id_idx
  ON public.agent_shortcuts (agent_id);

ALTER TABLE public.agent_shortcuts ENABLE ROW LEVEL SECURITY;

-- Any active user of the agent can READ the bindings so the shortcut
-- listener applies them for the whole staff. Super admin bypasses via
-- has_role.
DROP POLICY IF EXISTS "agent_shortcuts read own agent" ON public.agent_shortcuts;
CREATE POLICY "agent_shortcuts read own agent"
  ON public.agent_shortcuts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (SELECT agent_id FROM public.agent_users WHERE user_id = auth.uid() LIMIT 1) = agent_id
  );

-- Only the agent's admin (or the Thiqa super admin, via has_role) can
-- INSERT / UPDATE / DELETE.
DROP POLICY IF EXISTS "agent_shortcuts write admin only" ON public.agent_shortcuts;
CREATE POLICY "agent_shortcuts write admin only"
  ON public.agent_shortcuts
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    AND (SELECT agent_id FROM public.agent_users WHERE user_id = auth.uid() LIMIT 1) = agent_id
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND (SELECT agent_id FROM public.agent_users WHERE user_id = auth.uid() LIMIT 1) = agent_id
  );

-- Bump updated_at on UPDATE so the admin can sort/audit changes later.
CREATE OR REPLACE FUNCTION public.touch_agent_shortcuts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_agent_shortcuts_updated_at ON public.agent_shortcuts;
CREATE TRIGGER trg_touch_agent_shortcuts_updated_at
  BEFORE UPDATE ON public.agent_shortcuts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_agent_shortcuts_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_shortcuts TO authenticated;
