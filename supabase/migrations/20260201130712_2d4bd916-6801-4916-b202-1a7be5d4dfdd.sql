-- ============================================
-- Fix debt calculation to work at package (group_id) level
-- This ensures that payments distributed across package components
-- are correctly aggregated when calculating remaining debt
-- ============================================

-- Drop existing functions first
DROP FUNCTION IF EXISTS report_client_debts(uuid, text, text, integer, integer);
DROP FUNCTION IF EXISTS report_client_debts_summary();
DROP FUNCTION IF EXISTS report_debt_policies_for_clients(uuid[]);

-- ============================================
-- 1. report_client_debts - Main debt report function
-- ============================================
CREATE OR REPLACE FUNCTION report_client_debts(
  p_branch_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_sort_by text DEFAULT 'total_owed',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS TABLE (
  client_id uuid,
  client_name text,
  phone_number text,
  total_owed numeric,
  policies_count integer,
  earliest_expiry date
) AS $$
BEGIN
  RETURN QUERY
  WITH payment_sums AS (
    SELECT 
      pp.policy_id,
      COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0) AS paid_amount
    FROM policy_payments pp
    GROUP BY pp.policy_id
  ),
  -- Package-level debt: aggregate by group_id
  package_debt AS (
    SELECT
      p.client_id,
      p.group_id,
      SUM(p.insurance_price)::numeric AS total_price,
      COALESCE(SUM(ps.paid_amount), 0)::numeric AS total_paid,
      MIN(p.end_date::date) AS earliest_expiry
    FROM policies p
    LEFT JOIN payment_sums ps ON ps.policy_id = p.id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.broker_id IS NULL
      AND p.group_id IS NOT NULL
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    GROUP BY p.client_id, p.group_id
  ),
  -- Single policy debt: policies without group_id
  single_debt AS (
    SELECT
      p.client_id,
      p.id AS policy_id,
      p.insurance_price::numeric AS total_price,
      COALESCE(ps.paid_amount, 0)::numeric AS total_paid,
      p.end_date::date AS earliest_expiry
    FROM policies p
    LEFT JOIN payment_sums ps ON ps.policy_id = p.id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.broker_id IS NULL
      AND p.group_id IS NULL
      AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
  ),
  -- Combine both
  all_debt AS (
    SELECT pd.client_id, pd.total_price, pd.total_paid, pd.earliest_expiry
    FROM package_debt pd
    WHERE (pd.total_price - pd.total_paid) > 0
    UNION ALL
    SELECT sd.client_id, sd.total_price, sd.total_paid, sd.earliest_expiry
    FROM single_debt sd
    WHERE (sd.total_price - sd.total_paid) > 0
  ),
  -- Aggregate per client
  client_debt AS (
    SELECT
      c.id AS cid,
      c.full_name AS cname,
      c.phone_number AS cphone,
      SUM(d.total_price - d.total_paid)::numeric AS debt_owed,
      COUNT(*)::int AS debt_count,
      MIN(d.earliest_expiry) AS debt_expiry
    FROM all_debt d
    JOIN clients c ON c.id = d.client_id
    WHERE c.deleted_at IS NULL
      AND (p_search IS NULL OR 
           c.full_name ILIKE '%' || p_search || '%' OR 
           c.phone_number ILIKE '%' || p_search || '%' OR
           c.id_number ILIKE '%' || p_search || '%')
    GROUP BY c.id, c.full_name, c.phone_number
    HAVING SUM(d.total_price - d.total_paid) > 0
  )
  SELECT 
    cd.cid,
    cd.cname,
    cd.cphone,
    cd.debt_owed,
    cd.debt_count,
    cd.debt_expiry
  FROM client_debt cd
  ORDER BY
    CASE WHEN p_sort_by = 'total_owed' THEN cd.debt_owed END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'client_name' THEN cd.cname END ASC NULLS LAST,
    CASE WHEN p_sort_by = 'earliest_expiry' THEN cd.debt_expiry END ASC NULLS LAST,
    cd.debt_owed DESC
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- 2. report_client_debts_summary - Count of clients with debt
-- ============================================
CREATE OR REPLACE FUNCTION report_client_debts_summary()
RETURNS TABLE (total_clients bigint, total_debt numeric) AS $$
BEGIN
  RETURN QUERY
  WITH payment_sums AS (
    SELECT 
      pp.policy_id,
      COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0) AS paid_amount
    FROM policy_payments pp
    GROUP BY pp.policy_id
  ),
  package_debt AS (
    SELECT
      p.client_id,
      p.group_id,
      SUM(p.insurance_price)::numeric AS total_price,
      COALESCE(SUM(ps.paid_amount), 0)::numeric AS total_paid
    FROM policies p
    LEFT JOIN payment_sums ps ON ps.policy_id = p.id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.broker_id IS NULL
      AND p.group_id IS NOT NULL
    GROUP BY p.client_id, p.group_id
  ),
  single_debt AS (
    SELECT
      p.client_id,
      p.id AS policy_id,
      p.insurance_price::numeric AS total_price,
      COALESCE(ps.paid_amount, 0)::numeric AS total_paid
    FROM policies p
    LEFT JOIN payment_sums ps ON ps.policy_id = p.id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.broker_id IS NULL
      AND p.group_id IS NULL
  ),
  all_debt AS (
    SELECT pd.client_id, (pd.total_price - pd.total_paid) AS remaining
    FROM package_debt pd
    WHERE (pd.total_price - pd.total_paid) > 0
    UNION ALL
    SELECT sd.client_id, (sd.total_price - sd.total_paid) AS remaining
    FROM single_debt sd
    WHERE (sd.total_price - sd.total_paid) > 0
  ),
  client_totals AS (
    SELECT 
      d.client_id,
      SUM(d.remaining) AS client_debt
    FROM all_debt d
    JOIN clients c ON c.id = d.client_id
    WHERE c.deleted_at IS NULL
    GROUP BY d.client_id
    HAVING SUM(d.remaining) > 0
  )
  SELECT 
    COUNT(*)::bigint AS total_clients,
    COALESCE(SUM(ct.client_debt), 0)::numeric AS total_debt
  FROM client_totals ct;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- 3. report_debt_policies_for_clients - Get policies for specific clients
-- ============================================
CREATE OR REPLACE FUNCTION report_debt_policies_for_clients(p_client_ids uuid[])
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
) AS $$
BEGIN
  RETURN QUERY
  WITH payment_sums AS (
    SELECT 
      pp.policy_id,
      COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0) AS paid_amount
    FROM policy_payments pp
    GROUP BY pp.policy_id
  ),
  -- For packages: calculate remaining at group level
  package_totals AS (
    SELECT 
      p.group_id,
      SUM(p.insurance_price)::numeric AS group_price,
      COALESCE(SUM(ps.paid_amount), 0)::numeric AS group_paid
    FROM policies p
    LEFT JOIN payment_sums ps ON ps.policy_id = p.id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
      AND p.group_id IS NOT NULL
      AND p.client_id = ANY(p_client_ids)
    GROUP BY p.group_id
  ),
  policy_data AS (
    SELECT
      p.id AS pid,
      p.client_id AS pclient,
      p.car_id AS pcar,
      c.car_number AS pcar_number,
      p.policy_type_parent::text AS ptype_parent,
      p.policy_type_child AS ptype_child,
      COALESCE(ic.name_ar, ic.name) AS pcompany,
      p.start_date::date AS pstart,
      p.end_date::date AS pend,
      p.insurance_price::numeric AS pprice,
      COALESCE(ps.paid_amount, 0)::numeric AS ppaid,
      p.group_id AS pgroup,
      -- For packages, use group-level remaining; for singles, use policy-level
      CASE 
        WHEN p.group_id IS NOT NULL THEN 
          GREATEST(0, pt.group_price - pt.group_paid)
        ELSE 
          GREATEST(0, p.insurance_price - COALESCE(ps.paid_amount, 0))
      END AS premaining,
      -- Flag to identify if this is a package with debt
      CASE 
        WHEN p.group_id IS NOT NULL THEN 
          (pt.group_price - pt.group_paid) > 0
        ELSE 
          (p.insurance_price - COALESCE(ps.paid_amount, 0)) > 0
      END AS has_debt
    FROM policies p
    LEFT JOIN cars c ON c.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN payment_sums ps ON ps.policy_id = p.id
    LEFT JOIN package_totals pt ON pt.group_id = p.group_id
    WHERE p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.client_id = ANY(p_client_ids)
  )
  SELECT 
    pd.pid,
    pd.pclient,
    pd.pcar,
    pd.pcar_number,
    pd.ptype_parent,
    pd.ptype_child,
    pd.pcompany,
    pd.pstart,
    pd.pend,
    pd.pprice,
    pd.ppaid,
    pd.premaining,
    pd.pgroup
  FROM policy_data pd
  WHERE pd.has_debt = true
  ORDER BY pd.pclient, pd.pgroup NULLS LAST, pd.pstart DESC;
END;
$$ LANGUAGE plpgsql STABLE;