-- Create branches table
CREATE TABLE public.branches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  name_ar text,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

-- All active users can view branches
CREATE POLICY "Active users can view branches"
ON public.branches FOR SELECT
USING (is_active_user(auth.uid()));

-- Only admins can manage branches
CREATE POLICY "Admins can manage branches"
ON public.branches FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Insert default branches
INSERT INTO public.branches (name, name_ar, slug) VALUES
  ('Beit Hanina', 'بيت حنينا', 'beit-hanina'),
  ('Kafr Aqab', 'كفر عقب', 'kafr-aqab');

-- Add branch_id to profiles (for worker assignment)
ALTER TABLE public.profiles 
ADD COLUMN branch_id uuid REFERENCES public.branches(id);

-- Add branch_id to clients
ALTER TABLE public.clients 
ADD COLUMN branch_id uuid REFERENCES public.branches(id);

-- Add branch_id to policies
ALTER TABLE public.policies 
ADD COLUMN branch_id uuid REFERENCES public.branches(id);

-- Add branch_id to cars
ALTER TABLE public.cars 
ADD COLUMN branch_id uuid REFERENCES public.branches(id);

-- Add branch_id to invoices
ALTER TABLE public.invoices 
ADD COLUMN branch_id uuid REFERENCES public.branches(id);

-- Add branch_id to policy_payments
ALTER TABLE public.policy_payments 
ADD COLUMN branch_id uuid REFERENCES public.branches(id);

-- Add branch_id to media_files
ALTER TABLE public.media_files 
ADD COLUMN branch_id uuid REFERENCES public.branches(id);

-- Add branch_id to outside_cheques
ALTER TABLE public.outside_cheques 
ADD COLUMN branch_id uuid REFERENCES public.branches(id);

-- Set default branch for all tables (except policy_payments which has trigger)
UPDATE public.clients SET branch_id = (SELECT id FROM public.branches WHERE slug = 'beit-hanina');
UPDATE public.policies SET branch_id = (SELECT id FROM public.branches WHERE slug = 'beit-hanina');
UPDATE public.cars SET branch_id = (SELECT id FROM public.branches WHERE slug = 'beit-hanina');
UPDATE public.invoices SET branch_id = (SELECT id FROM public.branches WHERE slug = 'beit-hanina');
UPDATE public.media_files SET branch_id = (SELECT id FROM public.branches WHERE slug = 'beit-hanina');
UPDATE public.outside_cheques SET branch_id = (SELECT id FROM public.branches WHERE slug = 'beit-hanina');
UPDATE public.profiles SET branch_id = (SELECT id FROM public.branches WHERE slug = 'beit-hanina');

-- For policy_payments, disable trigger first
ALTER TABLE public.policy_payments DISABLE TRIGGER trg_validate_policy_payment_total;
UPDATE public.policy_payments SET branch_id = (SELECT id FROM public.branches WHERE slug = 'beit-hanina');
ALTER TABLE public.policy_payments ENABLE TRIGGER trg_validate_policy_payment_total;

-- Create indexes for performance
CREATE INDEX idx_clients_branch ON public.clients(branch_id);
CREATE INDEX idx_policies_branch ON public.policies(branch_id);
CREATE INDEX idx_cars_branch ON public.cars(branch_id);
CREATE INDEX idx_invoices_branch ON public.invoices(branch_id);
CREATE INDEX idx_policy_payments_branch ON public.policy_payments(branch_id);
CREATE INDEX idx_media_files_branch ON public.media_files(branch_id);
CREATE INDEX idx_outside_cheques_branch ON public.outside_cheques(branch_id);
CREATE INDEX idx_profiles_branch ON public.profiles(branch_id);

-- Create function to get user's branch_id
CREATE OR REPLACE FUNCTION public.get_user_branch_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.profiles WHERE id = _user_id
$$;

-- Create function to check if user can access a branch
CREATE OR REPLACE FUNCTION public.can_access_branch(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE 
      WHEN public.has_role(_user_id, 'admin') THEN true
      ELSE (SELECT branch_id FROM public.profiles WHERE id = _user_id) = _branch_id
    END
$$;

-- Update trigger for branches
CREATE TRIGGER update_branches_updated_at
BEFORE UPDATE ON public.branches
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();