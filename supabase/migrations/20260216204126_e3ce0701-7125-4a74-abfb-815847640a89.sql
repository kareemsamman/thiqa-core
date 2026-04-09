
-- Drop the old unique index and create a new one that includes car value range
DROP INDEX IF EXISTS idx_pricing_rules_unique;

CREATE UNIQUE INDEX idx_pricing_rules_unique ON pricing_rules (
  company_id, 
  rule_type, 
  COALESCE(age_band, 'ANY'::age_band), 
  COALESCE(car_type, 'car'::car_type), 
  policy_type_parent,
  COALESCE(min_car_value, 0),
  COALESCE(max_car_value, 0)
);
