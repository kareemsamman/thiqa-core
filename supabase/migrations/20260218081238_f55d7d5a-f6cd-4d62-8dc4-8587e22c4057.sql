
ALTER TABLE public.settlement_supplements
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS car_number text,
  ADD COLUMN IF NOT EXISTS car_value numeric,
  ADD COLUMN IF NOT EXISTS policy_type text,
  ADD COLUMN IF NOT EXISTS is_cancelled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date;
