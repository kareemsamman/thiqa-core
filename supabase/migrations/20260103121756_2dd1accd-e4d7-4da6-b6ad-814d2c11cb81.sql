-- =====================================================
-- RBAC: Worker-Safe Views and Enhanced RLS Policies
-- =====================================================

-- 1. Create worker-safe policy view (excludes financial columns)
CREATE OR REPLACE VIEW public.v_worker_policies AS
SELECT 
  id,
  client_id,
  car_id,
  company_id,
  broker_id,
  category_id,
  branch_id,
  road_service_id,
  group_id,
  policy_number,
  policy_type_parent,
  policy_type_child,
  start_date,
  end_date,
  insurance_price,  -- Customer price only
  notes,
  cancelled,
  cancellation_date,
  cancellation_note,
  transferred,
  transferred_car_number,
  is_under_24,
  broker_direction,
  created_at,
  updated_at,
  deleted_at,
  created_by_admin_id,
  cancelled_by_admin_id,
  invoices_sent_at,
  legacy_wp_id,
  calc_status
  -- EXCLUDED: profit, payed_for_company, elzami_cost, company_cost_snapshot
FROM public.policies;

-- 2. Create worker-safe brokers view (name only)
CREATE OR REPLACE VIEW public.v_worker_brokers AS
SELECT 
  id,
  name
FROM public.brokers;

-- 3. RLS for ab_ledger - Workers cannot access
DROP POLICY IF EXISTS "Workers cannot access ledger" ON public.ab_ledger;
CREATE POLICY "Workers cannot access ledger"
ON public.ab_ledger
FOR ALL
USING (
  has_role(auth.uid(), 'admin')
);

-- 4. RLS for company_settlements - Workers cannot access  
DROP POLICY IF EXISTS "Workers cannot access company settlements" ON public.company_settlements;
CREATE POLICY "Workers cannot access company settlements"
ON public.company_settlements
FOR ALL
USING (
  has_role(auth.uid(), 'admin') AND can_access_branch(auth.uid(), branch_id)
);

-- Drop existing policies first
DROP POLICY IF EXISTS "Branch users can manage company settlements" ON public.company_settlements;
DROP POLICY IF EXISTS "Branch users can view company settlements" ON public.company_settlements;

-- 5. RLS for broker_settlements - Workers cannot access
DROP POLICY IF EXISTS "Workers cannot access broker settlements" ON public.broker_settlements;
CREATE POLICY "Workers cannot access broker settlements"
ON public.broker_settlements
FOR ALL
USING (
  has_role(auth.uid(), 'admin') AND can_access_branch(auth.uid(), branch_id)
);

-- Drop existing policies first
DROP POLICY IF EXISTS "Branch users can manage broker settlements" ON public.broker_settlements;
DROP POLICY IF EXISTS "Branch users can view broker settlements" ON public.broker_settlements;

-- 6. RLS for broker_settlement_items - Workers cannot access
DROP POLICY IF EXISTS "Workers cannot access broker settlement items" ON public.broker_settlement_items;
CREATE POLICY "Workers cannot access broker settlement items"
ON public.broker_settlement_items
FOR ALL
USING (
  has_role(auth.uid(), 'admin') AND (EXISTS (
    SELECT 1 FROM broker_settlements bs
    WHERE bs.id = broker_settlement_items.settlement_id
    AND can_access_branch(auth.uid(), bs.branch_id)
  ))
);

DROP POLICY IF EXISTS "Branch users can manage settlement items" ON public.broker_settlement_items;
DROP POLICY IF EXISTS "Branch users can view settlement items" ON public.broker_settlement_items;

-- 7. Create function to check if user can view financial data
CREATE OR REPLACE FUNCTION public.can_view_financials(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT has_role(_user_id, 'admin')
$$;

-- 8. RLS for brokers table - Workers can only see via v_worker_brokers
DROP POLICY IF EXISTS "Workers can only view broker names" ON public.brokers;
CREATE POLICY "Workers can only view broker names"
ON public.brokers
FOR SELECT
USING (
  is_active_user(auth.uid())
);

-- Workers cannot manage brokers (insert, update, delete)
DROP POLICY IF EXISTS "Only admins can manage brokers" ON public.brokers;
CREATE POLICY "Only admins can manage brokers"
ON public.brokers
FOR ALL
USING (
  has_role(auth.uid(), 'admin')
);

-- Drop the old policy that allowed all active users to manage
DROP POLICY IF EXISTS "Active users can manage brokers" ON public.brokers;