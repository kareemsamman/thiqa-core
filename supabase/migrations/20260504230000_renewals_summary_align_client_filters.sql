-- The renewals summary counted 12 expiring clients while the list
-- (report_renewals) showed 10 — the list requires the *client* to be
-- non-deleted and (for non-super-admins) agent-owned, but the summary
-- only filtered the policy. Two clients with policies in the month but
-- a soft-deleted or other-agent client record inflated the summary.
-- Apply the same client-side filters in the summary so its numbers
-- match the list.

CREATE OR REPLACE FUNCTION public.report_renewals_summary(
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
    JOIN clients c ON c.id = p.client_id
    WHERE p.end_date BETWEEN month_start AND month_end
      AND p.cancelled = false AND p.transferred = false AND p.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_is_sa OR c.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
      AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (p_search IS NULL OR p_search = ''
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%')
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
