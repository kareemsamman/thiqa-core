-- ============================================================
-- Auto-renewal reminder skip tracking
--
-- When the cron-renewal-reminders edge function runs and an agent
-- has exhausted their monthly SMS quota, we now stop sending and
-- leave a per-policy breadcrumb so the renewals page can surface
-- "تم تخطّي التنبيه — انتهى الحد الشهري". Previously the cron just
-- ran the agent over their cap (it never checked the quota), so
-- this is both a new feature and a fix.
--
-- Three pieces:
--   1. Two columns on policy_renewal_tracking to record the skip
--      reason + when. Successful sends clear them.
--   2. report_renewals RPC gains two new return columns so the
--      UI can render a badge without an extra round-trip.
--   3. notify_agent_admins helper — fans a single notification
--      out to every admin of a given agent, idempotent per
--      dedup_key (so re-running the cron the same day is a no-op).
-- ============================================================

-- --------------------------------------------------------------
-- 1. Per-policy skip breadcrumb
-- --------------------------------------------------------------

ALTER TABLE public.policy_renewal_tracking
  ADD COLUMN IF NOT EXISTS auto_reminder_skip_reason TEXT,
  ADD COLUMN IF NOT EXISTS auto_reminder_skip_at TIMESTAMPTZ;

COMMENT ON COLUMN public.policy_renewal_tracking.auto_reminder_skip_reason IS
  'When cron-renewal-reminders cannot send for this policy, the reason is recorded here (e.g. sms_quota_exhausted). Cleared on the next successful send.';

-- --------------------------------------------------------------
-- 2. report_renewals — expose the skip on the client row
--
-- The report aggregates per-client; if ANY of the client's policies
-- has a recent (last 30 days) skip recorded, we surface the most
-- recent reason. Bool flag lets the UI just check truthiness.
-- --------------------------------------------------------------

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
  auto_reminder_skipped boolean,
  auto_reminder_skip_reason text,
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
  v_skip_window timestamptz := now() - interval '30 days';
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
      prt.notes as rnotes, car.car_number as car_num,
      CASE WHEN prt.auto_reminder_skip_at IS NOT NULL
              AND prt.auto_reminder_skip_at >= v_skip_window
           THEN prt.auto_reminder_skip_reason
      END as skip_reason,
      CASE WHEN prt.auto_reminder_skip_at IS NOT NULL
              AND prt.auto_reminder_skip_at >= v_skip_window
           THEN prt.auto_reminder_skip_at
      END as skip_at
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
          AND rf.status = 'renewed'
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
      STRING_AGG(cp.rnotes, '; ') FILTER (WHERE cp.rnotes IS NOT NULL) as notes_agg,
      bool_or(cp.skip_reason IS NOT NULL) as any_skipped,
      -- Most recent skip reason across the client's policies
      (ARRAY_AGG(cp.skip_reason ORDER BY cp.skip_at DESC NULLS LAST))[1] as latest_skip_reason
    FROM client_policies cp
    GROUP BY cp.cid, cp.cname, cp.cfile, cp.cphone
  ),
  counted AS (SELECT COUNT(*) OVER() as total FROM aggregated)
  SELECT
    a.cid, a.cname, a.cfile, a.cphone, a.pcount, a.min_end, a.days_rem,
    a.total_price, a.ptypes, a.pids, a.car_nums, a.worst_status, a.notes_agg,
    a.any_skipped, a.latest_skip_reason,
    (SELECT total FROM counted LIMIT 1)
  FROM aggregated a
  ORDER BY a.min_end ASC
  LIMIT p_page_size OFFSET v_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_renewals(date, date, text, uuid, text, integer, integer, uuid) TO authenticated;

-- --------------------------------------------------------------
-- 3. notify_agent_admins — fan-out helper with dedup
--
-- Inserts one notification per active admin of p_agent_id. If a
-- dedup_key is provided, we skip any admin who already has a
-- notification of the same entity_type + dedup_key (regardless of
-- day) — caller is responsible for putting the date into the key
-- if they want daily granularity.
--
-- Stores dedup_key in metadata.dedup_key (jsonb) rather than
-- entity_id, because entity_id is UUID and dedup keys are usually
-- composite strings.
-- --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_agent_admins(
  p_agent_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_link text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_dedup_key text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.notifications (
    user_id, agent_id, type, title, message, link, entity_type, metadata
  )
  SELECT
    ur.user_id, p_agent_id, p_type, p_title, p_message, p_link, p_entity_type,
    CASE WHEN p_dedup_key IS NOT NULL
         THEN jsonb_build_object('dedup_key', p_dedup_key)
         ELSE '{}'::jsonb
    END
  FROM public.user_roles ur
  JOIN public.profiles pr ON pr.id = ur.user_id
  WHERE ur.role = 'admin'
    AND pr.agent_id = p_agent_id
    AND pr.status = 'active'
    AND (
      p_dedup_key IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = ur.user_id
          AND n.entity_type = p_entity_type
          AND n.metadata->>'dedup_key' = p_dedup_key
      )
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_agent_admins(uuid, text, text, text, text, text, text)
  TO authenticated, service_role;
