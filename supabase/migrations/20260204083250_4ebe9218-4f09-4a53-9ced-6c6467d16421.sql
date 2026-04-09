-- Remove old UNIQUE constraints that don't exclude soft-deleted records
-- These constraints prevent reusing car_number and id_number after deletion

-- Drop cars constraints (keep only the partial unique index)
ALTER TABLE public.cars DROP CONSTRAINT IF EXISTS cars_car_number_key;
ALTER TABLE public.cars DROP CONSTRAINT IF EXISTS cars_car_number_unique;

-- Drop clients constraints (keep only the partial unique index)
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_id_number_key;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_id_number_unique;

-- The correct partial unique indexes already exist:
-- idx_cars_car_number_unique (WHERE deleted_at IS NULL)
-- idx_clients_id_number_unique (WHERE deleted_at IS NULL)