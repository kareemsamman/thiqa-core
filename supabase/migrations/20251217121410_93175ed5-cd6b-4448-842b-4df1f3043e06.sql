-- Add new pricing rule types
ALTER TYPE pricing_rule_type ADD VALUE IF NOT EXISTS 'ROAD_SERVICE_BASE';
ALTER TYPE pricing_rule_type ADD VALUE IF NOT EXISTS 'ROAD_SERVICE_EXTRA_OLD_CAR';

-- Add category_parent to insurance_companies for grouping (ELZAMI, THIRD_FULL, etc.)
ALTER TABLE insurance_companies ADD COLUMN IF NOT EXISTS category_parent policy_type_parent;

-- Create index for faster profit queries
CREATE INDEX IF NOT EXISTS idx_policies_profit_summary 
ON policies (company_id, start_date, end_date, cancelled, deleted_at)
WHERE deleted_at IS NULL AND cancelled = false;

-- Create function to calculate company payment based on pricing rules
CREATE OR REPLACE FUNCTION calculate_policy_company_payment(
  p_policy_type_parent policy_type_parent,
  p_policy_type_child policy_type_child,
  p_company_id uuid,
  p_car_type car_type,
  p_age_band age_band,
  p_car_value numeric,
  p_car_year integer,
  p_insurance_price numeric
) RETURNS TABLE(company_payment numeric, profit numeric) AS $$
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
  -- ELZAMI: No profit, company gets all
  IF p_policy_type_parent = 'ELZAMI' THEN
    RETURN QUERY SELECT p_insurance_price, 0::numeric;
    RETURN;
  END IF;

  -- ROAD_SERVICE calculation
  IF p_policy_type_parent = 'ROAD_SERVICE' THEN
    -- Get base price
    SELECT COALESCE(pr.value, 0) INTO v_road_base
    FROM pricing_rules pr
    WHERE pr.company_id = p_company_id
      AND pr.policy_type_parent = 'ROAD_SERVICE'
      AND pr.rule_type IN ('ROAD_SERVICE_PRICE', 'ROAD_SERVICE_BASE')
      AND (pr.age_band = p_age_band OR pr.age_band = 'ANY')
    ORDER BY CASE WHEN pr.age_band = p_age_band THEN 0 ELSE 1 END
    LIMIT 1;

    -- Get extra for old cars (year <= 2007)
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

  -- THIRD_FULL calculation
  IF p_policy_type_parent = 'THIRD_FULL' THEN
    -- Get THIRD price (fixed amount based on car_type and age_band)
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

    -- If THIRD policy type
    IF p_policy_type_child = 'THIRD' OR p_policy_type_child IS NULL THEN
      v_company_payment := v_third_price;
      v_profit := p_insurance_price - v_company_payment;
      RETURN QUERY SELECT v_company_payment, v_profit;
      RETURN;
    END IF;

    -- FULL policy type
    IF p_policy_type_child = 'FULL' THEN
      -- Get discount for third component
      SELECT COALESCE(pr.value, 0) INTO v_discount
      FROM pricing_rules pr
      WHERE pr.company_id = p_company_id
        AND pr.policy_type_parent = 'THIRD_FULL'
        AND pr.rule_type = 'DISCOUNT'
        AND (pr.car_type = p_car_type OR pr.car_type IS NULL)
      ORDER BY CASE WHEN pr.car_type = p_car_type THEN 0 ELSE 1 END
      LIMIT 1;

      -- Apply discount to third component
      IF v_discount > 0 THEN
        v_third_component := v_third_price * (1 - v_discount / 100);
      ELSE
        v_third_component := v_third_price;
      END IF;

      -- Get min price
      SELECT COALESCE(pr.value, 0) INTO v_min_price
      FROM pricing_rules pr
      WHERE pr.company_id = p_company_id
        AND pr.policy_type_parent = 'THIRD_FULL'
        AND pr.rule_type = 'MIN_PRICE'
        AND (pr.car_type = p_car_type OR pr.car_type IS NULL)
      ORDER BY CASE WHEN pr.car_type = p_car_type THEN 0 ELSE 1 END
      LIMIT 1;

      -- Get full percent
      SELECT COALESCE(pr.value, 0) INTO v_full_percent
      FROM pricing_rules pr
      WHERE pr.company_id = p_company_id
        AND pr.policy_type_parent = 'THIRD_FULL'
        AND pr.rule_type = 'FULL_PERCENT'
        AND (pr.car_type = p_car_type OR pr.car_type IS NULL)
      ORDER BY CASE WHEN pr.car_type = p_car_type THEN 0 ELSE 1 END
      LIMIT 1;

      -- Calculate full component
      IF p_car_value IS NOT NULL AND p_car_value >= 60000 THEN
        v_full_component := p_car_value * (v_full_percent / 100);
      ELSE
        v_full_component := v_min_price;
      END IF;

      v_company_payment := v_full_component + v_third_component;
      v_profit := p_insurance_price - v_company_payment;
      RETURN QUERY SELECT v_company_payment, v_profit;
      RETURN;
    END IF;
  END IF;

  -- ACCIDENT_FEE_EXEMPTION: Similar to THIRD
  IF p_policy_type_parent = 'ACCIDENT_FEE_EXEMPTION' THEN
    SELECT COALESCE(pr.value, 0) INTO v_third_price
    FROM pricing_rules pr
    WHERE pr.company_id = p_company_id
      AND pr.policy_type_parent = 'ACCIDENT_FEE_EXEMPTION'
      AND pr.rule_type = 'THIRD_PRICE'
    LIMIT 1;

    v_company_payment := v_third_price;
    v_profit := p_insurance_price - v_company_payment;
    RETURN QUERY SELECT v_company_payment, v_profit;
    RETURN;
  END IF;

  -- Default fallback
  RETURN QUERY SELECT 0::numeric, p_insurance_price;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;