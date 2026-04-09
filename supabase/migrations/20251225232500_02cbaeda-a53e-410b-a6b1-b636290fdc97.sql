-- Add new client fields
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS phone_number_2 text;

-- Create under24_type enum
DO $$ BEGIN
  CREATE TYPE public.under24_type AS ENUM ('none', 'client', 'additional_driver');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add under24 fields to clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS under24_type public.under24_type DEFAULT 'none';
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS under24_driver_name text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS under24_driver_id text;

-- Remove old less_than_24 column after migrating data
UPDATE public.clients SET under24_type = 'client' WHERE less_than_24 = true AND under24_type = 'none';

-- Add comments for documentation
COMMENT ON COLUMN public.clients.birth_date IS 'تاريخ الميلاد';
COMMENT ON COLUMN public.clients.phone_number_2 IS 'هاتف إضافي';
COMMENT ON COLUMN public.clients.under24_type IS 'نوع أقل من 24: none=لا, client=العميل نفسه, additional_driver=سائق إضافي';
COMMENT ON COLUMN public.clients.under24_driver_name IS 'اسم السائق الإضافي';
COMMENT ON COLUMN public.clients.under24_driver_id IS 'رقم هوية السائق الإضافي';