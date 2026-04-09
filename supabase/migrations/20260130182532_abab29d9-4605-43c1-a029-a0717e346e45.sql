-- Create business_contacts table for storing professional contacts
CREATE TABLE public.business_contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  phone text,
  email text,
  category text DEFAULT 'other' CHECK (category IN ('appraiser', 'insurance_company', 'garage', 'other')),
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.business_contacts ENABLE ROW LEVEL SECURITY;

-- All active users can read contacts
CREATE POLICY "Active users can read contacts"
  ON public.business_contacts FOR SELECT
  USING (is_active_user(auth.uid()));

-- All active users can insert contacts
CREATE POLICY "Active users can insert contacts"
  ON public.business_contacts FOR INSERT
  WITH CHECK (is_active_user(auth.uid()));

-- All active users can update contacts
CREATE POLICY "Active users can update contacts"
  ON public.business_contacts FOR UPDATE
  USING (is_active_user(auth.uid()));

-- All active users can delete contacts
CREATE POLICY "Active users can delete contacts"
  ON public.business_contacts FOR DELETE
  USING (is_active_user(auth.uid()));

-- Index for search performance
CREATE INDEX idx_business_contacts_search ON public.business_contacts (name, phone, category);
CREATE INDEX idx_business_contacts_category ON public.business_contacts (category);

-- Trigger to update updated_at on changes
CREATE TRIGGER update_business_contacts_updated_at
  BEFORE UPDATE ON public.business_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();