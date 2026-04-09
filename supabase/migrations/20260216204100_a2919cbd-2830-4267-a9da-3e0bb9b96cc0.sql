
-- 1. Add tiered pricing columns to pricing_rules
ALTER TABLE pricing_rules ADD COLUMN min_car_value numeric DEFAULT NULL;
ALTER TABLE pricing_rules ADD COLUMN max_car_value numeric DEFAULT NULL;

-- 2. Add issue_date to policies
ALTER TABLE policies ADD COLUMN issue_date date DEFAULT NULL;

-- Backfill existing policies with start_date
UPDATE policies SET issue_date = start_date WHERE issue_date IS NULL;

-- 3. Create settlement_supplements table
CREATE TABLE settlement_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES insurance_companies(id),
  description text NOT NULL DEFAULT 'ملحق',
  insurance_price numeric NOT NULL DEFAULT 0,
  company_payment numeric NOT NULL DEFAULT 0,
  profit numeric NOT NULL DEFAULT 0,
  settlement_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_admin_id uuid REFERENCES profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE settlement_supplements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage supplements"
  ON settlement_supplements FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
