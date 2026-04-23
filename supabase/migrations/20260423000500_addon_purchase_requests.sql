-- =============================================================================
-- Self-serve addon purchase requests
-- =============================================================================
-- Agents can now request an addon directly from /subscription instead of
-- going through WhatsApp. A request creates an agent_addons row with
-- status='pending_approval' — it doesn't count toward quotas yet (the
-- limit triggers only look at status='active'), and Thiqa gets an email
-- + a row to approve or reject from the agent detail page.
--
-- Thiqa admin flow:
--   approve → UPDATE status = 'active'   (seat / branch / credit becomes live)
--   reject  → UPDATE status = 'rejected' (keeps the row for history)
-- =============================================================================

-- Extend the status check constraint to include the new lifecycle states.
ALTER TABLE public.agent_addons
  DROP CONSTRAINT IF EXISTS agent_addons_status_check;

ALTER TABLE public.agent_addons
  ADD CONSTRAINT agent_addons_status_check
  CHECK (status IN ('active', 'cancelled', 'pending_approval', 'rejected'));

-- Provenance / review metadata. Nullable — historical rows don't have it.
ALTER TABLE public.agent_addons
  ADD COLUMN IF NOT EXISTS requested_by_user_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE INDEX IF NOT EXISTS idx_agent_addons_pending
  ON public.agent_addons(status)
  WHERE status = 'pending_approval';

-- Allow agent admins to INSERT rows for their own agent, but only with
-- status='pending_approval'. This is the policy that lets the
-- agent-facing "buy addon" button work without a service-role call.
-- (Service-role edge functions still bypass RLS; this is a defense in
-- depth if we ever call from the client directly.)
DROP POLICY IF EXISTS agent_addons_agent_request ON public.agent_addons;
CREATE POLICY agent_addons_agent_request ON public.agent_addons
  FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND agent_id = public.get_user_agent_id(auth.uid())
    AND status = 'pending_approval'
  );
