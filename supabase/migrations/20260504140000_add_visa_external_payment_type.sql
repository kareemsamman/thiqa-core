-- Add a real "visa_external" enum value to payment_type. Until now the
-- agency tracked external visa charges (paid by the customer directly
-- on the insurance company's portal for ELZAMI premiums) by storing
-- payment_type='visa' + locked=true and rendering it as "فيزا خارجي"
-- via getPaymentTypeLabel. That worked when the auto-row was the only
-- way to create such a payment, but the wizard now lets the agent
-- pick it manually too — so we need a distinct value that:
--
--   1. Coexists with the regular 'visa' (Tranzila) option in the same
--      Select dropdown.
--   2. Is available to ALL agents, regardless of the visa_payment
--      feature flag (Tranzila gating doesn't apply since no actual
--      card is charged through us).
--
-- ALTER TYPE … ADD VALUE cannot be used in the same transaction as
-- queries that reference the new value (Postgres only commits the
-- enum addition at transaction end). Back-fill of existing locked
-- rows lives in the follow-up migration 20260504140100.

ALTER TYPE public.payment_type ADD VALUE IF NOT EXISTS 'visa_external';
