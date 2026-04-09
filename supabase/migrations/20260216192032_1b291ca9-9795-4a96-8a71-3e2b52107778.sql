
-- 1. Fix existing policies with NULL policy_type_child
UPDATE policies p
SET policy_type_child = 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM cars c 
      WHERE c.id = p.car_id AND c.car_value IS NOT NULL AND c.car_value > 0
    ) THEN 'FULL'::policy_type_child
    ELSE 'THIRD'::policy_type_child
  END
WHERE p.policy_type_parent = 'THIRD_FULL' 
  AND p.policy_type_child IS NULL;

-- 2. Create trigger to prevent future NULL child types
CREATE OR REPLACE FUNCTION public.enforce_third_full_child_type()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.policy_type_parent = 'THIRD_FULL' 
     AND (NEW.policy_type_child IS NULL OR NEW.policy_type_child::text = '') THEN
    NEW.policy_type_child := 'THIRD'::policy_type_child;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_third_full_child
BEFORE INSERT OR UPDATE ON policies
FOR EACH ROW EXECUTE FUNCTION public.enforce_third_full_child_type();
