-- Add deleted_at columns for soft delete support
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Create index for faster filtering of non-deleted records
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON public.clients(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cars_deleted_at ON public.cars(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_policies_deleted_at ON public.policies(deleted_at) WHERE deleted_at IS NULL;