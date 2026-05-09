-- Adds policies.manual_override: when true, the row was edited manually
-- in the accounting issuances table and must NOT be touched by the
-- bulk "Recalculate profits" action. Distinct from skip_recalc, which
-- is used to hide imported-from-EXE policies from the live UI; rows
-- with manual_override stay fully visible.
ALTER TABLE public.policies
  ADD COLUMN IF NOT EXISTS manual_override boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_policies_manual_override
  ON public.policies(manual_override)
  WHERE manual_override = true;
