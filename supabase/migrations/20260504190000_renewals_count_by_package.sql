-- Renewals & renewed-clients reports counted each policy row separately,
-- so a 2-policy package (e.g. شامل + خدمات الطريق sharing one group_id)
-- showed as "2 معاملة". Business rule: one package = one معاملة, single
-- policy = one معاملة. Count distinct group_id (falling back to policy id
-- for un-grouped policies) instead.

CREATE OR REPLACE FUNCTION public.report_renewals(
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_policy_type text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_page_size integer DEFAULT 25,
  p_page integer DEFAULT 1,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_file_number text,
  client_phone text,
  policies_count integer,
  earliest_end_date date,
  days_remaining integer,
  total_insurance_price numeric,
  policy_types text[],
  policy_ids uuid[],
  car_numbers text[],
  worst_renewal_status text,
  renewal_notes text,
  total_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset integer;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  v_offset := (p_page - 1) * p_page_size;
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH client_policies AS (
    SELECT
      c.id as cid, c.full_name as cname, c.file_number as cfile, c.phone_number as cphone,
      p.id as pid, p.group_id as pgroup, p.end_date, p.insurance_price, p.policy_type_parent,
      COALESCE(prt.renewal_status, 'not_contacted') as rstatus,
      prt.notes as rnotes, car.car_number as car_num
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.cancelled = false AND p.transferred = false AND p.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_is_sa OR c.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      AND p.end_date >= COALESCE(p_start_date, p.end_date)
      AND p.end_date <= COALESCE(p_end_date, p.end_date)
      AND (NULLIF(p_policy_type, '') IS NULL OR p.policy_type_parent::text = NULLIF(p_policy_type, ''))
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (
        p_search IS NULL
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
        OR car.car_number ILIKE '%' || p_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id IS NOT DISTINCT FROM p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.deleted_at IS NULL
          AND newer.cancelled = false
          AND newer.transferred = false
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
          AND (v_is_sa OR newer.agent_id = v_agent_id)
      )
  ),
  aggregated AS (
    SELECT
      cp.cid, cp.cname, cp.cfile, cp.cphone,
      COUNT(DISTINCT COALESCE(cp.pgroup::text, cp.pid::text))::integer as pcount,
      MIN(cp.end_date) as min_end,
      (MIN(cp.end_date) - CURRENT_DATE)::integer as days_rem,
      SUM(COALESCE(cp.insurance_price, 0)) as total_price,
      ARRAY_AGG(DISTINCT cp.policy_type_parent::text) FILTER (WHERE cp.policy_type_parent IS NOT NULL) as ptypes,
      ARRAY_AGG(cp.pid) as pids,
      ARRAY_AGG(DISTINCT cp.car_num) FILTER (WHERE cp.car_num IS NOT NULL) as car_nums,
      CASE
        WHEN bool_or(cp.rstatus = 'not_contacted') THEN 'not_contacted'
        WHEN bool_or(cp.rstatus = 'sms_sent') THEN 'sms_sent'
        WHEN bool_or(cp.rstatus = 'called') THEN 'called'
        WHEN bool_or(cp.rstatus = 'not_interested') THEN 'not_interested'
        ELSE 'renewed'
      END as worst_status,
      STRING_AGG(cp.rnotes, '; ') FILTER (WHERE cp.rnotes IS NOT NULL) as notes_agg
    FROM client_policies cp
    GROUP BY cp.cid, cp.cname, cp.cfile, cp.cphone
  ),
  counted AS (SELECT COUNT(*) OVER() as total FROM aggregated)
  SELECT
    a.cid, a.cname, a.cfile, a.cphone, a.pcount, a.min_end, a.days_rem,
    a.total_price, a.ptypes, a.pids, a.car_nums, a.worst_status, a.notes_agg,
    (SELECT total FROM counted LIMIT 1)
  FROM aggregated a
  ORDER BY a.min_end ASC
  LIMIT p_page_size OFFSET v_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_renewals(date, date, text, uuid, text, integer, integer, uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.report_renewed_clients(
  p_end_month text DEFAULT NULL::text,
  p_policy_type text DEFAULT NULL::text,
  p_created_by uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  client_id uuid, client_name text, client_file_number text, client_phone text,
  policies_count bigint, earliest_end_date date, total_insurance_price numeric,
  policy_types text[], policy_ids uuid[], new_policies_count bigint,
  new_policy_ids uuid[], new_policy_types text[], new_total_price numeric,
  new_start_date date, has_package boolean, renewed_by_admin_id uuid,
  renewed_by_name text, total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month_start date;
  v_month_end date;
  v_policy_type public.policy_type_parent;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN;
  END IF;

  IF p_end_month IS NOT NULL AND p_end_month != '' THEN
    v_month_start := date_trunc('month', p_end_month::date);
    v_month_end := (date_trunc('month', p_end_month::date) + interval '1 month' - interval '1 day')::date;
  ELSE
    v_month_start := date_trunc('month', CURRENT_DATE);
    v_month_end := (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date;
  END IF;

  v_policy_type := NULLIF(p_policy_type, '')::public.policy_type_parent;

  RETURN QUERY
  WITH expiring_policies AS (
    SELECT p.id, p.client_id, p.car_id, p.policy_type_parent AS ptype,
           p.group_id, p.insurance_price, p.end_date, p.start_date
    FROM policies p
    WHERE p.end_date BETWEEN v_month_start AND v_month_end
      AND p.cancelled = false AND p.transferred = false AND p.deleted_at IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      AND (v_policy_type IS NULL OR p.policy_type_parent = v_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (p_search IS NULL OR p_search = '' OR EXISTS (
          SELECT 1 FROM clients c WHERE c.id = p.client_id
            AND (v_is_sa OR c.agent_id = v_agent_id)
            AND (c.full_name ILIKE '%' || p_search || '%'
              OR c.id_number ILIKE '%' || p_search || '%'
              OR c.phone_number ILIKE '%' || p_search || '%'
              OR c.file_number ILIKE '%' || p_search || '%')
        ))
      AND EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id IS NOT DISTINCT FROM p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
          AND newer.cancelled = false AND newer.transferred = false AND newer.deleted_at IS NULL
          AND (v_is_sa OR newer.agent_id = v_agent_id)
      )
  ),
  renewal_mappings AS (
    SELECT DISTINCT ON (ep.id)
      ep.id AS old_policy_id, ep.client_id, np.id AS new_policy_id,
      np.policy_type_parent AS new_ptype, np.insurance_price AS new_price,
      np.start_date AS new_start, np.group_id AS new_group_id,
      np.created_by_admin_id AS renewed_by
    FROM expiring_policies ep
    JOIN policies np ON np.client_id = ep.client_id
      AND np.car_id IS NOT DISTINCT FROM ep.car_id
      AND np.policy_type_parent = ep.ptype
      AND np.start_date > ep.start_date
      AND np.end_date > CURRENT_DATE
      AND np.cancelled = false AND np.transferred = false AND np.deleted_at IS NULL
      AND (v_is_sa OR np.agent_id = v_agent_id)
    ORDER BY ep.id, np.start_date ASC
  ),
  client_aggregates AS (
    SELECT ep.client_id, c.full_name AS client_name,
      c.file_number AS client_file_number, c.phone_number AS client_phone,
      COUNT(DISTINCT COALESCE(ep.group_id::text, ep.id::text))::bigint AS policies_count,
      MIN(ep.end_date) AS earliest_end_date,
      COALESCE(SUM(ep.insurance_price), 0) AS total_insurance_price,
      ARRAY_AGG(DISTINCT ep.ptype::text) AS policy_types,
      ARRAY_AGG(DISTINCT ep.id) AS policy_ids,
      COUNT(DISTINCT COALESCE(rm.new_group_id::text, rm.new_policy_id::text)) FILTER (WHERE rm.new_policy_id IS NOT NULL)::bigint AS new_policies_count,
      ARRAY_AGG(DISTINCT rm.new_policy_id) FILTER (WHERE rm.new_policy_id IS NOT NULL) AS new_policy_ids,
      ARRAY_AGG(DISTINCT rm.new_ptype::text) FILTER (WHERE rm.new_ptype IS NOT NULL) AS new_policy_types,
      COALESCE(SUM(DISTINCT rm.new_price) FILTER (WHERE rm.new_policy_id IS NOT NULL), 0) AS new_total_price,
      MIN(rm.new_start) AS new_start_date,
      bool_or(ep.group_id IS NOT NULL OR rm.new_group_id IS NOT NULL) AS has_package,
      (ARRAY_AGG(rm.renewed_by ORDER BY rm.new_start ASC) FILTER (WHERE rm.renewed_by IS NOT NULL))[1] AS renewed_by_admin_id
    FROM expiring_policies ep
    JOIN clients c ON c.id = ep.client_id
    LEFT JOIN renewal_mappings rm ON rm.old_policy_id = ep.id
    WHERE (v_is_sa OR c.agent_id = v_agent_id)
    GROUP BY ep.client_id, c.full_name, c.file_number, c.phone_number
  )
  SELECT ca.client_id, ca.client_name, ca.client_file_number, ca.client_phone,
    ca.policies_count, ca.earliest_end_date, ca.total_insurance_price,
    ca.policy_types, ca.policy_ids, ca.new_policies_count, ca.new_policy_ids,
    ca.new_policy_types, ca.new_total_price, ca.new_start_date, ca.has_package,
    ca.renewed_by_admin_id, pr.full_name AS renewed_by_name,
    COUNT(*) OVER()::bigint AS total_count
  FROM client_aggregates ca
  LEFT JOIN profiles pr ON pr.id = ca.renewed_by_admin_id
  ORDER BY ca.earliest_end_date ASC, ca.client_name
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.report_renewed_clients(text, text, uuid, text, integer, integer, uuid) TO authenticated;
