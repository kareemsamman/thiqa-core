ALTER TABLE public.agent_subscription_payments 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

WITH latest AS (
  SELECT DISTINCT ON (agent_id) id 
  FROM public.agent_subscription_payments 
  ORDER BY agent_id, payment_date DESC, created_at DESC
)
UPDATE public.agent_subscription_payments 
SET status = 'done' 
WHERE id NOT IN (SELECT id FROM latest);