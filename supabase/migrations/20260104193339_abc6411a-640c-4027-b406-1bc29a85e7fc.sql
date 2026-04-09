-- =============================================
-- ACCIDENT REPORTS SYSTEM
-- =============================================

-- Main accident reports table
CREATE TABLE public.accident_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  car_id UUID REFERENCES public.cars(id) ON DELETE SET NULL,
  company_id UUID REFERENCES public.insurance_companies(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  
  -- Status: draft, submitted, closed
  status TEXT NOT NULL DEFAULT 'draft',
  
  -- Accident details
  accident_date DATE NOT NULL,
  accident_time TIME,
  accident_location TEXT,
  accident_description TEXT,
  
  -- Driver info
  driver_name TEXT,
  driver_id_number TEXT,
  driver_phone TEXT,
  driver_license_number TEXT,
  
  -- Police info
  police_reported BOOLEAN DEFAULT FALSE,
  police_station TEXT,
  police_report_number TEXT,
  
  -- Croquis/sketch image
  croquis_url TEXT,
  
  -- Generated PDF URL (latest)
  generated_pdf_url TEXT,
  
  -- Audit
  created_by_admin_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Third parties table (other vehicles/persons involved)
CREATE TABLE public.accident_third_parties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  accident_report_id UUID NOT NULL REFERENCES public.accident_reports(id) ON DELETE CASCADE,
  
  -- Person details
  full_name TEXT NOT NULL,
  id_number TEXT,
  phone TEXT,
  address TEXT,
  
  -- Vehicle details (if applicable)
  vehicle_number TEXT,
  vehicle_type TEXT,
  vehicle_manufacturer TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_color TEXT,
  
  -- Insurance details
  insurance_company TEXT,
  insurance_policy_number TEXT,
  
  -- Damage description
  damage_description TEXT,
  
  -- Sort order
  sort_order INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Company accident templates table
CREATE TABLE public.company_accident_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  
  -- Template PDF
  template_pdf_url TEXT NOT NULL,
  
  -- Field mapping coordinates (JSON)
  mapping_json JSONB NOT NULL DEFAULT '{}',
  
  -- Version control
  version TEXT NOT NULL DEFAULT '1.0',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Metadata
  notes TEXT,
  
  created_by_admin_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Partial unique index - only one active template per company
CREATE UNIQUE INDEX idx_company_accident_templates_active_unique 
  ON public.company_accident_templates(company_id) 
  WHERE is_active = TRUE;

-- Other indexes for performance
CREATE INDEX idx_accident_reports_policy_id ON public.accident_reports(policy_id);
CREATE INDEX idx_accident_reports_client_id ON public.accident_reports(client_id);
CREATE INDEX idx_accident_reports_company_id ON public.accident_reports(company_id);
CREATE INDEX idx_accident_reports_branch_id ON public.accident_reports(branch_id);
CREATE INDEX idx_accident_reports_status ON public.accident_reports(status);
CREATE INDEX idx_accident_reports_accident_date ON public.accident_reports(accident_date);
CREATE INDEX idx_accident_third_parties_report_id ON public.accident_third_parties(accident_report_id);
CREATE INDEX idx_company_accident_templates_company_id ON public.company_accident_templates(company_id);

-- Triggers for updated_at
CREATE TRIGGER update_accident_reports_updated_at
  BEFORE UPDATE ON public.accident_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_accident_third_parties_updated_at
  BEFORE UPDATE ON public.accident_third_parties
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_company_accident_templates_updated_at
  BEFORE UPDATE ON public.company_accident_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS
ALTER TABLE public.accident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accident_third_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_accident_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for accident_reports
CREATE POLICY "Branch users can view accident reports"
  ON public.accident_reports
  FOR SELECT
  USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can manage accident reports"
  ON public.accident_reports
  FOR ALL
  USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- RLS Policies for accident_third_parties (through parent report)
CREATE POLICY "Branch users can view third parties"
  ON public.accident_third_parties
  FOR SELECT
  USING (
    is_active_user(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.accident_reports ar
      WHERE ar.id = accident_third_parties.accident_report_id
      AND can_access_branch(auth.uid(), ar.branch_id)
    )
  );

CREATE POLICY "Branch users can manage third parties"
  ON public.accident_third_parties
  FOR ALL
  USING (
    is_active_user(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.accident_reports ar
      WHERE ar.id = accident_third_parties.accident_report_id
      AND can_access_branch(auth.uid(), ar.branch_id)
    )
  );

-- RLS Policies for company_accident_templates (admin only for management, all users can view)
CREATE POLICY "Active users can view accident templates"
  ON public.company_accident_templates
  FOR SELECT
  USING (is_active_user(auth.uid()));

CREATE POLICY "Admins can manage accident templates"
  ON public.company_accident_templates
  FOR ALL
  USING (has_role(auth.uid(), 'admin'));