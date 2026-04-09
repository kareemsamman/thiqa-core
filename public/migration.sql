-- AB Insurance CRM - Full Migration SQL
-- Run this in your new Supabase project's SQL Editor
-- This will create all tables, functions, triggers, and RLS policies

-- ============================================
-- STEP 1: CREATE ENUMS
-- ============================================

CREATE TYPE public.user_status AS ENUM ('pending', 'active', 'blocked');
CREATE TYPE public.app_role AS ENUM ('admin', 'worker');
CREATE TYPE public.car_type AS ENUM ('car', 'cargo', 'small', 'taxi', 'tjeradown4', 'tjeraup4');
CREATE TYPE public.age_band AS ENUM ('UNDER_24', 'UP_24', 'ANY');
CREATE TYPE public.policy_type_parent AS ENUM ('ELZAMI', 'THIRD_FULL', 'ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION', 'HEALTH', 'LIFE', 'PROPERTY', 'TRAVEL', 'BUSINESS', 'OTHER');
CREATE TYPE public.policy_type_child AS ENUM ('THIRD', 'FULL');
CREATE TYPE public.pricing_rule_type AS ENUM ('THIRD_PRICE', 'FULL_PERCENT', 'DISCOUNT', 'MIN_PRICE', 'ROAD_SERVICE_PRICE', 'ROAD_SERVICE_BASE', 'ROAD_SERVICE_EXTRA_OLD_CAR');
CREATE TYPE public.payment_type AS ENUM ('cash', 'cheque', 'visa', 'transfer');
CREATE TYPE public.payment_status AS ENUM ('paid', 'partial', 'unpaid');

-- ============================================
-- STEP 2: CREATE SEQUENCES
-- ============================================

CREATE SEQUENCE IF NOT EXISTS client_file_number_seq START 1;

-- ============================================
-- STEP 3: CREATE TABLES
-- ============================================

-- Branches
CREATE TABLE public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_ar TEXT,
    slug TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profiles (user profiles)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    full_name TEXT,
    phone TEXT,
    avatar_url TEXT,
    branch_id UUID REFERENCES public.branches(id),
    status public.user_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User Roles
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    role public.app_role NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, role)
);

-- Brokers
CREATE TABLE public.brokers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT,
    notes TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clients
CREATE TABLE public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    id_number TEXT NOT NULL,
    phone_number TEXT,
    file_number TEXT,
    notes TEXT,
    image_url TEXT,
    signature_url TEXT,
    less_than_24 BOOLEAN DEFAULT false,
    date_joined DATE DEFAULT CURRENT_DATE,
    broker_id UUID REFERENCES public.brokers(id),
    branch_id UUID REFERENCES public.branches(id),
    created_by_admin_id UUID REFERENCES public.profiles(id),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cars
CREATE TABLE public.cars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id),
    car_number TEXT NOT NULL,
    manufacturer_name TEXT,
    model TEXT,
    model_number TEXT,
    year INTEGER,
    color TEXT,
    car_type public.car_type DEFAULT 'car',
    car_value NUMERIC,
    license_type TEXT,
    license_expiry DATE,
    last_license DATE,
    branch_id UUID REFERENCES public.branches(id),
    created_by_admin_id UUID REFERENCES public.profiles(id),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Car Accidents
CREATE TABLE public.car_accidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    car_id UUID NOT NULL REFERENCES public.cars(id),
    accident_name TEXT NOT NULL,
    accident_date DATE,
    notes TEXT,
    branch_id UUID REFERENCES public.branches(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insurance Companies
CREATE TABLE public.insurance_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_ar TEXT,
    category_parent public.policy_type_parent,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insurance Categories
CREATE TABLE public.insurance_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_ar TEXT,
    name_he TEXT,
    slug TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL DEFAULT 'LIGHT',
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_default BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pricing Rules
CREATE TABLE public.pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.insurance_companies(id),
    policy_type_parent public.policy_type_parent NOT NULL,
    rule_type public.pricing_rule_type NOT NULL,
    car_type public.car_type DEFAULT 'car',
    age_band public.age_band DEFAULT 'ANY',
    value NUMERIC NOT NULL,
    notes TEXT,
    effective_from DATE,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Policies
CREATE TABLE public.policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id),
    car_id UUID REFERENCES public.cars(id),
    company_id UUID REFERENCES public.insurance_companies(id),
    category_id UUID REFERENCES public.insurance_categories(id),
    broker_id UUID REFERENCES public.brokers(id),
    policy_type_parent public.policy_type_parent NOT NULL,
    policy_type_child public.policy_type_child,
    policy_number TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    insurance_price NUMERIC NOT NULL,
    is_under_24 BOOLEAN DEFAULT false,
    profit NUMERIC DEFAULT 0,
    payed_for_company NUMERIC DEFAULT 0,
    calc_status TEXT DEFAULT 'done',
    cancelled BOOLEAN DEFAULT false,
    transferred BOOLEAN DEFAULT false,
    transferred_car_number TEXT,
    notes TEXT,
    legacy_wp_id INTEGER,
    invoices_sent_at TIMESTAMPTZ,
    branch_id UUID REFERENCES public.branches(id),
    created_by_admin_id UUID REFERENCES public.profiles(id),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Policy Payments
CREATE TABLE public.policy_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id UUID NOT NULL REFERENCES public.policies(id),
    payment_type public.payment_type NOT NULL,
    amount NUMERIC NOT NULL,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    cheque_number TEXT,
    cheque_image_url TEXT,
    cheque_status TEXT DEFAULT 'pending',
    refused BOOLEAN DEFAULT false,
    card_last_four TEXT,
    card_expiry TEXT,
    installments_count INTEGER,
    provider TEXT DEFAULT 'manual',
    tranzila_transaction_id TEXT,
    tranzila_index TEXT,
    tranzila_approval_code TEXT,
    tranzila_response_code TEXT,
    tranzila_receipt_url TEXT,
    notes TEXT,
    branch_id UUID REFERENCES public.branches(id),
    created_by_admin_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outside Cheques
CREATE TABLE public.outside_cheques (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    cheque_number TEXT,
    cheque_date DATE,
    cheque_image_url TEXT,
    notes TEXT,
    used BOOLEAN DEFAULT false,
    refused BOOLEAN DEFAULT false,
    branch_id UUID REFERENCES public.branches(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Media Files
CREATE TABLE public.media_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    cdn_url TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    uploaded_by UUID,
    branch_id UUID REFERENCES public.branches(id),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invoice Templates
CREATE TABLE public.invoice_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    template_type TEXT NOT NULL DEFAULT 'invoice',
    language TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'rtl',
    logo_url TEXT,
    header_html TEXT,
    body_html TEXT,
    footer_html TEXT,
    template_layout_json JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT false,
    version INTEGER NOT NULL DEFAULT 1,
    created_by_admin_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invoices
CREATE TABLE public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id UUID NOT NULL REFERENCES public.policies(id),
    template_id UUID REFERENCES public.invoice_templates(id),
    invoice_number TEXT NOT NULL,
    language TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    pdf_url TEXT,
    error_message TEXT,
    metadata_json JSONB,
    template_version_used INTEGER DEFAULT 1,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    branch_id UUID REFERENCES public.branches(id),
    created_by_admin_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Customer Signatures
CREATE TABLE public.customer_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id),
    policy_id UUID REFERENCES public.policies(id),
    signature_image_url TEXT NOT NULL,
    token TEXT,
    token_expires_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT,
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    branch_id UUID REFERENCES public.branches(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SMS Settings
CREATE TABLE public.sms_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT '019sms',
    sms_user TEXT,
    sms_token TEXT,
    sms_source TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    signature_sms_template TEXT DEFAULT 'مرحباً {{client_name}}، يرجى التوقيع على الرابط التالي: {{signature_url}}',
    invoice_sms_template TEXT DEFAULT 'مرحباً {{client_name}}، تم إصدار فواتير وثيقة التأمين رقم {{policy_number}}. فاتورة AB: {{ab_invoice_url}} فاتورة شركة التأمين: {{insurance_invoice_url}}',
    default_signature_template_id UUID REFERENCES public.invoice_templates(id),
    default_ab_invoice_template_id UUID REFERENCES public.invoice_templates(id),
    default_insurance_invoice_template_id UUID REFERENCES public.invoice_templates(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payment Settings
CREATE TABLE public.payment_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'tranzila',
    terminal_name TEXT,
    api_password TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    test_mode BOOLEAN NOT NULL DEFAULT true,
    success_url TEXT,
    fail_url TEXT,
    notify_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notifications
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    type TEXT NOT NULL DEFAULT 'general',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    entity_type TEXT,
    entity_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Login Attempts
CREATE TABLE public.login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    user_id UUID,
    success BOOLEAN NOT NULL DEFAULT false,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- STEP 4: CREATE FUNCTIONS
-- ============================================

-- Check if user is active
CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND status = 'active'
  )
$$;

-- Check if user has role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Get user branch ID
CREATE OR REPLACE FUNCTION public.get_user_branch_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.profiles WHERE id = _user_id
$$;

-- Check if user can access branch
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

-- Generate file number
CREATE OR REPLACE FUNCTION public.generate_file_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT nextval('client_file_number_seq') INTO next_num;
  RETURN 'F' || LPAD(next_num::TEXT, 4, '0');
END;
$$;

-- Generate invoice number
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_year text;
  next_num integer;
  year_prefix text;
BEGIN
  current_year := to_char(now(), 'YYYY');
  year_prefix := current_year || '-';
  
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 6) AS integer)), 0) + 1
  INTO next_num
  FROM public.invoices
  WHERE invoice_number LIKE year_prefix || '%';
  
  RETURN year_prefix || LPAD(next_num::text, 6, '0');
END;
$$;

-- Update updated_at column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Handle new user (create profile)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_email TEXT := 'morshed500@gmail.com';
BEGIN
  INSERT INTO public.profiles (id, email, full_name, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    CASE WHEN NEW.email = admin_email THEN 'active'::user_status ELSE 'pending'::user_status END
  );
  
  IF NEW.email = admin_email THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Calculate policy company payment
CREATE OR REPLACE FUNCTION public.calculate_policy_company_payment(
  p_policy_type_parent policy_type_parent,
  p_policy_type_child policy_type_child,
  p_company_id uuid,
  p_car_type car_type,
  p_age_band age_band,
  p_car_value numeric,
  p_car_year integer,
  p_insurance_price numeric
)
RETURNS TABLE(company_payment numeric, profit numeric)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_third_price numeric := 0;
  v_full_percent numeric := 0;
  v_discount numeric := 0;
  v_min_price numeric := 0;
  v_road_base numeric := 0;
  v_road_extra numeric := 0;
  v_full_component numeric := 0;
  v_third_component numeric := 0;
  v_company_payment numeric := 0;
  v_profit numeric := 0;
BEGIN
  IF p_policy_type_parent = 'ELZAMI' THEN
    RETURN QUERY SELECT p_insurance_price, 0::numeric;
    RETURN;
  END IF;

  IF p_policy_type_parent = 'ROAD_SERVICE' THEN
    SELECT COALESCE(pr.value, 0) INTO v_road_base
    FROM pricing_rules pr
    WHERE pr.company_id = p_company_id
      AND pr.policy_type_parent = 'ROAD_SERVICE'
      AND pr.rule_type IN ('ROAD_SERVICE_PRICE', 'ROAD_SERVICE_BASE')
      AND (pr.age_band = p_age_band OR pr.age_band = 'ANY')
    ORDER BY CASE WHEN pr.age_band = p_age_band THEN 0 ELSE 1 END
    LIMIT 1;

    IF v_road_base = 0 THEN
      RETURN QUERY SELECT 0::numeric, p_insurance_price;
      RETURN;
    END IF;

    IF p_car_year IS NOT NULL AND p_car_year <= 2007 THEN
      SELECT COALESCE(pr.value, 0) INTO v_road_extra
      FROM pricing_rules pr
      WHERE pr.company_id = p_company_id
        AND pr.policy_type_parent = 'ROAD_SERVICE'
        AND pr.rule_type = 'ROAD_SERVICE_EXTRA_OLD_CAR'
      LIMIT 1;
    END IF;

    v_company_payment := v_road_base + v_road_extra;
    v_profit := p_insurance_price - v_company_payment;
    RETURN QUERY SELECT v_company_payment, v_profit;
    RETURN;
  END IF;

  IF p_policy_type_parent = 'THIRD_FULL' THEN
    SELECT COALESCE(pr.value, 0) INTO v_third_price
    FROM pricing_rules pr
    WHERE pr.company_id = p_company_id
      AND pr.policy_type_parent = 'THIRD_FULL'
      AND pr.rule_type = 'THIRD_PRICE'
      AND (pr.car_type = p_car_type OR pr.car_type IS NULL)
      AND (pr.age_band = p_age_band OR pr.age_band = 'ANY')
    ORDER BY 
      CASE WHEN pr.car_type = p_car_type THEN 0 ELSE 1 END,
      CASE WHEN pr.age_band = p_age_band THEN 0 ELSE 1 END
    LIMIT 1;

    IF p_policy_type_child = 'THIRD' OR p_policy_type_child IS NULL THEN
      IF v_third_price = 0 THEN
        RETURN QUERY SELECT 0::numeric, p_insurance_price;
        RETURN;
      END IF;
      v_company_payment := v_third_price;
      v_profit := p_insurance_price - v_company_payment;
      RETURN QUERY SELECT v_company_payment, v_profit;
      RETURN;
    END IF;

    IF p_policy_type_child = 'FULL' THEN
      SELECT COALESCE(pr.value, 0) INTO v_discount
      FROM pricing_rules pr
      WHERE pr.company_id = p_company_id
        AND pr.policy_type_parent = 'THIRD_FULL'
        AND pr.rule_type = 'DISCOUNT'
        AND (pr.car_type = p_car_type OR pr.car_type IS NULL)
      ORDER BY CASE WHEN pr.car_type = p_car_type THEN 0 ELSE 1 END
      LIMIT 1;

      SELECT COALESCE(pr.value, 0) INTO v_min_price
      FROM pricing_rules pr
      WHERE pr.company_id = p_company_id
        AND pr.policy_type_parent = 'THIRD_FULL'
        AND pr.rule_type = 'MIN_PRICE'
        AND (pr.car_type = p_car_type OR pr.car_type IS NULL)
      ORDER BY CASE WHEN pr.car_type = p_car_type THEN 0 ELSE 1 END
      LIMIT 1;

      SELECT COALESCE(pr.value, 0) INTO v_full_percent
      FROM pricing_rules pr
      WHERE pr.company_id = p_company_id
        AND pr.policy_type_parent = 'THIRD_FULL'
        AND pr.rule_type = 'FULL_PERCENT'
        AND (pr.car_type = p_car_type OR pr.car_type IS NULL)
      ORDER BY CASE WHEN pr.car_type = p_car_type THEN 0 ELSE 1 END
      LIMIT 1;

      IF v_full_percent = 0 AND v_discount = 0 AND v_min_price = 0 AND v_third_price = 0 THEN
        RETURN QUERY SELECT 0::numeric, p_insurance_price;
        RETURN;
      END IF;

      IF v_discount > 0 THEN
        v_third_component := v_discount;
      ELSE
        v_third_component := v_third_price;
      END IF;

      IF p_car_value IS NOT NULL AND p_car_value >= 60000 AND v_full_percent > 0 THEN
        v_full_component := p_car_value * (v_full_percent / 100);
      ELSIF v_min_price > 0 THEN
        v_full_component := v_min_price;
      END IF;

      v_company_payment := v_full_component + v_third_component;
      v_profit := p_insurance_price - v_company_payment;
      RETURN QUERY SELECT v_company_payment, v_profit;
      RETURN;
    END IF;
  END IF;

  IF p_policy_type_parent = 'ACCIDENT_FEE_EXEMPTION' THEN
    SELECT COALESCE(pr.value, 0) INTO v_third_price
    FROM pricing_rules pr
    WHERE pr.company_id = p_company_id
      AND pr.policy_type_parent = 'ACCIDENT_FEE_EXEMPTION'
      AND pr.rule_type = 'THIRD_PRICE'
    LIMIT 1;

    IF v_third_price = 0 THEN
      RETURN QUERY SELECT 0::numeric, p_insurance_price;
      RETURN;
    END IF;

    v_company_payment := v_third_price;
    v_profit := p_insurance_price - v_company_payment;
    RETURN QUERY SELECT v_company_payment, v_profit;
    RETURN;
  END IF;

  RETURN QUERY SELECT 0::numeric, p_insurance_price;
END;
$$;

-- ============================================
-- STEP 5: CREATE TRIGGERS
-- ============================================

-- Updated at triggers
CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_brokers_updated_at BEFORE UPDATE ON public.brokers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_cars_updated_at BEFORE UPDATE ON public.cars FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_car_accidents_updated_at BEFORE UPDATE ON public.car_accidents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_insurance_companies_updated_at BEFORE UPDATE ON public.insurance_companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_insurance_categories_updated_at BEFORE UPDATE ON public.insurance_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pricing_rules_updated_at BEFORE UPDATE ON public.pricing_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_policies_updated_at BEFORE UPDATE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_invoice_templates_updated_at BEFORE UPDATE ON public.invoice_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sms_settings_updated_at BEFORE UPDATE ON public.sms_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_payment_settings_updated_at BEFORE UPDATE ON public.payment_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auth trigger for new users
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- STEP 6: ENABLE RLS
-- ============================================

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_accidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outside_cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 7: CREATE RLS POLICIES
-- ============================================

-- Branches
CREATE POLICY "Active users can view branches" ON public.branches FOR SELECT USING (is_active_user(auth.uid()));
CREATE POLICY "Admins can manage branches" ON public.branches FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Profiles
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING (has_role(auth.uid(), 'admin'));

-- User Roles
CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins can manage all roles" ON public.user_roles FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Brokers
CREATE POLICY "Active users can view brokers" ON public.brokers FOR SELECT USING (is_active_user(auth.uid()));
CREATE POLICY "Active users can manage brokers" ON public.brokers FOR ALL USING (is_active_user(auth.uid()));

-- Clients
CREATE POLICY "Branch users can view clients" ON public.clients FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage clients" ON public.clients FOR ALL USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Cars
CREATE POLICY "Branch users can view cars" ON public.cars FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage cars" ON public.cars FOR ALL USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Car Accidents
CREATE POLICY "Branch users can view car accidents" ON public.car_accidents FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage car accidents" ON public.car_accidents FOR ALL USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Insurance Companies
CREATE POLICY "Active users can view companies" ON public.insurance_companies FOR SELECT USING (is_active_user(auth.uid()));
CREATE POLICY "Admins can manage companies" ON public.insurance_companies FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Insurance Categories
CREATE POLICY "Active users can view insurance categories" ON public.insurance_categories FOR SELECT USING (is_active_user(auth.uid()));
CREATE POLICY "Admins can manage insurance categories" ON public.insurance_categories FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Pricing Rules
CREATE POLICY "Active users can view pricing rules" ON public.pricing_rules FOR SELECT USING (is_active_user(auth.uid()));
CREATE POLICY "Admins can manage pricing rules" ON public.pricing_rules FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Policies
CREATE POLICY "Branch users can view policies" ON public.policies FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage policies" ON public.policies FOR ALL USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Policy Payments
CREATE POLICY "Branch users can view payments" ON public.policy_payments FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage payments" ON public.policy_payments FOR ALL USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Outside Cheques
CREATE POLICY "Branch users can view outside cheques" ON public.outside_cheques FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage outside cheques" ON public.outside_cheques FOR ALL USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Media Files
CREATE POLICY "Branch users can view media" ON public.media_files FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id) AND deleted_at IS NULL);
CREATE POLICY "Branch users can upload media" ON public.media_files FOR INSERT WITH CHECK (is_active_user(auth.uid()) AND uploaded_by = auth.uid());
CREATE POLICY "Branch users can soft delete own media" ON public.media_files FOR UPDATE USING (is_active_user(auth.uid()) AND (uploaded_by = auth.uid() OR has_role(auth.uid(), 'admin')));

-- Invoice Templates
CREATE POLICY "Active users can view invoice templates" ON public.invoice_templates FOR SELECT USING (is_active_user(auth.uid()));
CREATE POLICY "Admins can manage invoice templates" ON public.invoice_templates FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Invoices
CREATE POLICY "Branch users can view invoices" ON public.invoices FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage invoices" ON public.invoices FOR ALL USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Customer Signatures
CREATE POLICY "Branch users can view signatures" ON public.customer_signatures FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can create signatures" ON public.customer_signatures FOR INSERT WITH CHECK (is_active_user(auth.uid()));

-- SMS Settings
CREATE POLICY "Admins can view SMS settings" ON public.sms_settings FOR SELECT USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage SMS settings" ON public.sms_settings FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Payment Settings
CREATE POLICY "Admins can view payment settings" ON public.payment_settings FOR SELECT USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage payment settings" ON public.payment_settings FOR ALL USING (has_role(auth.uid(), 'admin'));

-- Notifications
CREATE POLICY "Users can view their own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own notifications" ON public.notifications FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service can insert notifications" ON public.notifications FOR INSERT WITH CHECK (true);

-- Login Attempts
CREATE POLICY "Admins can view login attempts" ON public.login_attempts FOR SELECT USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone can insert login attempts" ON public.login_attempts FOR INSERT WITH CHECK (true);

-- ============================================
-- DONE! Your database is ready.
-- ============================================
