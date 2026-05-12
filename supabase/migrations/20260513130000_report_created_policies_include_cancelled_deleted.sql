-- ============================================================
-- report_created_policies → include cancelled + soft-deleted
--
-- The "المعاملات المنشأة" report previously filtered out rows
-- where cancelled = true or deleted_at IS NOT NULL, so anything
-- a user created and then cancelled or deleted vanished from
-- the audit trail. Staff need to see those rows to follow what
-- a teammate did over a shift.
--
-- Changes:
--   • Remove `p.cancelled = false` and `p.deleted_at IS NULL`
--     from the main FROM (and from the package-detection
--     subquery, so an all-cancelled package still groups).
--   • Return two new boolean columns derived per-group:
--       is_cancelled — true when every policy in the group is
--                      cancelled (so the row reads "ملغاة")
--       is_deleted   — true when every policy in the group is
--                      soft-deleted
--     Mixed groups (some cancelled, some active) read as
--     active in the report. The drill-in view shows the per-
--     member detail.
-- ============================================================

DROP FUNCTION IF EXISTS public.report_created_policies(date, date, text, uuid, text, uuid, integer, integer, uuid);

CREATE OR REPLACE FUNCTION public.report_created_policies(
  p_start_date date,
  p_end_date date,
  p_search text DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_page_size integer DEFAULT 25,
  p_page integer DEFAULT 1,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid, group_key text, is_package boolean, package_types text[],
  package_policy_ids uuid[], package_count integer, client_id uuid,
  client_name text, client_file_number text, client_phone text,
  car_id uuid, car_number text, company_id uuid, company_name text,
  company_name_ar text, policy_type_parent text, policy_type_child text,
  policy_number text, start_date date, end_date date,
  insurance_price numeric, profit numeric, total_paid numeric,
  remaining numeric, payment_status text, created_at timestamptz,
  created_by_admin_id uuid, created_by_name text, branch_name text,
  total_count bigint, package_companies text[], package_service_names text[],
  is_cancelled boolean, is_deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset integer := (p_page - 1) * p_page_size;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH grouped_policies AS (
    SELECT
      COALESCE(p.group_id::text, p.id::text) as grp_key,
      bool_or(p.group_id IS NOT NULL AND (
        SELECT count(*) FROM policies p2
         WHERE p2.group_id = p.group_id
           AND (v_is_sa OR p2.agent_id = v_agent_id)
      ) > 1) as grp_is_package,
      ARRAY_AGG(DISTINCT
        CASE WHEN p.policy_type_parent::text = 'THIRD_FULL' AND p.policy_type_child IS NOT NULL
            THEN p.policy_type_child::text ELSE p.policy_type_parent::text END
      ) as grp_types,
      ARRAY_AGG(DISTINCT p.id) as grp_policy_ids,
      count(DISTINCT p.id)::integer as grp_count,
      (ARRAY_AGG(p.client_id))[1] as grp_client_id,
      (ARRAY_AGG(c.full_name))[1] as grp_client_name,
      (ARRAY_AGG(c.file_number))[1] as grp_client_file_number,
      (ARRAY_AGG(c.phone_number))[1] as grp_client_phone,
      (ARRAY_AGG(p.car_id))[1] as grp_car_id,
      (ARRAY_AGG(cr.car_number))[1] as grp_car_number,
      (ARRAY_AGG(p.company_id))[1] as grp_company_id,
      (ARRAY_AGG(ic.name))[1] as grp_company_name,
      (ARRAY_AGG(ic.name_ar))[1] as grp_company_name_ar,
      (ARRAY_AGG(p.policy_type_parent::text))[1] as grp_policy_type_parent,
      (ARRAY_AGG(p.policy_type_child::text))[1] as grp_policy_type_child,
      (ARRAY_AGG(p.policy_number))[1] as grp_policy_number,
      min(p.start_date) as grp_start_date,
      max(p.end_date) as grp_end_date,
      sum(p.insurance_price) as grp_insurance_price,
      sum(COALESCE(p.profit, 0)) as grp_profit,
      min(p.created_at) as grp_created_at,
      (ARRAY_AGG(p.created_by_admin_id))[1] as grp_created_by,
      (ARRAY_AGG(pr.full_name))[1] as grp_created_by_name,
      (ARRAY_AGG(b.name_ar))[1] as grp_branch_name,
      ARRAY_AGG(DISTINCT COALESCE(ic.name_ar, ic.name)) FILTER (WHERE ic.name IS NOT NULL) as grp_company_names,
      ARRAY_AGG(DISTINCT COALESCE(rs.name_ar, rs.name)) FILTER (WHERE rs.id IS NOT NULL) as grp_road_service_names,
      ARRAY_AGG(DISTINCT COALESCE(afs.name_ar, afs.name)) FILTER (WHERE afs.id IS NOT NULL) as grp_accident_fee_names,
      bool_and(COALESCE(p.cancelled, false)) as grp_all_cancelled,
      bool_and(p.deleted_at IS NOT NULL) as grp_all_deleted
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars cr ON cr.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN profiles pr ON pr.id = p.created_by_admin_id
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN road_services rs ON rs.id = p.road_service_id
    LEFT JOIN accident_fee_services afs ON afs.id = p.accident_fee_service_id
    WHERE p.created_at::date BETWEEN p_start_date AND p_end_date
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_is_sa OR c.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
      AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (p_search IS NULL OR p_search = '' OR
           c.full_name ILIKE '%' || p_search || '%' OR
           c.phone_number ILIKE '%' || p_search || '%' OR
           c.id_number ILIKE '%' || p_search || '%' OR
           c.file_number ILIKE '%' || p_search || '%' OR
           cr.car_number ILIKE '%' || p_search || '%' OR
           p.policy_number ILIKE '%' || p_search || '%')
    GROUP BY COALESCE(p.group_id::text, p.id::text)
  ),
  with_payments AS (
    SELECT gp.*,
      COALESCE((
        SELECT sum(pp.amount) FROM policy_payments pp
        WHERE pp.policy_id = ANY(gp.grp_policy_ids) AND pp.refused = false
      ), 0) as grp_total_paid
    FROM grouped_policies gp
  ),
  counted AS (
    SELECT *, count(*) OVER () as cnt FROM with_payments
    ORDER BY grp_created_at DESC LIMIT p_page_size OFFSET v_offset
  )
  SELECT
    (ct.grp_policy_ids[1])::uuid, ct.grp_key, ct.grp_is_package, ct.grp_types,
    ct.grp_policy_ids, ct.grp_count, ct.grp_client_id, ct.grp_client_name,
    ct.grp_client_file_number, ct.grp_client_phone, ct.grp_car_id,
    ct.grp_car_number, ct.grp_company_id, ct.grp_company_name,
    ct.grp_company_name_ar, ct.grp_policy_type_parent, ct.grp_policy_type_child,
    ct.grp_policy_number, ct.grp_start_date, ct.grp_end_date,
    ct.grp_insurance_price, ct.grp_profit, ct.grp_total_paid,
    GREATEST(ct.grp_insurance_price - ct.grp_total_paid, 0),
    CASE WHEN ct.grp_total_paid >= ct.grp_insurance_price THEN 'paid'
         WHEN ct.grp_total_paid > 0 THEN 'partial'
         ELSE 'unpaid' END,
    ct.grp_created_at, ct.grp_created_by, ct.grp_created_by_name,
    ct.grp_branch_name, ct.cnt, ct.grp_company_names,
    ARRAY(SELECT unnest FROM (
      SELECT unnest(ct.grp_road_service_names)
      UNION SELECT unnest(ct.grp_accident_fee_names)
    ) sub),
    ct.grp_all_cancelled,
    ct.grp_all_deleted
  FROM counted ct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_created_policies(date, date, text, uuid, text, uuid, integer, integer, uuid) TO authenticated;
