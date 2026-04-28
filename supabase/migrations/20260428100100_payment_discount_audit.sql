-- =============================================================================
-- Audit trail for discounts applied to subscription payments
-- =============================================================================
-- agent_discounts records "150 ₪ instead of 300 for 3 months" deals,
-- but agent_subscription_payments has no link back — so when Thiqa
-- looks at a 150 payment row, there's no way to tell whether it's a
-- discounted full-payment or an underpayment. After enough deals,
-- nobody can reconcile the books.
--
-- Adding two columns:
--   discount_id     — FK to agent_discounts. ON DELETE SET NULL so
--                      removing an old discount row doesn't cascade
--                      and zero out the audit trail on payments that
--                      already happened.
--   discount_amount — the savings vs the plan's normal monthly_price.
--                      Stored explicitly (not derived) so historical
--                      reports stay correct even if the plan price
--                      later changes.
--
-- Both default to NULL/0 so existing rows backfill cleanly.
-- =============================================================================

ALTER TABLE public.agent_subscription_payments
  ADD COLUMN IF NOT EXISTS discount_id uuid
    REFERENCES public.agent_discounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0 NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_subscription_payments_discount_id
  ON public.agent_subscription_payments(discount_id)
  WHERE discount_id IS NOT NULL;

COMMENT ON COLUMN public.agent_subscription_payments.discount_id IS
  'Optional FK to the agent_discounts row applied to this payment. NULL when no discount was used.';
COMMENT ON COLUMN public.agent_subscription_payments.discount_amount IS
  'Discount amount (in ₪) deducted from the plan price for this payment. Defaults to 0. Stored explicitly so the audit survives later plan-price edits.';
