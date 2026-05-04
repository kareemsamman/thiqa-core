-- Re-stamp every locked visa row to the new dedicated enum value. The
-- old convention was payment_type='visa' + locked=true rendered as
-- "فيزا خارجي"; with the new visa_external value the label is driven
-- directly by payment_type so every consumer (wizard Select, dialogs,
-- invoices, accounting reports) shows the same text without
-- depending on the locked flag.
--
-- The prevent_locked_payment_modification trigger only locks the
-- amount column on locked rows after migration 20260504130000, so
-- this UPDATE passes through without any bypass.

UPDATE public.policy_payments
SET payment_type = 'visa_external'
WHERE locked = true
  AND payment_type = 'visa';
