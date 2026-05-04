-- Aligns the renewals summary cards with the new "click-driven" rule:
-- a customer is "renewed" iff there is a renewal_followups row with
-- status='renewed' for the selected month, and "declined" iff the row
-- is status='declined_renewal'. Pending = everyone else expiring.
-- Also tightens report_renewals so the معلقون list excludes declined
-- customers (it already excludes renewed, in 20260504210000).
-- Additionally returns total_transactions: distinct group_id ∪ id
-- across non-renewed expiring policies — replaces the old
-- total_packages/total_single split in the UI.

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
      p.id as pid, p.group_id as pgroup, p.end_date, p.insurance_price,
      p.policy_type_parent, p.policy_type_child,
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
        SELECT 1 FROM renewal_followups rf
        WHERE rf.client_id = p.client_id
          AND rf.follow_up_month = to_char(p.end_date, 'YYYY-MM')
          AND rf.status IN ('renewed', 'declined_renewal')
      )
  ),
  aggregated AS (
    SELECT
      cp.cid, cp.cname, cp.cfile, cp.cphone,
      COUNT(DISTINCT COALESCE(cp.pgroup::text, cp.pid::text))::integer as pcount,
      MIN(cp.end_date) as min_end,
      (MIN(cp.end_date) - CURRENT_DATE)::integer as days_rem,
      SUM(COALESCE(cp.insurance_price, 0)) as total_price,
      ARRAY_AGG(DISTINCT
        CASE WHEN cp.policy_type_parent::text = 'THIRD_FULL' AND cp.policy_type_child IS NOT NULL
             THEN cp.policy_type_child::text
             ELSE cp.policy_type_parent::text END
      ) FILTER (WHERE cp.policy_type_parent IS NOT NULL) as ptypes,
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


DROP FUNCTION IF EXISTS public.report_renewals_summary(text, text, uuid, text, uuid);

CREATE FUNCTION public.report_renewals_summary(
  p_end_month text DEFAULT NULL::text,
  p_policy_type text DEFAULT NULL::text,
  p_created_by uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  total_expiring bigint,
  pending bigint,
  renewed bigint,
  declined bigint,
  total_transactions bigint,
  total_value numeric
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  month_start date; month_end date; month_str text;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  IF p_end_month IS NULL THEN
    month_start := date_trunc('month', CURRENT_DATE)::date;
  ELSE
    month_start := date_trunc('month', p_end_month::date)::date;
  END IF;
  month_end := (month_start + interval '1 month' - interval '1 day')::date;
  month_str := to_char(month_start, 'YYYY-MM');

  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::numeric;
    RETURN;
  END IF;

  RETURN QUERY
  WITH followups AS (
    SELECT rf.client_id, rf.status
    FROM renewal_followups rf
    WHERE rf.follow_up_month = month_str
      AND (v_is_sa OR rf.agent_id = v_agent_id)
  ),
  expiring_policies AS (
    SELECT p.id, p.client_id, p.group_id, p.insurance_price
    FROM policies p
    WHERE p.end_date BETWEEN month_start AND month_end
      AND p.cancelled = false AND p.transferred = false AND p.deleted_at IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (p_search IS NULL OR p_search = '' OR EXISTS (
          SELECT 1 FROM clients c WHERE c.id = p.client_id
            AND (v_is_sa OR c.agent_id = v_agent_id)
            AND (c.full_name ILIKE '%' || p_search || '%'
              OR c.id_number ILIKE '%' || p_search || '%'
              OR c.phone_number ILIKE '%' || p_search || '%')
        ))
  ),
  client_status AS (
    SELECT
      ep.client_id,
      COALESCE(MAX(f.status), 'pending') AS followup_status,
      COUNT(DISTINCT COALESCE(ep.group_id::text, ep.id::text))::bigint AS tx_count,
      SUM(ep.insurance_price) AS total_value
    FROM expiring_policies ep
    LEFT JOIN followups f ON f.client_id = ep.client_id
    GROUP BY ep.client_id
  )
  SELECT
    COUNT(*)::bigint AS total_expiring,
    COUNT(*) FILTER (WHERE cs.followup_status NOT IN ('renewed', 'declined_renewal'))::bigint AS pending,
    COUNT(*) FILTER (WHERE cs.followup_status = 'renewed')::bigint AS renewed,
    COUNT(*) FILTER (WHERE cs.followup_status = 'declined_renewal')::bigint AS declined,
    COALESCE(SUM(cs.tx_count) FILTER (WHERE cs.followup_status != 'renewed'), 0)::bigint AS total_transactions,
    COALESCE(SUM(cs.total_value) FILTER (WHERE cs.followup_status != 'renewed'), 0)::numeric AS total_value
  FROM client_status cs;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.report_renewals_summary(text, text, uuid, text, uuid) TO authenticated;
