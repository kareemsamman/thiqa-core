-- Auto-sync agents.subscription_expires_at to the latest payment's period_end
--
-- Thiqa admin records each payment with a period_start / period_end
-- range (e.g. a 3-month payment ends 3 months from now). The agent's
-- /subscription page reads agents.subscription_expires_at to compute
-- "متبقي على التجديد" and "تاريخ الفاتورة القادمة" — but until now
-- nothing kept that column in sync with the payments. So a 3-month
-- payment recorded by admin would still show the agent "30 days
-- remaining" because the row's expiry hadn't moved. The
-- ThiqaAgentDetail.recordPayment() handler bumps it on the new-payment
-- path; this trigger covers edits, deletes, and historical rows.
--
-- Rule: subscription_expires_at = GREATEST(current value, MAX(period_end))
-- across all payments for that agent. We never pull the date BACKWARDS,
-- so any complimentary extension the admin set by hand stays put. Only
-- a future-dated payment can push the expiry forward.

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
  -- DELETE has no NEW; INSERT/UPDATE both expose NEW. Pick the right
  -- agent_id (and on UPDATE the agent_id can't change in practice but
  -- handle both rows defensively in case it ever does).
  v_agent_id := COALESCE(NEW.agent_id, OLD.agent_id);
  IF v_agent_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT MAX(period_end) INTO v_max_period_end
  FROM public.agent_subscription_payments
  WHERE agent_id = v_agent_id
    AND period_end IS NOT NULL;

  IF v_max_period_end IS NOT NULL THEN
    UPDATE public.agents
    SET subscription_expires_at = GREATEST(
          COALESCE(subscription_expires_at, '-infinity'::timestamptz),
          v_max_period_end::timestamptz
        ),
        updated_at = now()
    WHERE id = v_agent_id
      AND (
        subscription_expires_at IS NULL
        OR subscription_expires_at < v_max_period_end::timestamptz
      );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_agent_expiry_from_payments
  ON public.agent_subscription_payments;
CREATE TRIGGER trg_sync_agent_expiry_from_payments
  AFTER INSERT OR UPDATE OF period_end OR DELETE
  ON public.agent_subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_agent_expiry_from_payments();

-- One-off backfill: for every agent that already has payments on file,
-- push subscription_expires_at forward to MAX(period_end). Same
-- never-go-backwards rule, so admin-granted complimentary extensions
-- stay intact.
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
  AND (
    a.subscription_expires_at IS NULL
    OR a.subscription_expires_at < mp.max_period_end::timestamptz
  );
