-- Change insurance_companies.category_parent from single enum to array
ALTER TABLE public.insurance_companies
  ALTER COLUMN category_parent TYPE policy_type_parent[] 
  USING CASE 
    WHEN category_parent IS NULL THEN ARRAY[]::policy_type_parent[] 
    ELSE ARRAY[category_parent]::policy_type_parent[] 
  END;

-- Drop group_id column from insurance_companies (not needed per user feedback)
ALTER TABLE public.insurance_companies DROP COLUMN IF EXISTS group_id;

-- Create accident_fee_services table (catalog similar to road_services)
CREATE TABLE public.accident_fee_services (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  name_ar text,
  description text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.accident_fee_services ENABLE ROW LEVEL SECURITY;

-- RLS policies for accident_fee_services
CREATE POLICY "Active users can view accident fee services"
  ON public.accident_fee_services
  FOR SELECT
  USING (is_active_user(auth.uid()));

CREATE POLICY "Admins can manage accident fee services"
  ON public.accident_fee_services
  FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Create company_accident_fee_prices table (pricing per service per company)
CREATE TABLE public.company_accident_fee_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  accident_fee_service_id uuid NOT NULL REFERENCES public.accident_fee_services(id) ON DELETE CASCADE,
  company_cost numeric NOT NULL DEFAULT 0,
  notes text,
  effective_from date,
  effective_to date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(company_id, accident_fee_service_id)
);

-- Enable RLS
ALTER TABLE public.company_accident_fee_prices ENABLE ROW LEVEL SECURITY;

-- RLS policies for company_accident_fee_prices
CREATE POLICY "Active users can view accident fee prices"
  ON public.company_accident_fee_prices
  FOR SELECT
  USING (is_active_user(auth.uid()));

CREATE POLICY "Admins can manage accident fee prices"
  ON public.company_accident_fee_prices
  FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Add updated_at triggers
CREATE TRIGGER update_accident_fee_services_updated_at
  BEFORE UPDATE ON public.accident_fee_services
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_company_accident_fee_prices_updated_at
  BEFORE UPDATE ON public.company_accident_fee_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();