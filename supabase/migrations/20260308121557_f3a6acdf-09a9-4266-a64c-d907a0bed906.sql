-- 1) Harden agent membership helper to avoid NULL-agent leaks
CREATE OR REPLACE FUNCTION public.user_belongs_to_agent(_user_id uuid, _agent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    WHEN public.is_super_admin(_user_id) THEN true
    WHEN _agent_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.agent_users
      WHERE user_id = _user_id
        AND agent_id = _agent_id
    )
  END
$$;

-- 2) Shared tenant guard used by restrictive policies
CREATE OR REPLACE FUNCTION public.enforce_agent_isolation(_agent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_belongs_to_agent(auth.uid(), _agent_id)
$$;

-- 3) Add restrictive tenant policy to every base table containing agent_id
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'agent_id'
      AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tenant_isolation_authenticated', r.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.enforce_agent_isolation(agent_id)) WITH CHECK (public.enforce_agent_isolation(agent_id))',
      'tenant_isolation_authenticated',
      r.table_name
    );
  END LOOP;
END $$;

-- 4) Replace unsafe public site settings policies with tenant-safe policies
DROP POLICY IF EXISTS "Anyone can read site settings" ON public.site_settings;
DROP POLICY IF EXISTS "Authenticated users can update site settings" ON public.site_settings;
DROP POLICY IF EXISTS "Agent users can view own site settings" ON public.site_settings;
DROP POLICY IF EXISTS "Agent admins can insert site settings" ON public.site_settings;
DROP POLICY IF EXISTS "Agent admins can update site settings" ON public.site_settings;
DROP POLICY IF EXISTS "Agent admins can delete site settings" ON public.site_settings;

CREATE POLICY "Agent users can view own site settings"
ON public.site_settings
FOR SELECT
TO authenticated
USING (public.enforce_agent_isolation(agent_id));

CREATE POLICY "Agent admins can insert site settings"
ON public.site_settings
FOR INSERT
TO authenticated
WITH CHECK (
  public.enforce_agent_isolation(agent_id)
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Agent admins can update site settings"
ON public.site_settings
FOR UPDATE
TO authenticated
USING (
  public.enforce_agent_isolation(agent_id)
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
)
WITH CHECK (
  public.enforce_agent_isolation(agent_id)
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Agent admins can delete site settings"
ON public.site_settings
FOR DELETE
TO authenticated
USING (
  public.enforce_agent_isolation(agent_id)
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- 5) Scope renewals summary to caller's agent (super admin keeps global view)
CREATE OR REPLACE FUNCTION public.report_renewals_summary(
  p_end_month text DEFAULT NULL::text,
  p_policy_type text DEFAULT NULL::text,
  p_created_by uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text
)
RETURNS TABLE(
  total_expiring bigint,
  not_contacted bigint,
  sms_sent bigint,
  called bigint,
  renewed bigint,
  not_interested bigint,
  total_packages bigint,
  total_single bigint,
  total_value numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  month_start date;
  month_end date;
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
BEGIN
  IF p_end_month IS NULL THEN
    month_start := date_trunc('month', CURRENT_DATE)::date;
    month_end := (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date;
  ELSE
    month_start := date_trunc('month', p_end_month::date)::date;
    month_end := (date_trunc('month', p_end_month::date) + interval '1 month' - interval '1 day')::date;
  END IF;

  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::numeric;
    RETURN;
  END IF;

  RETURN QUERY
  WITH expiring_policies AS (
    SELECT 
      p.id,
      p.client_id,
      p.group_id,
      p.insurance_price,
      p.policy_type_parent,
      EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id IS NOT DISTINCT FROM p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.cancelled = false
          AND newer.transferred = false
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
          AND (v_is_sa OR newer.agent_id = v_agent_id)
      ) AS is_auto_renewed,
      COALESCE(prt.renewal_status, 'not_contacted') AS renewal_status
    FROM policies p
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.end_date BETWEEN month_start AND month_end
      AND p.cancelled = false
      AND p.transferred = false
      AND p.deleted_at IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
      AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (
        p_search IS NULL 
        OR p_search = ''
        OR EXISTS (
          SELECT 1 FROM clients c 
          WHERE c.id = p.client_id 
            AND (v_is_sa OR c.agent_id = v_agent_id)
            AND (
              c.full_name ILIKE '%' || p_search || '%'
              OR c.id_number ILIKE '%' || p_search || '%'
              OR c.phone_number ILIKE '%' || p_search || '%'
            )
        )
      )
  ),
  policies_with_status AS (
    SELECT
      ep.id,
      ep.client_id,
      ep.group_id,
      ep.insurance_price,
      CASE 
        WHEN ep.is_auto_renewed THEN 'renewed'
        ELSE ep.renewal_status
      END AS final_status,
      ep.group_id IS NOT NULL AS has_package
    FROM expiring_policies ep
  ),
  client_statuses AS (
    SELECT 
      pws.client_id,
      CASE 
        WHEN bool_or(pws.final_status = 'not_contacted') THEN 'not_contacted'
        WHEN bool_or(pws.final_status = 'sms_sent') THEN 'sms_sent'
        WHEN bool_or(pws.final_status = 'called') THEN 'called'
        WHEN bool_or(pws.final_status = 'renewed') THEN 'renewed'
        WHEN bool_or(pws.final_status = 'not_interested') THEN 'not_interested'
        ELSE 'not_contacted'
      END AS status,
      bool_or(pws.has_package) AS has_package,
      SUM(pws.insurance_price) AS total_value
    FROM policies_with_status pws
    GROUP BY pws.client_id
  )
  SELECT
    COUNT(*)::bigint AS total_expiring,
    COUNT(*) FILTER (WHERE cs.status = 'not_contacted')::bigint AS not_contacted,
    COUNT(*) FILTER (WHERE cs.status = 'sms_sent')::bigint AS sms_sent,
    COUNT(*) FILTER (WHERE cs.status = 'called')::bigint AS called,
    COUNT(*) FILTER (WHERE cs.status = 'renewed')::bigint AS renewed,
    COUNT(*) FILTER (WHERE cs.status = 'not_interested')::bigint AS not_interested,
    COUNT(*) FILTER (WHERE cs.has_package AND cs.status != 'renewed')::bigint AS total_packages,
    COUNT(*) FILTER (WHERE NOT cs.has_package AND cs.status != 'renewed')::bigint AS total_single,
    COALESCE(SUM(cs.total_value) FILTER (WHERE cs.status != 'renewed'), 0)::numeric AS total_value
  FROM client_statuses cs;
END;
$function$;

-- 6) Scope debt summary to caller's agent (super admin keeps global view)
CREATE OR REPLACE FUNCTION public.report_client_debts_summary(
  p_search text DEFAULT NULL::text,
  p_filter_days integer DEFAULT NULL::integer
)
RETURNS TABLE(total_clients bigint, total_remaining numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_sa boolean := COALESCE(public.is_super_admin(auth.uid()), false);
  v_agent_id uuid := public.get_user_agent_id(auth.uid());
BEGIN
  IF (NOT v_is_sa) AND v_agent_id IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::numeric;
    RETURN;
  END IF;

  RETURN QUERY
  WITH client_balances AS (
    SELECT 
      c.id AS cid,
      gcb.total_remaining
    FROM clients c
    CROSS JOIN LATERAL get_client_balance(c.id) gcb
    WHERE c.deleted_at IS NULL
      AND (v_is_sa OR c.agent_id = v_agent_id)
      AND gcb.total_remaining > 0
      AND (
        p_search IS NULL 
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
      )
  ),
  policy_dates AS (
    SELECT 
      cb.cid,
      MIN(p.end_date)::date AS oldest_end
    FROM client_balances cb
    JOIN policies p ON p.client_id = cb.cid
    WHERE COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
      AND (v_is_sa OR p.agent_id = v_agent_id)
    GROUP BY cb.cid
  ),
  filtered AS (
    SELECT cb.cid, cb.total_remaining
    FROM client_balances cb
    LEFT JOIN policy_dates pd ON pd.cid = cb.cid
    WHERE (
      p_filter_days IS NULL 
      OR pd.oldest_end IS NULL 
      OR pd.oldest_end <= CURRENT_DATE + p_filter_days
    )
  )
  SELECT 
    COUNT(DISTINCT f.cid)::bigint,
    COALESCE(SUM(f.total_remaining), 0)::numeric
  FROM filtered f;
END;
$function$;