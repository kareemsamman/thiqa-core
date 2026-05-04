DELETE FROM policy_payments WHERE policy_id IN (SELECT id FROM policies WHERE client_id='6acf6370-1823-4021-9610-fa77eec8cbc2');
DELETE FROM policies WHERE client_id='6acf6370-1823-4021-9610-fa77eec8cbc2';
DELETE FROM policy_groups WHERE client_id='6acf6370-1823-4021-9610-fa77eec8cbc2';
DELETE FROM cars WHERE client_id='6acf6370-1823-4021-9610-fa77eec8cbc2';
DELETE FROM clients WHERE id='6acf6370-1823-4021-9610-fa77eec8cbc2';