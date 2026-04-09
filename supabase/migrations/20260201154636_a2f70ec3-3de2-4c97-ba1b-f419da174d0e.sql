-- Drop old function signatures that the frontend uses
DROP FUNCTION IF EXISTS report_client_debts(text, integer, integer, integer);
DROP FUNCTION IF EXISTS report_client_debts_summary(text, integer);

-- Create fixed report_client_debts with correct signature for frontend
CREATE OR REPLACE FUNCTION report_client_debts(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_phone text,
  total_owed numeric,
  total_paid numeric,
  total_remaining numeric,
  oldest_end_date date,
  days_until_oldest integer,
  cars_count integer,
  policies_count integer
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_search_pattern text;
BEGIN
  v_search_pattern := CASE WHEN p_search IS NOT NULL AND p_search != '' 
                           THEN '%' || lower(p_search) || '%' 
                           ELSE NULL END;

  RETURN QUERY
  WITH
  -- 1. حساب المدفوعات لكل باقة (كل الوثائق بما فيها الإلزامي)
  group_payments AS (
    SELECT
      p.group_id,
      COALESCE(SUM(pp.amount) FILTER (WHERE NOT COALESCE(pp.refused, FALSE)), 0) AS paid
    FROM policies p
    LEFT JOIN policy_payments pp ON pp.policy_id = p.id
    WHERE p.group_id IS NOT NULL
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- 2. حساب الأسعار لكل باقة (بدون الإلزامي)
  group_prices AS (
    SELECT
      p.group_id,
      SUM(p.insurance_price) AS price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- 3. دمج الأسعار والمدفوعات للباقات
  group_debts AS (
    SELECT
      gpr.group_id,
      gpr.price,
      COALESCE(gpa.paid, 0) AS paid,
      GREATEST(0, gpr.price - COALESCE(gpa.paid, 0)) AS remaining
    FROM group_prices gpr
    LEFT JOIN group_payments gpa ON gpa.group_id = gpr.group_id
    WHERE gpr.price - COALESCE(gpa.paid, 0) > 0
  ),
  -- 4. الوثائق الفردية (غير إلزامي، بدون مجموعة)
  standalone_debts AS (
    SELECT
      p.id AS policy_id,
      p.client_id,
      p.insurance_price AS price,
      COALESCE(SUM(pp.amount) FILTER (WHERE NOT COALESCE(pp.refused, FALSE)), 0) AS paid,
      p.insurance_price - COALESCE(SUM(pp.amount) FILTER (WHERE NOT COALESCE(pp.refused, FALSE)), 0) AS remaining
    FROM policies p
    LEFT JOIN policy_payments pp ON pp.policy_id = p.id
    WHERE p.group_id IS NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.id
    HAVING p.insurance_price - COALESCE(SUM(pp.amount) FILTER (WHERE NOT COALESCE(pp.refused, FALSE)), 0) > 0
  ),
  -- 5. جمع كل الديون على مستوى العميل
  client_debts AS (
    -- ديون الباقات
    SELECT
      p.client_id,
      gd.price,
      gd.paid,
      gd.remaining
    FROM group_debts gd
    JOIN policies p ON p.group_id = gd.group_id
    WHERE p.policy_type_parent <> 'ELZAMI'
    GROUP BY p.client_id, gd.group_id, gd.price, gd.paid, gd.remaining
    
    UNION ALL
    
    -- ديون الوثائق الفردية
    SELECT
      sd.client_id,
      sd.price,
      sd.paid,
      sd.remaining
    FROM standalone_debts sd
  ),
  -- 6. تجميع على مستوى العميل
  client_totals AS (
    SELECT
      c.id AS client_id,
      c.full_name AS client_name,
      c.phone_number AS client_phone,
      COALESCE(SUM(cd.price), 0) AS total_owed,
      COALESCE(SUM(cd.paid), 0) AS total_paid,
      COALESCE(SUM(cd.remaining), 0) AS total_remaining
    FROM clients c
    JOIN client_debts cd ON cd.client_id = c.id
    WHERE c.deleted_at IS NULL
      AND (v_search_pattern IS NULL OR (
        lower(c.full_name) LIKE v_search_pattern 
        OR c.phone_number LIKE v_search_pattern 
        OR c.id_number LIKE v_search_pattern
        OR c.file_number LIKE v_search_pattern
      ))
    GROUP BY c.id
    HAVING COALESCE(SUM(cd.remaining), 0) > 0
  ),
  -- 7. أقدم تاريخ انتهاء وعدد السيارات
  client_meta AS (
    SELECT
      p.client_id,
      MIN(p.end_date) AS oldest_end_date,
      COUNT(DISTINCT p.car_id) AS cars_count,
      COUNT(DISTINCT p.id) AS policies_count
    FROM policies p
    WHERE p.policy_type_parent <> 'ELZAMI'
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.client_id
  )
  SELECT
    ct.client_id,
    ct.client_name,
    ct.client_phone,
    ct.total_owed,
    ct.total_paid,
    ct.total_remaining,
    cm.oldest_end_date::DATE,
    (cm.oldest_end_date - CURRENT_DATE)::INT AS days_until_oldest,
    COALESCE(cm.cars_count, 0)::INT,
    COALESCE(cm.policies_count, 0)::INT
  FROM client_totals ct
  LEFT JOIN client_meta cm ON cm.client_id = ct.client_id
  WHERE (
    p_filter_days IS NULL
    OR cm.oldest_end_date IS NULL
    OR (cm.oldest_end_date - CURRENT_DATE) <= p_filter_days
  )
  ORDER BY ct.total_remaining DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Create fixed report_client_debts_summary with correct signature for frontend
CREATE OR REPLACE FUNCTION report_client_debts_summary(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL
)
RETURNS TABLE(
  total_clients integer,
  total_owed numeric,
  total_remaining numeric
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_search_pattern text;
BEGIN
  v_search_pattern := CASE WHEN p_search IS NOT NULL AND p_search != '' 
                           THEN '%' || lower(p_search) || '%' 
                           ELSE NULL END;

  RETURN QUERY
  WITH
  -- حساب المدفوعات لكل باقة (كل الوثائق بما فيها الإلزامي)
  group_payments AS (
    SELECT
      p.group_id,
      COALESCE(SUM(pp.amount) FILTER (WHERE NOT COALESCE(pp.refused, FALSE)), 0) AS paid
    FROM policies p
    LEFT JOIN policy_payments pp ON pp.policy_id = p.id
    WHERE p.group_id IS NOT NULL
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- حساب الأسعار لكل باقة (بدون الإلزامي)
  group_prices AS (
    SELECT
      p.group_id,
      SUM(p.insurance_price) AS price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- دمج الأسعار والمدفوعات للباقات
  group_debts AS (
    SELECT
      gpr.group_id,
      gpr.price,
      COALESCE(gpa.paid, 0) AS paid,
      GREATEST(0, gpr.price - COALESCE(gpa.paid, 0)) AS remaining
    FROM group_prices gpr
    LEFT JOIN group_payments gpa ON gpa.group_id = gpr.group_id
    WHERE gpr.price - COALESCE(gpa.paid, 0) > 0
  ),
  -- الوثائق الفردية
  standalone_debts AS (
    SELECT
      p.id AS policy_id,
      p.client_id,
      p.insurance_price AS price,
      COALESCE(SUM(pp.amount) FILTER (WHERE NOT COALESCE(pp.refused, FALSE)), 0) AS paid,
      p.insurance_price - COALESCE(SUM(pp.amount) FILTER (WHERE NOT COALESCE(pp.refused, FALSE)), 0) AS remaining
    FROM policies p
    LEFT JOIN policy_payments pp ON pp.policy_id = p.id
    WHERE p.group_id IS NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.id
    HAVING p.insurance_price - COALESCE(SUM(pp.amount) FILTER (WHERE NOT COALESCE(pp.refused, FALSE)), 0) > 0
  ),
  -- جمع الديون على مستوى العميل
  client_debts AS (
    SELECT
      p.client_id,
      gd.price,
      gd.remaining
    FROM group_debts gd
    JOIN policies p ON p.group_id = gd.group_id
    WHERE p.policy_type_parent <> 'ELZAMI'
    GROUP BY p.client_id, gd.group_id, gd.price, gd.remaining
    
    UNION ALL
    
    SELECT
      sd.client_id,
      sd.price,
      sd.remaining
    FROM standalone_debts sd
  ),
  -- أقدم تاريخ انتهاء
  client_meta AS (
    SELECT
      p.client_id,
      MIN(p.end_date) AS oldest_end_date
    FROM policies p
    WHERE p.policy_type_parent <> 'ELZAMI'
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.client_id
  ),
  -- تجميع على مستوى العميل
  client_totals AS (
    SELECT
      c.id AS client_id,
      SUM(cd.price) AS total_owed,
      SUM(cd.remaining) AS total_remaining
    FROM clients c
    JOIN client_debts cd ON cd.client_id = c.id
    WHERE c.deleted_at IS NULL
      AND (v_search_pattern IS NULL OR (
        lower(c.full_name) LIKE v_search_pattern 
        OR c.phone_number LIKE v_search_pattern 
        OR c.id_number LIKE v_search_pattern
        OR c.file_number LIKE v_search_pattern
      ))
    GROUP BY c.id
    HAVING SUM(cd.remaining) > 0
  )
  SELECT
    COUNT(DISTINCT ct.client_id)::INT,
    COALESCE(SUM(ct.total_owed), 0),
    COALESCE(SUM(ct.total_remaining), 0)
  FROM client_totals ct
  LEFT JOIN client_meta cm ON cm.client_id = ct.client_id
  WHERE (
    p_filter_days IS NULL
    OR cm.oldest_end_date IS NULL
    OR (cm.oldest_end_date - CURRENT_DATE) <= p_filter_days
  );
END;
$function$;