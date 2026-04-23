-- Add `billing_cycle` to agents so the plan-change flow knows whether
-- the agent is on monthly or yearly billing. Default is 'monthly' so
-- every existing agent is unchanged until they explicitly opt into
-- yearly during a plan switch.
--
-- No trigger-level enforcement needed — the change-agent-plan edge
-- function is the only writer, and subscription_plans.yearly_price
-- stays authoritative for the annual amount.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly'));

COMMENT ON COLUMN public.agents.billing_cycle IS
  'Whether the agent is billed monthly or yearly. Defaults to monthly. Set via the change-agent-plan edge function based on the toggle in PlanChangeConfirmDialog.';
