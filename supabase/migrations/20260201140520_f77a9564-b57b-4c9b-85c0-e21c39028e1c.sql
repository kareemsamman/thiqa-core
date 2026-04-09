-- ============================================================
-- CLEANUP: Drop duplicate/ambiguous function overloads
-- ============================================================

-- Drop the no-parameter version that causes ambiguity
DROP FUNCTION IF EXISTS public.report_client_debts_summary();

-- Drop old signature of report_client_debts that differs from what UI uses
DROP FUNCTION IF EXISTS public.report_client_debts(uuid, text, text, integer, integer);

-- Drop and recreate all debt functions with correct signatures
DROP FUNCTION IF EXISTS public.report_client_debts(text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.report_client_debts_summary(text, integer);
DROP FUNCTION IF EXISTS public.report_debt_policies_for_clients(uuid[]);

-- ============================================================
-- 1. report_client_debts_summary - Returns aggregate totals
-- ============================================================
CREATE OR REPLACE FUNCTION public.report_client_debts_summary(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL
)
RETURNS TABLE (
  total_clients bigint,
  total_owed numeric,
  total_paid numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH client_debt AS (
    SELECT
      c.id AS client_id,
      c.full_name,
      c.branch_id,
      -- Package-level debt calculation
      COALESCE(
        (
          SELECT SUM(GREATEST(0, grp.group_price - grp.group_paid))
          FROM (
            SELECT 
              p.group_id,
              SUM(COALESCE(p.insurance_price, 0)) AS group_price,
              SUM(COALESCE(pay.paid, 0)) AS group_paid
            FROM policies p
            LEFT JOIN (
              SELECT policy_id, SUM(amount) AS paid
              FROM payments
              GROUP BY policy_id
            ) pay ON pay.policy_id = p.id
            WHERE p.client_id = c.id
              AND p.group_id IS NOT NULL
              AND p.status != 'cancelled'
              AND p.policy_type_parent != 'ELZAMI'
              AND c.broker_id IS NULL
            GROUP BY p.group_id
          ) grp
        ), 0
      ) +
      -- Standalone policies debt
      COALESCE(
        (
          SELECT SUM(GREATEST(0, COALESCE(p.insurance_price, 0) - COALESCE(pay.paid, 0)))
          FROM policies p
          LEFT JOIN (
            SELECT policy_id, SUM(amount) AS paid
            FROM payments
            GROUP BY policy_id
          ) pay ON pay.policy_id = p.id
          WHERE p.client_id = c.id
            AND p.group_id IS NULL
            AND p.status != 'cancelled'
            AND p.policy_type_parent != 'ELZAMI'
            AND c.broker_id IS NULL
        ), 0
      ) AS total_remaining,
      -- Total paid across all policies
      COALESCE(
        (
          SELECT SUM(COALESCE(pay.paid, 0))
          FROM policies p
          LEFT JOIN (
            SELECT policy_id, SUM(amount) AS paid
            FROM payments
            GROUP BY policy_id
          ) pay ON pay.policy_id = p.id
          WHERE p.client_id = c.id
            AND p.status != 'cancelled'
            AND c.broker_id IS NULL
        ), 0
      ) AS client_paid
    FROM clients c
    WHERE c.deleted_at IS NULL
      AND c.broker_id IS NULL
      AND public.is_active_user(auth.uid())
      AND public.can_access_branch(auth.uid(), c.branch_id)
      AND (
        p_search IS NULL 
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%'
      )
  )
  SELECT 
    COUNT(*)::bigint AS total_clients,
    COALESCE(SUM(cd.total_remaining), 0)::numeric AS total_owed,
    COALESCE(SUM(cd.client_paid), 0)::numeric AS total_paid
  FROM client_debt cd
  WHERE cd.total_remaining > 0;
END;
$$;

-- ============================================================
-- 2. report_client_debts - Returns paginated client list
-- ============================================================
CREATE OR REPLACE FUNCTION public.report_client_debts(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  client_id uuid,
  full_name text,
  id_number text,
  phone_number text,
  file_number text,
  total_owed numeric,
  total_paid numeric,
  total_rows bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_rows bigint;
BEGIN
  -- First get total count
  SELECT COUNT(*) INTO v_total_rows
  FROM (
    SELECT c.id
    FROM clients c
    WHERE c.deleted_at IS NULL
      AND c.broker_id IS NULL
      AND public.is_active_user(auth.uid())
      AND public.can_access_branch(auth.uid(), c.branch_id)
      AND (
        p_search IS NULL 
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.id_number ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%'
      )
      AND (
        -- Package debt
        COALESCE(
          (
            SELECT SUM(GREATEST(0, grp.group_price - grp.group_paid))
            FROM (
              SELECT 
                p.group_id,
                SUM(COALESCE(p.insurance_price, 0)) AS group_price,
                SUM(COALESCE(pay.paid, 0)) AS group_paid
              FROM policies p
              LEFT JOIN (
                SELECT policy_id, SUM(amount) AS paid
                FROM payments
                GROUP BY policy_id
              ) pay ON pay.policy_id = p.id
              WHERE p.client_id = c.id
                AND p.group_id IS NOT NULL
                AND p.status != 'cancelled'
                AND p.policy_type_parent != 'ELZAMI'
            GROUP BY p.group_id
            ) grp
          ), 0
        ) +
        -- Standalone debt
        COALESCE(
          (
            SELECT SUM(GREATEST(0, COALESCE(p.insurance_price, 0) - COALESCE(pay.paid, 0)))
            FROM policies p
            LEFT JOIN (
              SELECT policy_id, SUM(amount) AS paid
              FROM payments
              GROUP BY policy_id
            ) pay ON pay.policy_id = p.id
            WHERE p.client_id = c.id
              AND p.group_id IS NULL
              AND p.status != 'cancelled'
              AND p.policy_type_parent != 'ELZAMI'
          ), 0
        )
      ) > 0
  ) sub;

  RETURN QUERY
  SELECT 
    c.id AS client_id,
    c.full_name,
    c.id_number,
    c.phone_number,
    c.file_number,
    (
      -- Package debt
      COALESCE(
        (
          SELECT SUM(GREATEST(0, grp.group_price - grp.group_paid))
          FROM (
            SELECT 
              p.group_id,
              SUM(COALESCE(p.insurance_price, 0)) AS group_price,
              SUM(COALESCE(pay.paid, 0)) AS group_paid
            FROM policies p
            LEFT JOIN (
              SELECT policy_id, SUM(amount) AS paid
              FROM payments
              GROUP BY policy_id
            ) pay ON pay.policy_id = p.id
            WHERE p.client_id = c.id
              AND p.group_id IS NOT NULL
              AND p.status != 'cancelled'
              AND p.policy_type_parent != 'ELZAMI'
            GROUP BY p.group_id
          ) grp
        ), 0
      ) +
      -- Standalone debt
      COALESCE(
        (
          SELECT SUM(GREATEST(0, COALESCE(p.insurance_price, 0) - COALESCE(pay.paid, 0)))
          FROM policies p
          LEFT JOIN (
            SELECT policy_id, SUM(amount) AS paid
            FROM payments
            GROUP BY policy_id
          ) pay ON pay.policy_id = p.id
          WHERE p.client_id = c.id
            AND p.group_id IS NULL
            AND p.status != 'cancelled'
            AND p.policy_type_parent != 'ELZAMI'
        ), 0
      )
    )::numeric AS total_owed,
    COALESCE(
      (
        SELECT SUM(COALESCE(pay.paid, 0))
        FROM policies p
        LEFT JOIN (
          SELECT policy_id, SUM(amount) AS paid
          FROM payments
          GROUP BY policy_id
        ) pay ON pay.policy_id = p.id
        WHERE p.client_id = c.id
          AND p.status != 'cancelled'
      ), 0
    )::numeric AS total_paid,
    v_total_rows AS total_rows
  FROM clients c
  WHERE c.deleted_at IS NULL
    AND c.broker_id IS NULL
    AND public.is_active_user(auth.uid())
    AND public.can_access_branch(auth.uid(), c.branch_id)
    AND (
      p_search IS NULL 
      OR c.full_name ILIKE '%' || p_search || '%'
      OR c.id_number ILIKE '%' || p_search || '%'
      OR c.phone_number ILIKE '%' || p_search || '%'
      OR c.file_number ILIKE '%' || p_search || '%'
    )
    AND (
      -- Package debt
      COALESCE(
        (
          SELECT SUM(GREATEST(0, grp.group_price - grp.group_paid))
          FROM (
            SELECT 
              p.group_id,
              SUM(COALESCE(p.insurance_price, 0)) AS group_price,
              SUM(COALESCE(pay.paid, 0)) AS group_paid
            FROM policies p
            LEFT JOIN (
              SELECT policy_id, SUM(amount) AS paid
              FROM payments
              GROUP BY policy_id
            ) pay ON pay.policy_id = p.id
            WHERE p.client_id = c.id
              AND p.group_id IS NOT NULL
              AND p.status != 'cancelled'
              AND p.policy_type_parent != 'ELZAMI'
            GROUP BY p.group_id
          ) grp
        ), 0
      ) +
      -- Standalone debt
      COALESCE(
        (
          SELECT SUM(GREATEST(0, COALESCE(p.insurance_price, 0) - COALESCE(pay.paid, 0)))
          FROM policies p
          LEFT JOIN (
            SELECT policy_id, SUM(amount) AS paid
            FROM payments
            GROUP BY policy_id
          ) pay ON pay.policy_id = p.id
          WHERE p.client_id = c.id
            AND p.group_id IS NULL
            AND p.status != 'cancelled'
            AND p.policy_type_parent != 'ELZAMI'
        ), 0
      )
    ) > 0
  ORDER BY c.full_name
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ============================================================
-- 3. report_debt_policies_for_clients - Returns policy details
-- ============================================================
CREATE OR REPLACE FUNCTION public.report_debt_policies_for_clients(
  p_client_ids uuid[]
)
RETURNS TABLE (
  policy_id uuid,
  client_id uuid,
  car_id uuid,
  car_number text,
  policy_type_parent text,
  policy_type_child text,
  company_name text,
  start_date date,
  end_date date,
  insurance_price numeric,
  total_paid numeric,
  remaining numeric,
  group_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH policy_payments AS (
    SELECT 
      p.id AS pid,
      p.client_id AS pclient,
      p.car_id AS pcar,
      COALESCE(car.car_number, '') AS pcar_number,
      p.policy_type_parent::text AS ptype_parent,
      p.policy_type_child::text AS ptype_child,
      COALESCE(ic.name, '') AS pcompany,
      p.start_date AS pstart,
      p.end_date AS pend,
      COALESCE(p.insurance_price, 0) AS pprice,
      COALESCE(pay.paid, 0) AS ppaid,
      p.group_id AS pgroup
    FROM policies p
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN (
      SELECT policy_id, SUM(amount) AS paid
      FROM payments
      GROUP BY policy_id
    ) pay ON pay.policy_id = p.id
    WHERE p.client_id = ANY(p_client_ids)
      AND p.status != 'cancelled'
      AND p.policy_type_parent != 'ELZAMI'
  ),
  -- Calculate package-level totals
  package_totals AS (
    SELECT 
      pp.pgroup,
      pp.pclient,
      SUM(pp.pprice) AS pkg_price,
      SUM(pp.ppaid) AS pkg_paid
    FROM policy_payments pp
    WHERE pp.pgroup IS NOT NULL
    GROUP BY pp.pgroup, pp.pclient
  ),
  -- Calculate distributed remaining for each policy in a package
  policy_data AS (
    SELECT 
      pp.*,
      CASE 
        WHEN pp.pgroup IS NOT NULL THEN
          -- Distribute remaining proportionally within package
          CASE 
            WHEN pt.pkg_price > 0 THEN
              GREATEST(0, pt.pkg_price - pt.pkg_paid) * (pp.pprice / pt.pkg_price)
            ELSE 0
          END
        ELSE
          -- Standalone policy
          GREATEST(0, pp.pprice - pp.ppaid)
      END AS premaining,
      CASE 
        WHEN pp.pgroup IS NOT NULL THEN GREATEST(0, pt.pkg_price - pt.pkg_paid) > 0
        ELSE GREATEST(0, pp.pprice - pp.ppaid) > 0
      END AS has_debt
    FROM policy_payments pp
    LEFT JOIN package_totals pt ON pt.pgroup = pp.pgroup AND pt.pclient = pp.pclient
  )
  SELECT 
    pd.pid AS policy_id,
    pd.pclient AS client_id,
    pd.pcar AS car_id,
    pd.pcar_number AS car_number,
    pd.ptype_parent AS policy_type_parent,
    pd.ptype_child AS policy_type_child,
    pd.pcompany AS company_name,
    pd.pstart AS start_date,
    pd.pend AS end_date,
    pd.pprice AS insurance_price,
    pd.ppaid AS total_paid,
    pd.premaining AS remaining,
    pd.pgroup AS group_id
  FROM policy_data pd
  WHERE pd.has_debt = true
  ORDER BY pd.pclient, pd.pgroup NULLS LAST, pd.pstart DESC;
END;
$$;