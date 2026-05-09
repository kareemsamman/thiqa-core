-- Allow the WhatsApp bot to file richer request types beyond the
-- original quote/accident/general triple. The state machine writes
-- 'help' for "couldn't resolve your account, want a callback?" turns
-- and 'manager' for explicit "بدي احكي مع المدير" requests; both were
-- being silently rejected by the prior CHECK constraint, so the rows
-- never landed in the customer_requests page.
ALTER TABLE customer_requests DROP CONSTRAINT IF EXISTS customer_requests_request_type_check;
ALTER TABLE customer_requests ADD CONSTRAINT customer_requests_request_type_check
  CHECK (request_type = ANY (ARRAY[
    'quote'::text,
    'accident'::text,
    'general'::text,
    'help'::text,
    'manager'::text,
    'support'::text
  ]));

-- Surface new requests to the dashboard in real time. The
-- /customer-requests page subscribes to INSERTs on this table to play
-- a chime + show a toast as soon as a customer's WhatsApp turn lands;
-- without the publication entry the realtime channel would silently
-- never fire.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'customer_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customer_requests;
  END IF;
END$$;
