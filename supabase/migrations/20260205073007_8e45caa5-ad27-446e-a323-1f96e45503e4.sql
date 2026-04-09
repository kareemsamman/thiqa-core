-- Add new columns to accident_reports for additional fields from PDF forms
ALTER TABLE public.accident_reports
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_phone TEXT,
  ADD COLUMN IF NOT EXISTS driver_license_grade TEXT,
  ADD COLUMN IF NOT EXISTS driver_license_issue_date DATE,
  ADD COLUMN IF NOT EXISTS vehicle_chassis_number TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_speed_at_accident TEXT,
  ADD COLUMN IF NOT EXISTS employee_notes TEXT,
  ADD COLUMN IF NOT EXISTS employee_signature_date DATE,
  ADD COLUMN IF NOT EXISTS customer_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS customer_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_signature_ip TEXT,
  ADD COLUMN IF NOT EXISTS signature_token TEXT,
  ADD COLUMN IF NOT EXISTS signature_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signature_phone_override TEXT;

-- Create index for signature token lookup
CREATE INDEX IF NOT EXISTS idx_accident_reports_signature_token 
  ON public.accident_reports(signature_token) 
  WHERE signature_token IS NOT NULL;

-- Create injured persons table for tracking multiple injuries per accident
CREATE TABLE IF NOT EXISTS public.accident_injured_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accident_report_id UUID NOT NULL REFERENCES public.accident_reports(id) ON DELETE CASCADE,
  injured_name TEXT NOT NULL,
  injured_age INT,
  injured_address TEXT,
  injured_occupation TEXT,
  injured_salary TEXT,
  injury_type TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on injured persons table
ALTER TABLE public.accident_injured_persons ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for injured persons (same access as accident_reports)
CREATE POLICY "Users can view injured persons for accessible accident reports"
  ON public.accident_injured_persons
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.accident_reports ar
      WHERE ar.id = accident_report_id
    )
  );

CREATE POLICY "Users can insert injured persons for accessible accident reports"
  ON public.accident_injured_persons
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.accident_reports ar
      WHERE ar.id = accident_report_id
    )
  );

CREATE POLICY "Users can update injured persons for accessible accident reports"
  ON public.accident_injured_persons
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.accident_reports ar
      WHERE ar.id = accident_report_id
    )
  );

CREATE POLICY "Users can delete injured persons for accessible accident reports"
  ON public.accident_injured_persons
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.accident_reports ar
      WHERE ar.id = accident_report_id
    )
  );

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_accident_injured_persons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_accident_injured_persons_updated_at ON public.accident_injured_persons;
CREATE TRIGGER update_accident_injured_persons_updated_at
  BEFORE UPDATE ON public.accident_injured_persons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_accident_injured_persons_updated_at();