-- After the WhatsApp bot sends the accident-info checklist, customers
-- often reply with a proposed appointment time ("بكره ع ساعة 5") to come
-- in and file the claim. The bot now files those as a separate request
-- type so they show up under their own filter on /customer-requests.
ALTER TABLE customer_requests DROP CONSTRAINT IF EXISTS customer_requests_request_type_check;
ALTER TABLE customer_requests ADD CONSTRAINT customer_requests_request_type_check
  CHECK (request_type = ANY (ARRAY[
    'quote'::text,
    'accident'::text,
    'general'::text,
    'help'::text,
    'manager'::text,
    'support'::text,
    'accident_appointment'::text
  ]));
