-- Clean up the test import for סאמר מחפוז (F0020) so we can re-import as a package
DELETE FROM public.policy_payments WHERE policy_id IN (
  SELECT id FROM public.policies WHERE client_id='9da71c97-b781-47c0-b712-9aaeafa8131a'
);
DELETE FROM public.policies WHERE client_id='9da71c97-b781-47c0-b712-9aaeafa8131a';
DELETE FROM public.cars WHERE client_id='9da71c97-b781-47c0-b712-9aaeafa8131a';
DELETE FROM public.clients WHERE id='9da71c97-b781-47c0-b712-9aaeafa8131a';