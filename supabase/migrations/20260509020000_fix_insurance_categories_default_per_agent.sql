-- Fix: ensure_single_default_category() was clearing is_default across ALL agents.
-- The original trigger (20251218080859) predates the agent_id column, so when a
-- new agent gets seeded with THIRD_FULL.is_default=true (or any agent toggles a
-- default), the trigger SECURITY DEFINER UPDATE wiped every other agent's default.
-- Mirrors the fix already applied to branches in 20260412100000.

CREATE OR REPLACE FUNCTION public.ensure_single_default_category()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE public.insurance_categories
    SET is_default = false
    WHERE id != NEW.id
      AND is_default = true
      AND agent_id IS NOT DISTINCT FROM NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Backfill: for any agent that has categories but no default, mark their first
-- active category (by sort_order) as default.
WITH ranked AS (
  SELECT
    id,
    agent_id,
    ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY sort_order, created_at) AS rn
  FROM public.insurance_categories
  WHERE is_active = true
)
UPDATE public.insurance_categories c
SET is_default = true
FROM ranked r
WHERE c.id = r.id
  AND r.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.insurance_categories c2
    WHERE c2.agent_id IS NOT DISTINCT FROM c.agent_id
      AND c2.is_default = true
  );
