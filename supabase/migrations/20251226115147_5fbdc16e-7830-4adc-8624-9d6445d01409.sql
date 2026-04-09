-- =============================================
-- Phase 1: Road Services Catalog System
-- =============================================

-- 1. Insurance Company Groups (for grouping same company across categories)
CREATE TABLE public.insurance_company_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  display_name text NOT NULL UNIQUE,
  display_name_ar text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add group_id to insurance_companies
ALTER TABLE public.insurance_companies 
ADD COLUMN group_id uuid REFERENCES public.insurance_company_groups(id);

-- 2. Road Services Catalog
CREATE TABLE public.road_services (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  name_ar text,
  description text,
  allowed_car_types car_type[] NOT NULL DEFAULT ARRAY['car'::car_type],
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 3. Company Road Service Prices (cost per service per company per car type)
CREATE TABLE public.company_road_service_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  road_service_id uuid NOT NULL REFERENCES public.road_services(id) ON DELETE CASCADE,
  car_type car_type NOT NULL DEFAULT 'car',
  age_band age_band NOT NULL DEFAULT 'ANY',
  company_cost numeric NOT NULL DEFAULT 0,
  notes text,
  effective_from date,
  effective_to date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(company_id, road_service_id, car_type, age_band)
);

-- 4. Policy Groups (for bundling policies together)
CREATE TABLE public.policy_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  car_id uuid REFERENCES public.cars(id),
  name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 5. Add new columns to policies table
ALTER TABLE public.policies 
ADD COLUMN group_id uuid REFERENCES public.policy_groups(id),
ADD COLUMN road_service_id uuid REFERENCES public.road_services(id),
ADD COLUMN company_cost_snapshot numeric;

-- =============================================
-- Enable RLS on new tables
-- =============================================
ALTER TABLE public.insurance_company_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.road_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_road_service_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_groups ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS Policies
-- =============================================

-- Insurance Company Groups
CREATE POLICY "Active users can view company groups" ON public.insurance_company_groups
FOR SELECT USING (is_active_user(auth.uid()));

CREATE POLICY "Admins can manage company groups" ON public.insurance_company_groups
FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Road Services
CREATE POLICY "Active users can view road services" ON public.road_services
FOR SELECT USING (is_active_user(auth.uid()));

CREATE POLICY "Admins can manage road services" ON public.road_services
FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Company Road Service Prices
CREATE POLICY "Active users can view road service prices" ON public.company_road_service_prices
FOR SELECT USING (is_active_user(auth.uid()));

CREATE POLICY "Admins can manage road service prices" ON public.company_road_service_prices
FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Policy Groups
CREATE POLICY "Branch users can view policy groups" ON public.policy_groups
FOR SELECT USING (
  is_active_user(auth.uid()) AND 
  EXISTS (
    SELECT 1 FROM clients c 
    WHERE c.id = policy_groups.client_id 
    AND can_access_branch(auth.uid(), c.branch_id)
  )
);

CREATE POLICY "Branch users can manage policy groups" ON public.policy_groups
FOR ALL USING (
  is_active_user(auth.uid()) AND 
  EXISTS (
    SELECT 1 FROM clients c 
    WHERE c.id = policy_groups.client_id 
    AND can_access_branch(auth.uid(), c.branch_id)
  )
);

-- =============================================
-- Triggers for updated_at
-- =============================================
CREATE TRIGGER update_insurance_company_groups_updated_at
BEFORE UPDATE ON public.insurance_company_groups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_road_services_updated_at
BEFORE UPDATE ON public.road_services
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_company_road_service_prices_updated_at
BEFORE UPDATE ON public.company_road_service_prices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_policy_groups_updated_at
BEFORE UPDATE ON public.policy_groups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- Indexes for performance
-- =============================================
CREATE INDEX idx_road_services_active ON public.road_services(active) WHERE active = true;
CREATE INDEX idx_company_road_service_prices_company ON public.company_road_service_prices(company_id);
CREATE INDEX idx_company_road_service_prices_service ON public.company_road_service_prices(road_service_id);
CREATE INDEX idx_policies_group_id ON public.policies(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX idx_policies_road_service_id ON public.policies(road_service_id) WHERE road_service_id IS NOT NULL;
CREATE INDEX idx_insurance_companies_group_id ON public.insurance_companies(group_id) WHERE group_id IS NOT NULL;