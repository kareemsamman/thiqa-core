-- Fix existing ELZAMI policies: set profit=0 and elzami_cost from company commission
UPDATE policies p
SET 
  profit = 0,
  elzami_cost = COALESCE((SELECT elzami_commission FROM insurance_companies WHERE id = p.company_id), 0)
WHERE p.policy_type_parent = 'ELZAMI'
AND p.deleted_at IS NULL;

-- Verify triggers exist, if not create them
DO $$
BEGIN
  -- Check and create trigger for policies
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_policy_created') THEN
    CREATE TRIGGER ledger_policy_created
      AFTER INSERT ON public.policies
      FOR EACH ROW
      EXECUTE FUNCTION public.ledger_on_policy_created();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_policy_cancelled') THEN
    CREATE TRIGGER ledger_policy_cancelled
      AFTER UPDATE ON public.policies
      FOR EACH ROW
      WHEN (NEW.cancelled = true AND (OLD.cancelled IS NULL OR OLD.cancelled = false))
      EXECUTE FUNCTION public.ledger_on_policy_cancelled();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_payment_received') THEN
    CREATE TRIGGER ledger_payment_received
      AFTER INSERT ON public.policy_payments
      FOR EACH ROW
      EXECUTE FUNCTION public.ledger_on_payment_received();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_payment_refused') THEN
    CREATE TRIGGER ledger_payment_refused
      AFTER UPDATE ON public.policy_payments
      FOR EACH ROW
      WHEN (NEW.refused = true AND (OLD.refused IS NULL OR OLD.refused = false))
      EXECUTE FUNCTION public.ledger_on_payment_refused();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_broker_settlement') THEN
    CREATE TRIGGER ledger_broker_settlement
      AFTER INSERT ON public.broker_settlements
      FOR EACH ROW
      EXECUTE FUNCTION public.ledger_on_broker_settlement();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_customer_refund') THEN
    CREATE TRIGGER ledger_customer_refund
      AFTER INSERT ON public.customer_wallet_transactions
      FOR EACH ROW
      EXECUTE FUNCTION public.ledger_on_customer_refund();
  END IF;
END $$;