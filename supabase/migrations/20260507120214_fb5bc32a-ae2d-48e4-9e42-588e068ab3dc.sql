ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS skip_recalc boolean NOT NULL DEFAULT false;

UPDATE public.policies p
SET skip_recalc = true, profit = 0, payed_for_company = 0
FROM public.clients c
WHERE p.client_id = c.id
  AND c.agent_id = '6a2e7957-1444-4cb2-a6f8-abc104003fa0'
  AND c.file_number LIKE 'F%';

CREATE INDEX IF NOT EXISTS idx_policies_skip_recalc ON public.policies(skip_recalc) WHERE skip_recalc = true;