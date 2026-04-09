-- Create import_progress table for tracking import jobs
CREATE TABLE IF NOT EXISTS public.import_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type text NOT NULL, -- 'full', 'media', 'companies', etc.
  total_items integer NOT NULL DEFAULT 0,
  processed_items integer NOT NULL DEFAULT 0,
  failed_items integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'paused', 'completed', 'failed'
  started_at timestamptz,
  estimated_finish_at timestamptz,
  last_processed_id text,
  error_log jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb, -- store branch_id, preserved rules, etc.
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.import_progress ENABLE ROW LEVEL SECURITY;

-- Only admins can manage import progress
CREATE POLICY "Admins can manage import progress"
ON public.import_progress
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for updated_at
CREATE TRIGGER update_import_progress_updated_at
BEFORE UPDATE ON public.import_progress
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();