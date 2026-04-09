-- Fix: Exclude already-renewed policies from renewals report
-- A policy is considered "renewed" if a newer active policy exists for the same client+car+policy_type

-- 1. Update report_renewals to exclude renewed policies
CREATE OR REPLACE FUNCTION public.report_renewals(
  p_end_month DATE,
  p_policy_type TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  client_id UUID,
  client_name TEXT,
  client_file_number TEXT,
  client_phone TEXT,
  policy_count BIGINT,
  earliest_end_date DATE,
  min_days_remaining INTEGER,
  total_insurance_price NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS client_id,
    c.full_name AS client_name,
    c.file_number AS client_file_number,
    c.phone_number AS client_phone,
    COUNT(p.id) AS policy_count,
    MIN(p.end_date) AS earliest_end_date,
    MIN(p.end_date::date - CURRENT_DATE)::INTEGER AS min_days_remaining,
    SUM(COALESCE(p.insurance_price, 0)) AS total_insurance_price
  FROM policies p
  INNER JOIN clients c ON c.id = p.client_id
  WHERE p.cancelled = false
    AND p.transferred = false
    AND p.end_date IS NOT NULL
    AND p.end_date >= CURRENT_DATE
    AND p.end_date < (p_end_month + INTERVAL '1 month')::DATE
    -- Exclude ROAD_SERVICE and ACCIDENT_FEE_EXEMPTION
    AND p.policy_type_parent::text NOT IN ('ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION')
    -- NEW: Exclude policies that have been renewed (newer active policy exists)
    AND NOT EXISTS (
      SELECT 1 FROM policies newer
      WHERE newer.client_id = p.client_id
        AND newer.car_id = p.car_id
        AND newer.policy_type_parent = p.policy_type_parent
        AND newer.cancelled = false
        AND newer.transferred = false
        AND newer.start_date > p.start_date
        AND newer.end_date > CURRENT_DATE
    )
    AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
    AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
    AND (
      p_search IS NULL 
      OR c.full_name ILIKE '%' || p_search || '%'
      OR c.file_number ILIKE '%' || p_search || '%'
      OR c.phone_number ILIKE '%' || p_search || '%'
    )
  GROUP BY c.id, c.full_name, c.file_number, c.phone_number
  HAVING COUNT(p.id) > 0
  ORDER BY MIN(p.end_date) ASC;
END;
$$;

-- 2. Update report_renewals_summary to match
CREATE OR REPLACE FUNCTION public.report_renewals_summary(
  p_end_month DATE,
  p_policy_type TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_expiring BIGINT,
  urgent_count BIGINT,
  warning_count BIGINT,
  normal_count BIGINT,
  total_price NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH filtered_policies AS (
    SELECT 
      p.id,
      p.client_id,
      p.end_date,
      p.insurance_price,
      (p.end_date::date - CURRENT_DATE) AS days_remaining
    FROM policies p
    INNER JOIN clients c ON c.id = p.client_id
    WHERE p.cancelled = false
      AND p.transferred = false
      AND p.end_date IS NOT NULL
      AND p.end_date >= CURRENT_DATE
      AND p.end_date < (p_end_month + INTERVAL '1 month')::DATE
      AND p.policy_type_parent::text NOT IN ('ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION')
      -- NEW: Exclude policies that have been renewed
      AND NOT EXISTS (
        SELECT 1 FROM policies newer
        WHERE newer.client_id = p.client_id
          AND newer.car_id = p.car_id
          AND newer.policy_type_parent = p.policy_type_parent
          AND newer.cancelled = false
          AND newer.transferred = false
          AND newer.start_date > p.start_date
          AND newer.end_date > CURRENT_DATE
      )
      AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (
        p_search IS NULL 
        OR c.full_name ILIKE '%' || p_search || '%'
        OR c.file_number ILIKE '%' || p_search || '%'
        OR c.phone_number ILIKE '%' || p_search || '%'
      )
  ),
  client_stats AS (
    SELECT 
      client_id,
      MIN(days_remaining) AS min_days,
      SUM(COALESCE(insurance_price, 0)) AS client_total
    FROM filtered_policies
    GROUP BY client_id
  )
  SELECT 
    COUNT(DISTINCT client_id)::BIGINT AS total_expiring,
    COUNT(DISTINCT CASE WHEN min_days <= 7 THEN client_id END)::BIGINT AS urgent_count,
    COUNT(DISTINCT CASE WHEN min_days > 7 AND min_days <= 14 THEN client_id END)::BIGINT AS warning_count,
    COUNT(DISTINCT CASE WHEN min_days > 14 THEN client_id END)::BIGINT AS normal_count,
    COALESCE(SUM(client_total), 0)::NUMERIC AS total_price
  FROM client_stats;
END;
$$;

-- 3. Update get_client_renewal_policies to exclude renewed policies
CREATE OR REPLACE FUNCTION public.get_client_renewal_policies(
  p_client_id UUID,
  p_end_month DATE
)
RETURNS TABLE (
  policy_id UUID,
  car_number TEXT,
  policy_type_parent TEXT,
  company_name_ar TEXT,
  end_date DATE,
  days_remaining INTEGER,
  insurance_price NUMERIC,
  renewal_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS policy_id,
    car.car_number,
    p.policy_type_parent::text,
    ic.name_ar AS company_name_ar,
    p.end_date,
    (p.end_date::date - CURRENT_DATE)::INTEGER AS days_remaining,
    COALESCE(p.insurance_price, 0) AS insurance_price,
    COALESCE(prt.status, 'not_contacted') AS renewal_status
  FROM policies p
  LEFT JOIN cars car ON car.id = p.car_id
  LEFT JOIN insurance_companies ic ON ic.id = p.company_id
  LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
  WHERE p.client_id = p_client_id
    AND p.cancelled = false
    AND p.transferred = false
    AND p.end_date IS NOT NULL
    AND p.end_date >= CURRENT_DATE
    AND p.end_date < (p_end_month + INTERVAL '1 month')::DATE
    AND p.policy_type_parent::text NOT IN ('ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION')
    -- NEW: Exclude policies that have been renewed
    AND NOT EXISTS (
      SELECT 1 FROM policies newer
      WHERE newer.client_id = p.client_id
        AND newer.car_id = p.car_id
        AND newer.policy_type_parent = p.policy_type_parent
        AND newer.cancelled = false
        AND newer.transferred = false
        AND newer.start_date > p.start_date
        AND newer.end_date > CURRENT_DATE
    )
  ORDER BY p.end_date ASC;
END;
$$;

-- 4. Also update report_renewals_service_detailed for PDF export
CREATE OR REPLACE FUNCTION public.report_renewals_service_detailed(
  p_end_month DATE,
  p_days_remaining INTEGER DEFAULT NULL,
  p_policy_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  policy_id UUID,
  client_id UUID,
  client_name TEXT,
  client_file_number TEXT,
  client_phone TEXT,
  car_number TEXT,
  policy_type_parent TEXT,
  company_name_ar TEXT,
  end_date DATE,
  days_remaining INTEGER,
  insurance_price NUMERIC,
  renewal_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS policy_id,
    c.id AS client_id,
    c.full_name AS client_name,
    c.file_number AS client_file_number,
    c.phone_number AS client_phone,
    car.car_number,
    p.policy_type_parent::text,
    ic.name_ar AS company_name_ar,
    p.end_date,
    (p.end_date::date - CURRENT_DATE)::INTEGER AS days_remaining,
    COALESCE(p.insurance_price, 0) AS insurance_price,
    COALESCE(prt.status, 'not_contacted') AS renewal_status
  FROM policies p
  INNER JOIN clients c ON c.id = p.client_id
  LEFT JOIN cars car ON car.id = p.car_id
  LEFT JOIN insurance_companies ic ON ic.id = p.company_id
  LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
  WHERE p.cancelled = false
    AND p.transferred = false
    AND p.end_date IS NOT NULL
    AND p.end_date >= CURRENT_DATE
    AND p.end_date < (p_end_month + INTERVAL '1 month')::DATE
    AND p.policy_type_parent::text NOT IN ('ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION')
    -- NEW: Exclude policies that have been renewed
    AND NOT EXISTS (
      SELECT 1 FROM policies newer
      WHERE newer.client_id = p.client_id
        AND newer.car_id = p.car_id
        AND newer.policy_type_parent = p.policy_type_parent
        AND newer.cancelled = false
        AND newer.transferred = false
        AND newer.start_date > p.start_date
        AND newer.end_date > CURRENT_DATE
    )
    AND (p_days_remaining IS NULL OR (p.end_date::date - CURRENT_DATE) <= p_days_remaining)
    AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
  ORDER BY p.end_date ASC, c.full_name ASC;
END;
$$;