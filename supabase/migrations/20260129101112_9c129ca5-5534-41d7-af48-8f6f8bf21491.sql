-- =====================================================
-- Phase 1: Create client_children and policy_children tables
-- =====================================================

-- A) New Table: client_children (dependents/additional drivers)
CREATE TABLE public.client_children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  id_number TEXT NOT NULL,
  birth_date DATE NULL,
  phone TEXT NULL,
  relation TEXT NULL,  -- ابن/ابنة/زوج/سائق إضافي
  notes TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_id, id_number)
);

-- Index for fast lookup by client
CREATE INDEX idx_client_children_client_id ON public.client_children(client_id);

-- B) New Table: policy_children (links children to policies)
CREATE TABLE public.policy_children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  child_id UUID NOT NULL REFERENCES public.client_children(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (policy_id, child_id)
);

-- Index for fast lookup by policy
CREATE INDEX idx_policy_children_policy_id ON public.policy_children(policy_id);

-- =====================================================
-- C) Enable RLS
-- =====================================================
ALTER TABLE public.client_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_children ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- D) RLS Policies - Branch-based isolation
-- =====================================================

-- client_children: inherit access from parent client's branch
CREATE POLICY "Branch users can manage client_children"
ON public.client_children FOR ALL TO authenticated
USING (
  is_active_user(auth.uid()) AND
  EXISTS (
    SELECT 1 FROM public.clients c 
    WHERE c.id = client_children.client_id 
    AND can_access_branch(auth.uid(), c.branch_id)
  )
)
WITH CHECK (
  is_active_user(auth.uid()) AND
  EXISTS (
    SELECT 1 FROM public.clients c 
    WHERE c.id = client_children.client_id 
    AND can_access_branch(auth.uid(), c.branch_id)
  )
);

-- policy_children: inherit access from parent policy's branch
CREATE POLICY "Branch users can manage policy_children"
ON public.policy_children FOR ALL TO authenticated
USING (
  is_active_user(auth.uid()) AND
  EXISTS (
    SELECT 1 FROM public.policies p 
    WHERE p.id = policy_children.policy_id 
    AND can_access_branch(auth.uid(), p.branch_id)
  )
)
WITH CHECK (
  is_active_user(auth.uid()) AND
  EXISTS (
    SELECT 1 FROM public.policies p 
    WHERE p.id = policy_children.policy_id 
    AND can_access_branch(auth.uid(), p.branch_id)
  )
);

-- =====================================================
-- E) Migrate existing under24 driver data
-- =====================================================
INSERT INTO public.client_children (client_id, full_name, id_number, relation)
SELECT id, under24_driver_name, under24_driver_id, 'سائق إضافي'
FROM public.clients
WHERE under24_driver_name IS NOT NULL 
  AND under24_driver_name != ''
  AND under24_driver_id IS NOT NULL 
  AND under24_driver_id != '';

-- =====================================================
-- F) Trigger for updated_at
-- =====================================================
CREATE TRIGGER update_client_children_updated_at
BEFORE UPDATE ON public.client_children
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();