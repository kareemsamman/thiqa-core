-- ==============================================
-- Auto-mark policies as "renewed" when a new policy is created
-- for the same client + car + insurance type
-- ==============================================

-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION public.auto_mark_renewed_policies()
RETURNS TRIGGER AS $$
DECLARE
  v_old_policy_id UUID;
BEGIN
  -- Only process if this is a real policy (not cancelled, has client and car)
  IF NEW.cancelled = true OR NEW.deleted_at IS NOT NULL 
     OR NEW.client_id IS NULL OR NEW.car_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Find the most recent old policy for same client + car + type
  -- that ended before this new policy starts
  SELECT id INTO v_old_policy_id
  FROM policies
  WHERE client_id = NEW.client_id
    AND car_id = NEW.car_id
    AND policy_type_parent = NEW.policy_type_parent
    AND id != NEW.id
    AND cancelled = false
    AND deleted_at IS NULL
    AND end_date < NEW.start_date
  ORDER BY end_date DESC
  LIMIT 1;
  
  -- If found, mark the old policy as renewed
  IF v_old_policy_id IS NOT NULL THEN
    INSERT INTO policy_renewal_tracking (policy_id, renewal_status, updated_at)
    VALUES (v_old_policy_id, 'renewed', now())
    ON CONFLICT (policy_id) 
    DO UPDATE SET 
      renewal_status = 'renewed',
      updated_at = now();
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Create the trigger (drop if exists first to avoid duplicates)
DROP TRIGGER IF EXISTS trg_auto_mark_renewed ON policies;

CREATE TRIGGER trg_auto_mark_renewed
  AFTER INSERT ON policies
  FOR EACH ROW
  EXECUTE FUNCTION auto_mark_renewed_policies();

-- 3. One-time update: Mark existing policies that have been renewed
-- (policies where a newer policy exists for same client + car + type)
INSERT INTO policy_renewal_tracking (policy_id, renewal_status, updated_at)
SELECT DISTINCT ON (old_p.id) old_p.id, 'renewed', now()
FROM policies old_p
WHERE EXISTS (
  SELECT 1 FROM policies new_p
  WHERE new_p.client_id = old_p.client_id
    AND new_p.car_id = old_p.car_id
    AND new_p.policy_type_parent = old_p.policy_type_parent
    AND new_p.id != old_p.id
    AND new_p.cancelled = false
    AND new_p.deleted_at IS NULL
    AND new_p.start_date > old_p.end_date
)
AND old_p.cancelled = false
AND old_p.deleted_at IS NULL
ON CONFLICT (policy_id) 
DO UPDATE SET 
  renewal_status = 'renewed',
  updated_at = now()
WHERE policy_renewal_tracking.renewal_status != 'renewed';