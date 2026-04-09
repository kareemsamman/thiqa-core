-- Create sequence for auto-generating file numbers
CREATE SEQUENCE IF NOT EXISTS public.client_file_number_seq START WITH 1001;

-- Function to generate next file number
CREATE OR REPLACE FUNCTION public.generate_file_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT nextval('client_file_number_seq') INTO next_num;
  RETURN 'F' || LPAD(next_num::TEXT, 4, '0');
END;
$$;

-- Add unique constraint on clients.id_number if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_id_number_unique'
  ) THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_id_number_unique UNIQUE (id_number);
  END IF;
END $$;

-- Add unique constraint on cars.car_number if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cars_car_number_unique'
  ) THEN
    ALTER TABLE public.cars ADD CONSTRAINT cars_car_number_unique UNIQUE (car_number);
  END IF;
END $$;

-- Initialize sequence based on existing file numbers
DO $$
DECLARE
  max_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(REGEXP_REPLACE(file_number, '[^0-9]', '', 'g')::INTEGER), 1000) 
  INTO max_num 
  FROM public.clients 
  WHERE file_number IS NOT NULL AND file_number ~ '^F[0-9]+$';
  
  IF max_num >= 1001 THEN
    PERFORM setval('client_file_number_seq', max_num);
  END IF;
END $$;