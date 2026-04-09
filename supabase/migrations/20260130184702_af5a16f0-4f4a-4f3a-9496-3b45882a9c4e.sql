-- Create sequence for claim numbers
CREATE SEQUENCE IF NOT EXISTS claim_number_seq START 1;

-- Create repair_claims table
CREATE TABLE public.repair_claims (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_number text UNIQUE,
  garage_name text NOT NULL,
  insurance_company_id uuid REFERENCES insurance_companies(id),
  insurance_file_number text,
  accident_date date,
  car_type text DEFAULT 'external' CHECK (car_type IN ('external', 'insured')),
  external_car_number text,
  external_car_model text,
  client_id uuid REFERENCES clients(id),
  policy_id uuid REFERENCES policies(id),
  status text DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed')),
  repairs_description text,
  total_amount decimal(10,2),
  expense_id uuid REFERENCES expenses(id),
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid REFERENCES auth.users(id)
);

-- Trigger function for auto claim number
CREATE OR REPLACE FUNCTION generate_claim_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.claim_number := 'CLM-' || LPAD(nextval('claim_number_seq')::text, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Trigger to set claim number
CREATE TRIGGER set_claim_number 
  BEFORE INSERT ON repair_claims
  FOR EACH ROW 
  EXECUTE FUNCTION generate_claim_number();

-- Enable RLS - Admin only
ALTER TABLE public.repair_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage repair claims"
  ON public.repair_claims FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR auth.jwt() ->> 'email' = 'morshed500@gmail.com');

-- Index for search
CREATE INDEX idx_repair_claims_status ON public.repair_claims(status);
CREATE INDEX idx_repair_claims_garage ON public.repair_claims(garage_name);

-- Create repair_claim_notes table
CREATE TABLE public.repair_claim_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id uuid REFERENCES repair_claims(id) ON DELETE CASCADE NOT NULL,
  note text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.repair_claim_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage claim notes"
  ON public.repair_claim_notes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR auth.jwt() ->> 'email' = 'morshed500@gmail.com');

-- Create repair_claim_reminders table
CREATE TABLE public.repair_claim_reminders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id uuid REFERENCES repair_claims(id) ON DELETE CASCADE NOT NULL,
  reminder_date date NOT NULL,
  reminder_time time DEFAULT '09:00',
  reminder_type text CHECK (reminder_type IN ('garage', 'insured', 'other')),
  message text,
  is_done boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.repair_claim_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage claim reminders"
  ON public.repair_claim_reminders FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR auth.jwt() ->> 'email' = 'morshed500@gmail.com');

-- Index for reminders
CREATE INDEX idx_repair_claim_reminders_date ON public.repair_claim_reminders(reminder_date) WHERE is_done = false;