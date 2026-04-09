-- Create triggers for automatic ledger entries

-- Trigger for new policies
CREATE TRIGGER ledger_policy_created
  AFTER INSERT ON public.policies
  FOR EACH ROW
  EXECUTE FUNCTION public.ledger_on_policy_created();

-- Trigger for policy cancellation
CREATE TRIGGER ledger_policy_cancelled
  AFTER UPDATE ON public.policies
  FOR EACH ROW
  WHEN (NEW.cancelled = true AND (OLD.cancelled IS NULL OR OLD.cancelled = false))
  EXECUTE FUNCTION public.ledger_on_policy_cancelled();

-- Trigger for payment received
CREATE TRIGGER ledger_payment_received
  AFTER INSERT ON public.policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.ledger_on_payment_received();

-- Trigger for payment refused (cheque returned)
CREATE TRIGGER ledger_payment_refused
  AFTER UPDATE ON public.policy_payments
  FOR EACH ROW
  WHEN (NEW.refused = true AND (OLD.refused IS NULL OR OLD.refused = false))
  EXECUTE FUNCTION public.ledger_on_payment_refused();

-- Trigger for broker settlement
CREATE TRIGGER ledger_broker_settlement
  AFTER INSERT ON public.broker_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.ledger_on_broker_settlement();

-- Trigger for customer wallet transactions (refunds)
CREATE TRIGGER ledger_customer_refund
  AFTER INSERT ON public.customer_wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.ledger_on_customer_refund();