-- Backfill sms_logs.client_id from policies.client_id
--
-- Background: send-package-invoice-sms was logging SMS rows with
-- client_id = null because its policies-with-clients query didn't
-- select clients.id (the bug fixed in commit 482ea44). The SMS
-- history page joins sms_logs.client_id -> clients to render the
-- customer name, so those rows showed "-" in the agent column.
--
-- This populates client_id on any existing sms_logs row where it's
-- null but the linked policy has a client_id.

UPDATE public.sms_logs s
SET client_id = p.client_id
FROM public.policies p
WHERE s.policy_id = p.id
  AND s.client_id IS NULL
  AND p.client_id IS NOT NULL;
