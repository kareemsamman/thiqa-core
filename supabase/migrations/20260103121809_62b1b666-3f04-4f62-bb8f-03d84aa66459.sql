-- Fix security definer views - convert to security invoker
DROP VIEW IF EXISTS public.v_worker_policies;
DROP VIEW IF EXISTS public.v_worker_brokers;

-- Recreate with SECURITY INVOKER (default, but explicit)
CREATE VIEW public.v_worker_policies 
WITH (security_invoker = true)
AS
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
  insurance_price,
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
FROM public.policies;

CREATE VIEW public.v_worker_brokers 
WITH (security_invoker = true)
AS
SELECT 
  id,
  name
FROM public.brokers;