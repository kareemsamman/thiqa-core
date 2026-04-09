
-- Fix debt calculation for packages: use LEAST(non_elzami_price, full_price - paid)
-- This ensures that when payments exceed non-elzami price, the debt is correctly calculated

-- Drop and recreate all overloaded versions of report_client_debts
DROP FUNCTION IF EXISTS report_client_debts(text, integer, integer, integer);
DROP FUNCTION IF EXISTS report_client_debts(uuid, integer, integer, integer);

-- Version 1: With search parameter
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
  policies_count integer,
  total_rows bigint
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
  -- 1. السعر الكلي للباقة (مع الإلزامي)
  group_full_prices AS (
    SELECT
      p.group_id,
      SUM(p.insurance_price) AS full_price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- 2. سعر غير الإلزامي (دين الوكالة)
  group_non_elzami_prices AS (
    SELECT
      p.group_id,
      SUM(p.insurance_price) AS non_elzami_price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- 3. جميع الدفعات للباقة
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
  -- 4. حساب الدين الصحيح للباقات
  group_debts AS (
    SELECT
      gnp.group_id,
      gnp.non_elzami_price AS price,
      COALESCE(gpa.paid, 0) AS paid,
      -- المتبقي للوكالة = min(سعر_غير_الإلزامي, السعر_الكلي - المدفوع)
      GREATEST(0, LEAST(
        gnp.non_elzami_price,
        gfp.full_price - COALESCE(gpa.paid, 0)
      )) AS remaining
    FROM group_non_elzami_prices gnp
    JOIN group_full_prices gfp ON gfp.group_id = gnp.group_id
    LEFT JOIN group_payments gpa ON gpa.group_id = gnp.group_id
    WHERE GREATEST(0, LEAST(gnp.non_elzami_price, gfp.full_price - COALESCE(gpa.paid, 0))) > 0
  ),
  -- 5. الوثائق الفردية (غير إلزامي، بدون مجموعة)
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
  -- 6. جمع كل الديون على مستوى العميل
  client_debts AS (
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
    
    SELECT
      sd.client_id,
      sd.price,
      sd.paid,
      sd.remaining
    FROM standalone_debts sd
  ),
  -- 7. تجميع على مستوى العميل
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
  -- 8. أقدم تاريخ انتهاء وعدد السيارات
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
  ),
  -- 9. Apply filter and calculate total
  filtered_clients AS (
    SELECT
      ct.client_id,
      ct.client_name,
      ct.client_phone,
      ct.total_owed,
      ct.total_paid,
      ct.total_remaining,
      cm.oldest_end_date::DATE,
      (cm.oldest_end_date - CURRENT_DATE)::INT AS days_until_oldest,
      COALESCE(cm.cars_count, 0)::INT AS cars_count,
      COALESCE(cm.policies_count, 0)::INT AS policies_count
    FROM client_totals ct
    LEFT JOIN client_meta cm ON cm.client_id = ct.client_id
    WHERE (
      p_filter_days IS NULL
      OR cm.oldest_end_date IS NULL
      OR (cm.oldest_end_date - CURRENT_DATE) <= p_filter_days
    )
  )
  SELECT
    fc.client_id,
    fc.client_name,
    fc.client_phone,
    fc.total_owed,
    fc.total_paid,
    fc.total_remaining,
    fc.oldest_end_date,
    fc.days_until_oldest,
    fc.cars_count,
    fc.policies_count,
    COUNT(*) OVER() AS total_rows
  FROM filtered_clients fc
  ORDER BY fc.total_remaining DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Version 2: With branch_id parameter
CREATE OR REPLACE FUNCTION report_client_debts(
  p_branch_id uuid DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_filter_days integer DEFAULT NULL
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
BEGIN
  RETURN QUERY
  WITH
  -- 1. السعر الكلي للباقة (مع الإلزامي)
  group_full_prices AS (
    SELECT
      p.group_id,
      SUM(p.insurance_price) AS full_price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- 2. سعر غير الإلزامي (دين الوكالة)
  group_non_elzami_prices AS (
    SELECT
      p.group_id,
      SUM(p.insurance_price) AS non_elzami_price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- 3. جميع الدفعات للباقة
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
  -- 4. حساب الدين الصحيح للباقات
  group_debts AS (
    SELECT
      gnp.group_id,
      gnp.non_elzami_price AS price,
      COALESCE(gpa.paid, 0) AS paid,
      GREATEST(0, LEAST(
        gnp.non_elzami_price,
        gfp.full_price - COALESCE(gpa.paid, 0)
      )) AS remaining
    FROM group_non_elzami_prices gnp
    JOIN group_full_prices gfp ON gfp.group_id = gnp.group_id
    LEFT JOIN group_payments gpa ON gpa.group_id = gnp.group_id
    WHERE GREATEST(0, LEAST(gnp.non_elzami_price, gfp.full_price - COALESCE(gpa.paid, 0))) > 0
  ),
  -- 5. الوثائق الفردية
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
  -- 6. جمع الديون
  client_debts AS (
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
    
    SELECT
      sd.client_id,
      sd.price,
      sd.paid,
      sd.remaining
    FROM standalone_debts sd
  ),
  -- 7. تجميع على مستوى العميل
  client_totals AS (
    SELECT
      c.id AS client_id,
      c.full_name AS client_name,
      c.phone_number AS client_phone,
      c.branch_id,
      COALESCE(SUM(cd.price), 0) AS total_owed,
      COALESCE(SUM(cd.paid), 0) AS total_paid,
      COALESCE(SUM(cd.remaining), 0) AS total_remaining
    FROM clients c
    JOIN client_debts cd ON cd.client_id = c.id
    WHERE c.deleted_at IS NULL
    GROUP BY c.id
    HAVING COALESCE(SUM(cd.remaining), 0) > 0
  ),
  -- 8. أقدم تاريخ انتهاء
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
  WHERE (p_branch_id IS NULL OR ct.branch_id = p_branch_id)
    AND (
      p_filter_days IS NULL
      OR cm.oldest_end_date IS NULL
      OR (cm.oldest_end_date - CURRENT_DATE) <= p_filter_days
    )
  ORDER BY ct.total_remaining DESC
  LIMIT p_page_size
  OFFSET (p_page - 1) * p_page_size;
END;
$function$;

-- Drop and recreate summary functions
DROP FUNCTION IF EXISTS report_client_debts_summary(text, integer);
DROP FUNCTION IF EXISTS report_client_debts_summary(uuid, integer);

-- Summary version 1: With search parameter
CREATE OR REPLACE FUNCTION report_client_debts_summary(
  p_search text DEFAULT NULL,
  p_filter_days integer DEFAULT NULL
)
RETURNS TABLE(total_clients integer, total_owed numeric, total_remaining numeric)
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
  -- السعر الكلي للباقة
  group_full_prices AS (
    SELECT
      p.group_id,
      SUM(p.insurance_price) AS full_price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- سعر غير الإلزامي
  group_non_elzami_prices AS (
    SELECT
      p.group_id,
      SUM(p.insurance_price) AS non_elzami_price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- المدفوعات
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
  -- الديون
  group_debts AS (
    SELECT
      gnp.group_id,
      gnp.non_elzami_price AS price,
      GREATEST(0, LEAST(
        gnp.non_elzami_price,
        gfp.full_price - COALESCE(gpa.paid, 0)
      )) AS remaining
    FROM group_non_elzami_prices gnp
    JOIN group_full_prices gfp ON gfp.group_id = gnp.group_id
    LEFT JOIN group_payments gpa ON gpa.group_id = gnp.group_id
    WHERE GREATEST(0, LEAST(gnp.non_elzami_price, gfp.full_price - COALESCE(gpa.paid, 0))) > 0
  ),
  -- الوثائق الفردية
  standalone_debts AS (
    SELECT
      p.id AS policy_id,
      p.client_id,
      p.insurance_price AS price,
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
  -- جمع الديون
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
  -- تجميع العملاء
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

-- Summary version 2: With branch_id parameter
CREATE OR REPLACE FUNCTION report_client_debts_summary(
  p_branch_id uuid DEFAULT NULL,
  p_filter_days integer DEFAULT NULL
)
RETURNS TABLE(total_clients integer, total_owed numeric, total_remaining numeric)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH
  -- السعر الكلي للباقة
  group_full_prices AS (
    SELECT
      p.group_id,
      SUM(p.insurance_price) AS full_price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- سعر غير الإلزامي
  group_non_elzami_prices AS (
    SELECT
      p.group_id,
      SUM(p.insurance_price) AS non_elzami_price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- المدفوعات
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
  -- الديون
  group_debts AS (
    SELECT
      gnp.group_id,
      gnp.non_elzami_price AS price,
      GREATEST(0, LEAST(
        gnp.non_elzami_price,
        gfp.full_price - COALESCE(gpa.paid, 0)
      )) AS remaining
    FROM group_non_elzami_prices gnp
    JOIN group_full_prices gfp ON gfp.group_id = gnp.group_id
    LEFT JOIN group_payments gpa ON gpa.group_id = gnp.group_id
    WHERE GREATEST(0, LEAST(gnp.non_elzami_price, gfp.full_price - COALESCE(gpa.paid, 0))) > 0
  ),
  -- الوثائق الفردية
  standalone_debts AS (
    SELECT
      p.id AS policy_id,
      p.client_id,
      p.insurance_price AS price,
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
  -- جمع الديون
  client_debts AS (
    SELECT
      p.client_id,
      c.branch_id,
      gd.price,
      gd.remaining
    FROM group_debts gd
    JOIN policies p ON p.group_id = gd.group_id
    JOIN clients c ON c.id = p.client_id
    WHERE p.policy_type_parent <> 'ELZAMI'
    GROUP BY p.client_id, c.branch_id, gd.group_id, gd.price, gd.remaining
    
    UNION ALL
    
    SELECT
      sd.client_id,
      c.branch_id,
      sd.price,
      sd.remaining
    FROM standalone_debts sd
    JOIN clients c ON c.id = sd.client_id
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
  -- تجميع العملاء
  client_totals AS (
    SELECT
      cd.client_id,
      cd.branch_id,
      SUM(cd.price) AS total_owed,
      SUM(cd.remaining) AS total_remaining
    FROM client_debts cd
    GROUP BY cd.client_id, cd.branch_id
    HAVING SUM(cd.remaining) > 0
  )
  SELECT
    COUNT(DISTINCT ct.client_id)::INT,
    COALESCE(SUM(ct.total_owed), 0),
    COALESCE(SUM(ct.total_remaining), 0)
  FROM client_totals ct
  LEFT JOIN client_meta cm ON cm.client_id = ct.client_id
  WHERE (p_branch_id IS NULL OR ct.branch_id = p_branch_id)
    AND (
      p_filter_days IS NULL
      OR cm.oldest_end_date IS NULL
      OR (cm.oldest_end_date - CURRENT_DATE) <= p_filter_days
    );
END;
$function$;

-- Update report_debt_policies_for_clients to also use correct calculation
CREATE OR REPLACE FUNCTION report_debt_policies_for_clients(p_client_ids uuid[])
RETURNS TABLE(
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
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  -- السعر الكلي للباقة
  group_full_prices AS (
    SELECT
      p.group_id,
      SUM(COALESCE(p.insurance_price, 0)) AS full_price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.client_id = ANY(p_client_ids)
      AND p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- سعر غير الإلزامي
  group_non_elzami_prices AS (
    SELECT
      p.group_id,
      SUM(COALESCE(p.insurance_price, 0)) AS non_elzami_price
    FROM policies p
    WHERE p.group_id IS NOT NULL
      AND p.policy_type_parent <> 'ELZAMI'
      AND p.client_id = ANY(p_client_ids)
      AND p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  -- المدفوعات
  group_payments AS (
    SELECT
      p.group_id,
      COALESCE(SUM(ppa.total_paid), 0) AS group_paid
    FROM policies p
    LEFT JOIN policy_payments_agg ppa ON ppa.policy_id = p.id
    WHERE p.group_id IS NOT NULL
      AND p.client_id = ANY(p_client_ids)
      AND p.cancelled = false
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
    GROUP BY p.group_id
  ),
  group_totals AS (
    SELECT
      gfp.group_id,
      gfp.full_price,
      COALESCE(gnp.non_elzami_price, 0) AS non_elzami_price,
      COALESCE(gpa.group_paid, 0) AS group_paid,
      -- المتبقي الصحيح = min(non_elzami, full - paid)
      GREATEST(0, LEAST(
        COALESCE(gnp.non_elzami_price, 0),
        gfp.full_price - COALESCE(gpa.group_paid, 0)
      )) AS group_remaining
    FROM group_full_prices gfp
    LEFT JOIN group_non_elzami_prices gnp ON gnp.group_id = gfp.group_id
    LEFT JOIN group_payments gpa ON gpa.group_id = gfp.group_id
  )
  -- Packages: distribute remaining proportionally among non-ELZAMI policies
  SELECT
    p.client_id,
    p.id AS policy_id,
    p.policy_number,
    p.insurance_price,
    -- Proportional paid
    CASE 
      WHEN gt.non_elzami_price > 0 AND p.policy_type_parent <> 'ELZAMI' THEN 
        ROUND((COALESCE(p.insurance_price, 0) / gt.non_elzami_price) * (gt.non_elzami_price - gt.group_remaining), 2)
      WHEN p.policy_type_parent = 'ELZAMI' THEN COALESCE(p.insurance_price, 0)
      ELSE 0
    END AS paid,
    -- Proportional remaining (only for non-ELZAMI)
    CASE 
      WHEN gt.non_elzami_price > 0 AND p.policy_type_parent <> 'ELZAMI' THEN 
        ROUND((COALESCE(p.insurance_price, 0) / gt.non_elzami_price) * gt.group_remaining, 2)
      ELSE 0
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
    AND p.policy_type_parent <> 'ELZAMI'
    AND p.cancelled = false
    AND p.deleted_at IS NULL
    AND p.broker_id IS NULL
    AND COALESCE(p.insurance_price, 0) - COALESCE(ppa.total_paid, 0) > 0
  ORDER BY remaining DESC;
END;
$function$;
