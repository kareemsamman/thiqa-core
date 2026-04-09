-- Create enums
CREATE TYPE public.app_role AS ENUM ('admin', 'worker');
CREATE TYPE public.user_status AS ENUM ('pending', 'active', 'blocked');
CREATE TYPE public.policy_type_parent AS ENUM ('ELZAMI', 'THIRD_FULL', 'ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION');
CREATE TYPE public.policy_type_child AS ENUM ('THIRD', 'FULL');
CREATE TYPE public.car_type AS ENUM ('car', 'cargo', 'small', 'taxi', 'tjeradown4', 'tjeraup4');
CREATE TYPE public.age_band AS ENUM ('UNDER_24', 'UP_24', 'ANY');
CREATE TYPE public.pricing_rule_type AS ENUM ('THIRD_PRICE', 'FULL_PERCENT', 'DISCOUNT', 'MIN_PRICE', 'ROAD_SERVICE_PRICE');
CREATE TYPE public.payment_type AS ENUM ('cash', 'cheque', 'visa', 'transfer');
CREATE TYPE public.payment_status AS ENUM ('paid', 'partial', 'unpaid');

-- Profiles table (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  status user_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Login attempts table
CREATE TABLE public.login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clients table
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  id_number TEXT UNIQUE NOT NULL,
  file_number TEXT UNIQUE,
  phone_number TEXT,
  date_joined DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  less_than_24 BOOLEAN DEFAULT false,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insurance companies table
CREATE TABLE public.insurance_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_ar TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cars table
CREATE TABLE public.cars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_number TEXT UNIQUE NOT NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  manufacturer_name TEXT,
  model TEXT,
  year INTEGER,
  license_type TEXT,
  model_number TEXT,
  license_expiry DATE,
  last_license DATE,
  color TEXT,
  car_value NUMERIC(12,2),
  car_type car_type DEFAULT 'car',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Policies table
CREATE TABLE public.policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  car_id UUID NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.insurance_companies(id),
  policy_type_parent policy_type_parent NOT NULL,
  policy_type_child policy_type_child,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  insurance_price NUMERIC(12,2) NOT NULL,
  is_under_24 BOOLEAN DEFAULT false,
  profit NUMERIC(12,2) DEFAULT 0,
  payed_for_company NUMERIC(12,2) DEFAULT 0,
  cancelled BOOLEAN DEFAULT false,
  transferred BOOLEAN DEFAULT false,
  transferred_car_number TEXT,
  notes TEXT,
  legacy_wp_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Policy payments table
CREATE TABLE public.policy_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  payment_type payment_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  cheque_number TEXT,
  cheque_image_url TEXT,
  refused BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pricing rules table
CREATE TABLE public.pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.insurance_companies(id) ON DELETE CASCADE,
  rule_type pricing_rule_type NOT NULL,
  policy_type_parent policy_type_parent NOT NULL,
  age_band age_band DEFAULT 'ANY',
  car_type car_type DEFAULT 'car',
  value NUMERIC(12,4) NOT NULL,
  notes TEXT,
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Brokers table
CREATE TABLE public.brokers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outside cheques table
CREATE TABLE public.outside_cheques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cheque_number TEXT,
  amount NUMERIC(12,2) NOT NULL,
  cheque_date DATE,
  cheque_image_url TEXT,
  refused BOOLEAN DEFAULT false,
  used BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for fast queries
CREATE INDEX idx_clients_id_number ON public.clients(id_number);
CREATE INDEX idx_clients_file_number ON public.clients(file_number);
CREATE INDEX idx_clients_phone ON public.clients(phone_number);
CREATE INDEX idx_clients_full_name ON public.clients(full_name);
CREATE INDEX idx_cars_car_number ON public.cars(car_number);
CREATE INDEX idx_cars_client_id ON public.cars(client_id);
CREATE INDEX idx_policies_client_id ON public.policies(client_id);
CREATE INDEX idx_policies_car_id ON public.policies(car_id);
CREATE INDEX idx_policies_company_id ON public.policies(company_id);
CREATE INDEX idx_policies_end_date ON public.policies(end_date);
CREATE INDEX idx_policies_start_date ON public.policies(start_date);
CREATE INDEX idx_policy_payments_policy_id ON public.policy_payments(policy_id);
CREATE INDEX idx_pricing_rules_company_id ON public.pricing_rules(company_id);
CREATE INDEX idx_login_attempts_email ON public.login_attempts(email);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outside_cheques ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (prevents infinite recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
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

-- Function to check if user is active
CREATE OR REPLACE FUNCTION public.is_active_user(_user_id UUID)
RETURNS BOOLEAN
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

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for login_attempts (admin only)
CREATE POLICY "Admins can view login attempts"
  ON public.login_attempts FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can insert login attempts"
  ON public.login_attempts FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- RLS Policies for business data (active users only)
CREATE POLICY "Active users can view clients"
  ON public.clients FOR SELECT
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can manage clients"
  ON public.clients FOR ALL
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can view cars"
  ON public.cars FOR SELECT
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can manage cars"
  ON public.cars FOR ALL
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can view policies"
  ON public.policies FOR SELECT
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can manage policies"
  ON public.policies FOR ALL
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can view payments"
  ON public.policy_payments FOR SELECT
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can manage payments"
  ON public.policy_payments FOR ALL
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can view companies"
  ON public.insurance_companies FOR SELECT
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Admins can manage companies"
  ON public.insurance_companies FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Active users can view pricing rules"
  ON public.pricing_rules FOR SELECT
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Admins can manage pricing rules"
  ON public.pricing_rules FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Active users can view brokers"
  ON public.brokers FOR SELECT
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can manage brokers"
  ON public.brokers FOR ALL
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can view outside cheques"
  ON public.outside_cheques FOR SELECT
  TO authenticated
  USING (public.is_active_user(auth.uid()));

CREATE POLICY "Active users can manage outside cheques"
  ON public.outside_cheques FOR ALL
  TO authenticated
  USING (public.is_active_user(auth.uid()));

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_cars_updated_at BEFORE UPDATE ON public.cars FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_policies_updated_at BEFORE UPDATE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON public.insurance_companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pricing_rules_updated_at BEFORE UPDATE ON public.pricing_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_brokers_updated_at BEFORE UPDATE ON public.brokers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_email TEXT := 'morshed500@gmail.com';
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, email, full_name, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    CASE WHEN NEW.email = admin_email THEN 'active' ELSE 'pending' END
  );
  
  -- If admin email, also add admin role
  IF NEW.email = admin_email THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Insert sample insurance companies
INSERT INTO public.insurance_companies (name, name_ar) VALUES
  ('Menora', 'مينورا'),
  ('Harel', 'هرئيل'),
  ('Phoenix', 'فينيكس'),
  ('Clal', 'كلال'),
  ('Migdal', 'مجدال'),
  ('AIG', 'AIG'),
  ('Shirbit', 'شربيط');