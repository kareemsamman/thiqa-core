-- =============================================================================
-- plan_change_events — audit trail of every plan switch an agent initiates
-- =============================================================================
-- Written by the change-agent-plan edge function after the agent confirms a
-- switch from the upgrade popup or the subscription page. Drives the
-- /thiqa/plan-changes admin view and the email notification to
-- support@getthiqa.com. Kept separate from agent_subscription_payments so
-- "the agent asked to move plans" and "the agent paid their invoice" stay
-- distinct signals.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.plan_change_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  changed_by_user   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  from_plan         text NOT NULL,
  to_plan           text NOT NULL,
  from_price        numeric(10,2) NOT NULL DEFAULT 0,
  to_price          numeric(10,2) NOT NULL DEFAULT 0,
  -- 'immediate'     → paid agent switched now, billing changes right away.
  -- 'after_trial'   → trial agent selected a post-trial plan (writes to
  --                   agents.pending_plan, actual switch happens when trial
  --                   ends).
  -- 'cancelled'     → user initiated but request was rolled back.
  switch_mode       text NOT NULL CHECK (switch_mode IN ('immediate', 'after_trial', 'cancelled')),
  privacy_accepted  boolean NOT NULL DEFAULT false,
  notes             text,
  email_sent        boolean NOT NULL DEFAULT false,
  email_error       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_change_events_agent_id
  ON public.plan_change_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_plan_change_events_created_at
  ON public.plan_change_events(created_at DESC);

-- RLS: agents can read their own history (for a "my plan changes" list in
-- settings if we ever surface it), super admins read everything, no direct
-- INSERT/UPDATE from the client — only the edge function (service role)
-- may write rows.
ALTER TABLE public.plan_change_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_change_events_select_own ON public.plan_change_events;
CREATE POLICY plan_change_events_select_own
  ON public.plan_change_events FOR SELECT
  TO authenticated
  USING (
    agent_id IN (
      SELECT au.agent_id FROM public.agent_users au WHERE au.user_id = auth.uid()
    )
    OR public.is_super_admin(auth.uid())
  );

-- No SELECT-all policy — super admin path is the EXISTS branch above.
-- No INSERT / UPDATE / DELETE policies: writes go through the service role.
