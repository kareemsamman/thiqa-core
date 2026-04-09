-- Fix notification link for new policies - navigate to client details
CREATE OR REPLACE FUNCTION public.notify_on_policy_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name TEXT;
  v_admin_users UUID[];
BEGIN
  -- Get client name
  SELECT full_name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;
  
  -- Get all active users in the same branch
  SELECT ARRAY_AGG(p.id) INTO v_admin_users
  FROM public.profiles p
  WHERE p.status = 'active'
  AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);
  
  -- Insert notification for each user - link to client page with open param
  IF v_admin_users IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id)
    SELECT 
      unnest(v_admin_users),
      'policy',
      'وثيقة جديدة',
      'تم إنشاء وثيقة جديدة للعميل ' || COALESCE(v_client_name, 'غير معروف'),
      '/clients?open=' || NEW.client_id::text,
      'policy',
      NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Fix notification link for new payments - navigate to client details
CREATE OR REPLACE FUNCTION public.notify_on_payment_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name TEXT;
  v_client_id UUID;
  v_policy_number TEXT;
  v_admin_users UUID[];
BEGIN
  -- Get client and policy info
  SELECT c.full_name, c.id, p.policy_number
  INTO v_client_name, v_client_id, v_policy_number
  FROM public.policies pol
  JOIN public.clients c ON c.id = pol.client_id
  LEFT JOIN public.policies p ON p.id = pol.id
  WHERE pol.id = NEW.policy_id;
  
  -- Get all active users in the same branch
  SELECT ARRAY_AGG(p.id) INTO v_admin_users
  FROM public.profiles p
  WHERE p.status = 'active'
  AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);
  
  -- Insert notification for each user
  IF v_admin_users IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id)
    SELECT 
      unnest(v_admin_users),
      'payment',
      'دفعة جديدة',
      'تم استلام دفعة بمبلغ ₪' || NEW.amount::text || ' من العميل ' || COALESCE(v_client_name, 'غير معروف'),
      '/clients?open=' || v_client_id::text,
      'policy_payment',
      NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Update report_created_policies to include branch name and phone
DROP FUNCTION IF EXISTS report_created_policies(date, date, uuid, text, uuid, text, int, int);

CREATE OR REPLACE FUNCTION report_created_policies(
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_policy_type TEXT DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  created_at TIMESTAMPTZ,
  created_by_id UUID,
  created_by_name TEXT,
  created_by_phone TEXT,
  branch_name TEXT,
  client_id UUID,
  client_name TEXT,
  client_file_number TEXT,
  client_phone TEXT,
  car_number TEXT,
  policy_type_parent TEXT,
  policy_type_child TEXT,
  company_name TEXT,
  company_name_ar TEXT,
  start_date DATE,
  end_date DATE,
  insurance_price NUMERIC,
  total_paid NUMERIC,
  remaining NUMERIC,
  payment_status TEXT,
  total_rows BIGINT
)
LANGUAGE plpgsql
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
      COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0) AS total_paid
    FROM policy_payments pp
    GROUP BY pp.policy_id
  ),
  filtered_policies AS (
    SELECT
      p.id,
      p.created_at,
      p.created_by_admin_id,
      prof.full_name AS created_by_name,
      prof.phone AS created_by_phone,
      b.name_ar AS branch_name,
      p.client_id,
      c.full_name AS client_name,
      c.file_number AS client_file_number,
      c.phone_number AS client_phone,
      car.car_number,
      p.policy_type_parent::TEXT,
      p.policy_type_child::TEXT,
      ic.name AS company_name,
      ic.name_ar AS company_name_ar,
      p.start_date,
      p.end_date,
      p.insurance_price,
      COALESCE(ppa.total_paid, 0) AS total_paid,
      (p.insurance_price - COALESCE(ppa.total_paid, 0)) AS remaining,
      CASE
        WHEN COALESCE(ppa.total_paid, 0) >= p.insurance_price THEN 'paid'
        WHEN COALESCE(ppa.total_paid, 0) > 0 THEN 'partial'
        ELSE 'unpaid'
      END AS payment_status
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN profiles prof ON prof.id = p.created_by_admin_id
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN policy_payments_agg ppa ON ppa.policy_id = p.id
    WHERE p.deleted_at IS NULL
      AND can_access_branch(auth.uid(), p.branch_id)
      AND (p_from_date IS NULL OR p.created_at::DATE >= p_from_date)
      AND (p_to_date IS NULL OR p.created_at::DATE <= p_to_date)
      AND (p_created_by IS NULL OR p.created_by_admin_id = p_created_by)
      AND (p_policy_type IS NULL OR p.policy_type_parent::TEXT = p_policy_type)
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
      AND (
        p_search IS NULL OR
        c.full_name ILIKE '%' || p_search || '%' OR
        c.phone_number ILIKE '%' || p_search || '%' OR
        c.id_number ILIKE '%' || p_search || '%' OR
        c.file_number ILIKE '%' || p_search || '%' OR
        car.car_number ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    fp.*,
    COUNT(*) OVER() AS total_rows
  FROM filtered_policies fp
  ORDER BY fp.created_at DESC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;