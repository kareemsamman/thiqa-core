-- Diagnostic only: exposes a per-client breakdown so we can compare
-- the summary's pending count against the list's actual rows. Will be
-- dropped once the discrepancy is resolved.

CREATE OR REPLACE FUNCTION public._debug_renewals_diff(p_end_month text)
RETURNS TABLE(
  source text,
  client_id uuid,
  client_name text,
  client_deleted boolean,
  client_agent_id uuid,
  in_summary_pending boolean,
  in_list boolean,
  followup_status text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  month_start date := date_trunc('month', p_end_month::date)::date;
  month_end date := (month_start + interval '1 month' - interval '1 day')::date;
  month_str text := to_char(month_start, 'YYYY-MM');
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
  v_see_all boolean := public.can_see_all_branches();
  v_my_branch uuid := public.get_my_branch_id();
BEGIN
  RETURN QUERY
  WITH expiring AS (
    SELECT DISTINCT p.client_id, c.full_name, c.deleted_at IS NOT NULL AS client_deleted_, c.agent_id AS client_agent
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    WHERE p.end_date BETWEEN month_start AND month_end
      AND p.cancelled = false AND p.transferred = false AND p.deleted_at IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (v_see_all OR p.branch_id IS NULL OR p.branch_id = v_my_branch)
  ),
  with_followup AS (
    SELECT e.*, rf.status AS fstatus
    FROM expiring e
    LEFT JOIN renewal_followups rf ON rf.client_id = e.client_id
      AND rf.follow_up_month = month_str
  ),
  classified AS (
    SELECT
      wf.client_id,
      wf.full_name,
      wf.client_deleted_,
      wf.client_agent,
      wf.fstatus,
      -- summary's pending: client is non-deleted, agent-matched, no renewed/declined followup
      (NOT wf.client_deleted_)
        AND (v_is_sa OR wf.client_agent = v_agent_id)
        AND (wf.fstatus IS NULL OR wf.fstatus NOT IN ('renewed', 'declined_renewal'))
        AS summary_pending,
      -- list's inclusion: same conditions
      (NOT wf.client_deleted_)
        AND (v_is_sa OR wf.client_agent = v_agent_id)
        AND (wf.fstatus IS NULL OR wf.fstatus NOT IN ('renewed', 'declined_renewal'))
        AS list_in
    FROM with_followup wf
  )
  SELECT 'expiring'::text, c.client_id, c.full_name, c.client_deleted_, c.client_agent,
         c.summary_pending, c.list_in, c.fstatus
  FROM classified c
  ORDER BY c.full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public._debug_renewals_diff(text) TO authenticated;
