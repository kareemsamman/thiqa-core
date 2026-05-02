-- Make agents.subscription_expires_at a strict mirror of MAX(period_end)
--
-- The first version of this trigger (20260502160000) used
-- GREATEST(current, MAX(period_end)) so manual complimentary
-- extensions on the agent row could never be yanked backwards by a
-- shorter payment. But that protection backfires the other direction:
-- when the Thiqa admin EDITS the only payment to shorten its
-- period_end (e.g. correcting a typo from 07/08 to 05/08), the agent's
-- expiry stays at the old longer date — the agent's "متبقي على التجديد"
-- and "تاريخ الانتهاء" lag behind what the admin sees in the payment
-- form.
--
-- Replace with a strict mirror: subscription_expires_at always equals
-- MAX(period_end) across the agent's payments. If the admin needs to
-- grant a goodwill extension beyond the latest payment, they record a
-- complimentary payment row instead of editing the agent column.

CREATE OR REPLACE FUNCTION public.sync_agent_expiry_from_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id uuid;
  v_max_period_end date;
BEGIN
  v_agent_id := COALESCE(NEW.agent_id, OLD.agent_id);
  IF v_agent_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT MAX(period_end) INTO v_max_period_end
  FROM public.agent_subscription_payments
  WHERE agent_id = v_agent_id
    AND period_end IS NOT NULL;

  -- Strict mirror — even if the new MAX is earlier than the current
  -- expiry. NULL max (last payment with period_end was deleted) leaves
  -- the column alone; we don't want to wipe a paid agent's expiry just
  -- because their payment history got cleaned up.
  IF v_max_period_end IS NOT NULL THEN
    UPDATE public.agents
    SET subscription_expires_at = v_max_period_end::timestamptz,
        updated_at = now()
    WHERE id = v_agent_id
      AND COALESCE(subscription_expires_at, '-infinity'::timestamptz)
            IS DISTINCT FROM v_max_period_end::timestamptz;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- One-off resync so existing rows that the GREATEST version left
-- "ahead" of their payments snap back to the latest payment's
-- period_end. Same agents touched by the previous backfill, just
-- without the never-go-backwards clause.
WITH max_periods AS (
  SELECT agent_id, MAX(period_end) AS max_period_end
  FROM public.agent_subscription_payments
  WHERE period_end IS NOT NULL
  GROUP BY agent_id
)
UPDATE public.agents a
SET subscription_expires_at = mp.max_period_end::timestamptz,
    updated_at = now()
FROM max_periods mp
WHERE mp.agent_id = a.id
  AND COALESCE(a.subscription_expires_at, '-infinity'::timestamptz)
        IS DISTINCT FROM mp.max_period_end::timestamptz;
