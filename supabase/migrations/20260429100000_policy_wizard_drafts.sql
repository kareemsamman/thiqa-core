-- Per-user policy-wizard draft persistence.
--
-- The policy wizard used to persist its open/minimized instances and
-- the form snapshot for each one in localStorage. That broke two
-- requirements:
--   1. Per-user scope. Two users sharing a browser saw each other's
--      drafts; a brand-new account inherited a "3 minimized" badge
--      from whoever used the device first.
--   2. Cross-device continuity. A worker who minimized a policy on
--      their phone couldn't pick it up on their laptop.
--
-- Moving to a real table fixes both. One row per wizard instance.
-- RLS scopes everything to user_id = auth.uid() so even agent admins
-- can't peek at a worker's in-progress drafts (drafts may contain
-- half-typed client data the user hasn't decided to commit yet).

CREATE TABLE IF NOT EXISTS public.policy_wizard_drafts (
  -- Wizard instance id is generated client-side (the existing scheme,
  -- random-base36 + timestamp). Text rather than uuid because the
  -- legacy ids weren't uuids and we want re-mounts to round-trip.
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Denormalized for cleanup when an agent is deleted and for
  -- diagnostic queries — never used for visibility (RLS is by user).
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  preselected_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  -- The compact summary used by the toolbar chip ("client X / step 3
  -- of 5 / car insurance"). Updated whenever the wizard re-derives it.
  draft_summary jsonb,
  -- The entire form snapshot the wizard hydrates from on open: client
  -- selection, new-client form values, car form, policy fields,
  -- payments array, etc. Schema is owned by the wizard hook.
  form_snapshot jsonb,
  -- Timestamp of the FIRST minimize. NULL while the wizard is still
  -- the active editor. Stays fixed across later restore/minimize
  -- cycles so the chip ordering reflects original parking time.
  minimized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_wizard_drafts_user_updated
  ON public.policy_wizard_drafts (user_id, updated_at DESC);

-- updated_at touch trigger so any UPDATE bumps the timestamp without
-- the client having to remember to set it.
CREATE OR REPLACE FUNCTION public.policy_wizard_drafts_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_policy_wizard_drafts_touch ON public.policy_wizard_drafts;
CREATE TRIGGER trg_policy_wizard_drafts_touch
BEFORE UPDATE ON public.policy_wizard_drafts
FOR EACH ROW
EXECUTE FUNCTION public.policy_wizard_drafts_touch();

ALTER TABLE public.policy_wizard_drafts ENABLE ROW LEVEL SECURITY;

-- One catch-all owner policy. user_id is fixed at insert; UPDATE/DELETE
-- and SELECT are all gated to the row's owner. No agent-admin override
-- on purpose: half-typed drafts are personal scratch space.
DROP POLICY IF EXISTS "policy_wizard_drafts_owner_all" ON public.policy_wizard_drafts;
CREATE POLICY "policy_wizard_drafts_owner_all"
  ON public.policy_wizard_drafts FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
