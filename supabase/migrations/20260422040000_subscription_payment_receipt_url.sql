-- Add receipt_url to agent_subscription_payments so the auto-generated
-- PDF invoice can be stored + referenced from both the Thiqa admin
-- payments log and the agent's /subscription history.
ALTER TABLE public.agent_subscription_payments
  ADD COLUMN IF NOT EXISTS receipt_url text;
