-- Add is_default flag to branches so admins can mark a default branch
-- (mirrors the pattern already used on insurance_categories)

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Ensure only one default branch per agent
CREATE OR REPLACE FUNCTION public.ensure_single_default_branch()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE public.branches
    SET is_default = false
    WHERE id != NEW.id
      AND is_default = true
      AND agent_id IS NOT DISTINCT FROM NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS ensure_single_default_branch_trigger ON public.branches;
CREATE TRIGGER ensure_single_default_branch_trigger
  BEFORE INSERT OR UPDATE ON public.branches
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION public.ensure_single_default_branch();

-- Backfill: mark the first active branch per agent as default if none is set
WITH ranked AS (
  SELECT
    id,
    agent_id,
    ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at) AS rn
  FROM public.branches
  WHERE is_active = true
)
UPDATE public.branches b
SET is_default = true
FROM ranked r
WHERE b.id = r.id
  AND r.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.branches b2
    WHERE b2.agent_id IS NOT DISTINCT FROM b.agent_id
      AND b2.is_default = true
  );
