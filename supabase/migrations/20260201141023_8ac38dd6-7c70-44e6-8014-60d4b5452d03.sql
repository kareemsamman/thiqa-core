-- Fix: Replace "payments" with "policy_payments" and correct column names
-- Drop existing functions to recreate them with correct table references

DROP FUNCTION IF EXISTS public.report_client_debts_summary(text, integer);
DROP FUNCTION IF EXISTS public.report_client_debts(text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.report_debt_policies_for_clients(uuid[]);

-- ============================================
-- 1) report_client_debts_summary
-- ============================================
CREATE OR REPLACE FUNCTION public.report_client_debts_summary(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL
)
RETURNS TABLE (
  total_clients bigint,
  total_owed numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH client_debts AS (
    SELECT
      c.id AS client_id,
      -- Package-level calculation
      COALESCE(
        (SELECT SUM(grp_remaining)
         FROM (
           SELECT 
             p.group_id,
             GREATEST(0, SUM(COALESCE(p.insurance_price, 0)) - COALESCE(SUM(pp.amount), 0)) AS grp_remaining
           FROM policies p
           LEFT JOIN policy_payments pp ON pp.policy_id = p.id AND pp.refused IS NOT TRUE
           WHERE p.client_id = c.id
             AND p.group_id IS NOT NULL
             AND p.cancelled = false
             AND p.deleted_at IS NULL
             AND p.broker_id IS NULL
           GROUP BY p.group_id
         ) grouped
        ), 0
      )
      +
      -- Single policy calculation
      COALESCE(
        (SELECT SUM(GREATEST(0, COALESCE(p.insurance_price, 0) - COALESCE(paid.total, 0)))
         FROM policies p
         LEFT JOIN (
           SELECT policy_id, SUM(amount) AS total
           FROM policy_payments
           WHERE refused IS NOT TRUE
           GROUP BY policy_id
         ) paid ON paid.policy_id = p.id
         WHERE p.client_id = c.id
           AND p.group_id IS NULL
           AND p.cancelled = false
           AND p.deleted_at IS NULL
           AND p.broker_id IS NULL
        ), 0
      ) AS total_remaining
    FROM clients c
    WHERE c.deleted_at IS NULL
      AND can_access_branch(auth.uid(), c.branch_id)
      AND (
        p_search IS NULL 
        OR p_search = ''
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    COUNT(*)::bigint AS total_clients,
    COALESCE(SUM(cd.total_remaining), 0)::numeric AS total_owed
  FROM client_debts cd
  WHERE cd.total_remaining > 0;
END;
$$;

-- ============================================
-- 2) report_client_debts
-- ============================================
CREATE OR REPLACE FUNCTION public.report_client_debts(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  client_id uuid,
  client_name text,
  client_phone text,
  file_number text,
  total_owed numeric,
  policies_count bigint,
  oldest_end_date date,
  days_until_oldest integer,
  total_rows bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
BEGIN
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Count total matching clients first
  SELECT COUNT(*) INTO v_total
  FROM (
    SELECT c.id
    FROM clients c
    WHERE c.deleted_at IS NULL
      AND can_access_branch(auth.uid(), c.branch_id)
      AND (
        p_search IS NULL 
        OR p_search = ''
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%'
      )
      AND (
        -- Has package debt
        EXISTS (
          SELECT 1
          FROM policies p
          LEFT JOIN policy_payments pp ON pp.policy_id = p.id AND pp.refused IS NOT TRUE
          WHERE p.client_id = c.id
            AND p.group_id IS NOT NULL
            AND p.cancelled = false
            AND p.deleted_at IS NULL
            AND p.broker_id IS NULL
          GROUP BY p.group_id
          HAVING SUM(COALESCE(p.insurance_price, 0)) > COALESCE(SUM(pp.amount), 0)
        )
        OR
        -- Has single policy debt
        EXISTS (
          SELECT 1
          FROM policies p
          LEFT JOIN (
            SELECT policy_id, SUM(amount) AS total
            FROM policy_payments
            WHERE refused IS NOT TRUE
            GROUP BY policy_id
          ) paid ON paid.policy_id = p.id
          WHERE p.client_id = c.id
            AND p.group_id IS NULL
            AND p.cancelled = false
            AND p.deleted_at IS NULL
            AND p.broker_id IS NULL
            AND COALESCE(p.insurance_price, 0) > COALESCE(paid.total, 0)
        )
      )
  ) sub;

  RETURN QUERY
  WITH client_debts AS (
    SELECT
      c.id AS cid,
      c.full_name AS cname,
      c.phone_number AS cphone,
      c.file_number AS cfile,
      -- Package-level calculation
      COALESCE(
        (SELECT SUM(grp_remaining)
         FROM (
           SELECT 
             p.group_id,
             GREATEST(0, SUM(COALESCE(p.insurance_price, 0)) - COALESCE(SUM(pp.amount), 0)) AS grp_remaining
           FROM policies p
           LEFT JOIN policy_payments pp ON pp.policy_id = p.id AND pp.refused IS NOT TRUE
           WHERE p.client_id = c.id
             AND p.group_id IS NOT NULL
             AND p.cancelled = false
             AND p.deleted_at IS NULL
             AND p.broker_id IS NULL
           GROUP BY p.group_id
         ) grouped
        ), 0
      )
      +
      -- Single policy calculation
      COALESCE(
        (SELECT SUM(GREATEST(0, COALESCE(p.insurance_price, 0) - COALESCE(paid.total, 0)))
         FROM policies p
         LEFT JOIN (
           SELECT policy_id, SUM(amount) AS total
           FROM policy_payments
           WHERE refused IS NOT TRUE
           GROUP BY policy_id
         ) paid ON paid.policy_id = p.id
         WHERE p.client_id = c.id
           AND p.group_id IS NULL
           AND p.cancelled = false
           AND p.deleted_at IS NULL
           AND p.broker_id IS NULL
        ), 0
      ) AS total_remaining,
      -- Count policies with debt
      (
        SELECT COUNT(DISTINCT p.id)
        FROM policies p
        WHERE p.client_id = c.id
          AND p.cancelled = false
          AND p.deleted_at IS NULL
          AND p.broker_id IS NULL
      ) AS pol_count,
      -- Oldest end date
      (
        SELECT MIN(p.end_date)
        FROM policies p
        WHERE p.client_id = c.id
          AND p.cancelled = false
          AND p.deleted_at IS NULL
          AND p.broker_id IS NULL
      ) AS min_end_date
    FROM clients c
    WHERE c.deleted_at IS NULL
      AND can_access_branch(auth.uid(), c.branch_id)
      AND (
        p_search IS NULL 
        OR p_search = ''
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    cd.cid AS client_id,
    cd.cname AS client_name,
    cd.cphone AS client_phone,
    cd.cfile AS file_number,
    cd.total_remaining AS total_owed,
    cd.pol_count AS policies_count,
    cd.min_end_date AS oldest_end_date,
    (cd.min_end_date - CURRENT_DATE)::integer AS days_until_oldest,
    v_total AS total_rows
  FROM client_debts cd
  WHERE cd.total_remaining > 0
  ORDER BY cd.total_remaining DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ============================================
-- 3) report_debt_policies_for_clients
-- ============================================
CREATE OR REPLACE FUNCTION public.report_debt_policies_for_clients(
  p_client_ids uuid[]
)
RETURNS TABLE (
  client_id uuid,
  policy_id uuid,
  policy_number text,
  insurance_price numeric,
  paid numeric,
  remaining numeric,
  end_date date,
  days_until_expiry integer,
  status text,
  policy_type_parent text,
  policy_type_child text,
  car_number text,
  group_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH policy_payments_agg AS (
    SELECT 
      pp.policy_id,
      SUM(pp.amount) AS total_paid
    FROM policy_payments pp
    WHERE pp.refused IS NOT TRUE
    GROUP BY pp.policy_id
  ),
  group_totals AS (
    SELECT
      p.group_id,
      SUM(COALESCE(p.insurance_price, 0)) AS group_price,
      COALESCE(SUM(ppa.total_paid), 0) AS group_paid,
      GREATEST(0, SUM(COALESCE(p.insurance_price, 0)) - COALESCE(SUM(ppa.total_paid), 0)) AS group_remaining
    FROM policies p
    LEFT JOIN policy_payments_agg ppa ON ppa.policy_id = p.id
    WHERE p.group_id IS NOT NULL
      AND p.client_id = ANY(p_client_ids)
      AND p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  )
  -- Packages: distribute remaining proportionally
  SELECT
    p.client_id,
    p.id AS policy_id,
    p.policy_number,
    p.insurance_price,
    -- Proportional paid
    CASE 
      WHEN gt.group_price > 0 THEN 
        ROUND((COALESCE(p.insurance_price, 0) / gt.group_price) * gt.group_paid, 2)
      ELSE 0
    END AS paid,
    -- Proportional remaining
    CASE 
      WHEN gt.group_price > 0 THEN 
        ROUND((COALESCE(p.insurance_price, 0) / gt.group_price) * gt.group_remaining, 2)
      ELSE COALESCE(p.insurance_price, 0)
    END AS remaining,
    p.end_date,
    (p.end_date - CURRENT_DATE)::integer AS days_until_expiry,
    CASE
      WHEN p.cancelled = true THEN 'cancelled'
      WHEN p.end_date < CURRENT_DATE THEN 'expired'
      ELSE 'active'
    END AS status,
    p.policy_type_parent::text,
    p.policy_type_child::text,
    car.car_number,
    p.group_id
  FROM policies p
  INNER JOIN group_totals gt ON gt.group_id = p.group_id
  LEFT JOIN cars car ON car.id = p.car_id
  WHERE p.client_id = ANY(p_client_ids)
    AND p.cancelled = false
    AND p.deleted_at IS NULL
    AND p.broker_id IS NULL
    AND gt.group_remaining > 0

  UNION ALL

  -- Single policies (no group)
  SELECT
    p.client_id,
    p.id AS policy_id,
    p.policy_number,
    p.insurance_price,
    COALESCE(ppa.total_paid, 0) AS paid,
    GREATEST(0, COALESCE(p.insurance_price, 0) - COALESCE(ppa.total_paid, 0)) AS remaining,
    p.end_date,
    (p.end_date - CURRENT_DATE)::integer AS days_until_expiry,
    CASE
      WHEN p.cancelled = true THEN 'cancelled'
      WHEN p.end_date < CURRENT_DATE THEN 'expired'
      ELSE 'active'
    END AS status,
    p.policy_type_parent::text,
    p.policy_type_child::text,
    car.car_number,
    p.group_id
  FROM policies p
  LEFT JOIN policy_payments_agg ppa ON ppa.policy_id = p.id
  LEFT JOIN cars car ON car.id = p.car_id
  WHERE p.client_id = ANY(p_client_ids)
    AND p.group_id IS NULL
    AND p.cancelled = false
    AND p.deleted_at IS NULL
    AND p.broker_id IS NULL
    AND COALESCE(p.insurance_price, 0) > COALESCE(ppa.total_paid, 0)

  ORDER BY client_id, group_id NULLS LAST, end_date;
END;
$$;