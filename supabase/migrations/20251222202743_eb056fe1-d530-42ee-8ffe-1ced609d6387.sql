-- Add unique constraints for idempotent WordPress imports

-- Insurance companies - unique by name (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_insurance_companies_name_lower 
ON insurance_companies(LOWER(name));

-- Brokers - unique by name (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_brokers_name_lower 
ON brokers(LOWER(name));

-- Cars - unique by car_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_cars_car_number_unique 
ON cars(car_number) WHERE deleted_at IS NULL;

-- Clients - unique by id_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_id_number_unique 
ON clients(id_number) WHERE deleted_at IS NULL;

-- Policies - unique by legacy_wp_id (for WordPress import matching)
CREATE UNIQUE INDEX IF NOT EXISTS idx_policies_legacy_wp_id_unique 
ON policies(legacy_wp_id) WHERE legacy_wp_id IS NOT NULL AND deleted_at IS NULL;

-- Pricing rules - unique by combination of fields
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_rules_unique 
ON pricing_rules(company_id, rule_type, COALESCE(age_band, 'ANY'), COALESCE(car_type, 'car'), policy_type_parent);

-- Create car_accidents table if not exists
CREATE TABLE IF NOT EXISTS car_accidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id UUID NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  accident_name TEXT NOT NULL,
  accident_date DATE,
  notes TEXT,
  branch_id UUID REFERENCES branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on car_accidents
ALTER TABLE car_accidents ENABLE ROW LEVEL SECURITY;

-- RLS policies for car_accidents
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'car_accidents' AND policyname = 'Branch users can view car accidents'
  ) THEN
    CREATE POLICY "Branch users can view car accidents" ON car_accidents
    FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'car_accidents' AND policyname = 'Branch users can manage car accidents'
  ) THEN
    CREATE POLICY "Branch users can manage car accidents" ON car_accidents
    FOR ALL USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));
  END IF;
END $$;

-- Create unique index for car_accidents matching
CREATE UNIQUE INDEX IF NOT EXISTS idx_car_accidents_unique 
ON car_accidents(car_id, accident_name, COALESCE(accident_date, '1900-01-01'));

-- Add updated_at trigger for car_accidents
DROP TRIGGER IF EXISTS update_car_accidents_updated_at ON car_accidents;
CREATE TRIGGER update_car_accidents_updated_at
  BEFORE UPDATE ON car_accidents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();