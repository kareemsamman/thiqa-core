-- Speed up the global inline search.
--
-- The header/bottom-toolbar search runs `ilike '%term%'` (leading wildcard)
-- across several columns in parallel. A B-tree index can't satisfy a
-- leading-wildcard pattern, so without trigram (pg_trgm) GIN indexes
-- Postgres falls back to sequential scans -- which becomes painful as
-- the data grows (10s+ at 100k rows).
--
-- pg_trgm is already enabled (see 20260413270000_clients_full_name_normalized.sql),
-- and clients.full_name_normalized already has a trgm GIN. This migration
-- adds the missing trgm indexes for every other column the search hits.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- clients
CREATE INDEX IF NOT EXISTS idx_clients_phone_number_trgm
  ON public.clients USING gin (phone_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_phone_number_2_trgm
  ON public.clients USING gin (phone_number_2 gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_id_number_trgm
  ON public.clients USING gin (id_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clients_file_number_trgm
  ON public.clients USING gin (file_number gin_trgm_ops);

-- cars
CREATE INDEX IF NOT EXISTS idx_cars_car_number_trgm
  ON public.cars USING gin (car_number gin_trgm_ops);

-- policies
CREATE INDEX IF NOT EXISTS idx_policies_document_number_trgm
  ON public.policies USING gin (document_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_policies_policy_number_trgm
  ON public.policies USING gin (policy_number gin_trgm_ops);

-- policy_payments
CREATE INDEX IF NOT EXISTS idx_policy_payments_receipt_number_trgm
  ON public.policy_payments USING gin (receipt_number gin_trgm_ops);
