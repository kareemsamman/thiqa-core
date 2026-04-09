-- =====================================================
-- إصلاح حساب الديون للباقات التي تحتوي على إلزامي
-- المنطق: استثناء أسعار الإلزامي، لكن تضمين كل المدفوعات
-- =====================================================

-- إعادة تعريف دالة report_client_debts
DROP FUNCTION IF EXISTS report_client_debts(UUID, INT, INT, UUID);

CREATE OR REPLACE FUNCTION report_client_debts(
  p_branch_id UUID DEFAULT NULL,
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 50,
  p_filter_days INT DEFAULT NULL
)
RETURNS TABLE (
  client_id UUID,
  client_name TEXT,
  client_phone TEXT,
  total_owed NUMERIC,
  total_paid NUMERIC,
  total_remaining NUMERIC,
  oldest_end_date DATE,
  days_until_oldest INT,
  cars_count INT,
  policies_count INT
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
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
    WHERE p.policy_type_parent <> 'ELZAMI' -- أي وثيقة غير إلزامي تمثل الباقة
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
$$;

-- =====================================================
-- تحديث دالة report_client_debts_summary
-- =====================================================
DROP FUNCTION IF EXISTS report_client_debts_summary(UUID, INT);

CREATE OR REPLACE FUNCTION report_client_debts_summary(
  p_branch_id UUID DEFAULT NULL,
  p_filter_days INT DEFAULT NULL
)
RETURNS TABLE (
  total_clients INT,
  total_owed NUMERIC,
  total_remaining NUMERIC
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
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
  -- تجميع على مستوى العميل
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
$$;