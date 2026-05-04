-- Cleanup F0020 test data so we can re-import with the new combined-service logic
DELETE FROM policy_payments WHERE policy_id IN (SELECT id FROM policies WHERE client_id='2a2857de-f97e-4ade-be2a-9de857b34e1b');
DELETE FROM policies WHERE client_id='2a2857de-f97e-4ade-be2a-9de857b34e1b';
DELETE FROM policy_groups WHERE client_id='2a2857de-f97e-4ade-be2a-9de857b34e1b';
DELETE FROM cars WHERE client_id='2a2857de-f97e-4ade-be2a-9de857b34e1b';
DELETE FROM clients WHERE id='2a2857de-f97e-4ade-be2a-9de857b34e1b';