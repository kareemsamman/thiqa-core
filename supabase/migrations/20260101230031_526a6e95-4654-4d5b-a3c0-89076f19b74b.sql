-- Create renewal tracking table
CREATE TABLE public.policy_renewal_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  renewal_status TEXT NOT NULL DEFAULT 'not_contacted',
  notes TEXT,
  last_contacted_at TIMESTAMP WITH TIME ZONE,
  contacted_by UUID REFERENCES public.profiles(id),
  reminder_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT valid_renewal_status CHECK (renewal_status IN ('not_contacted', 'sms_sent', 'called', 'renewed', 'not_interested'))
);

-- Create unique index to prevent duplicates
CREATE UNIQUE INDEX idx_policy_renewal_tracking_policy_id ON public.policy_renewal_tracking(policy_id);

-- Enable RLS
ALTER TABLE public.policy_renewal_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Branch users can view renewal tracking"
ON public.policy_renewal_tracking FOR SELECT
USING (
  is_active_user(auth.uid()) AND EXISTS (
    SELECT 1 FROM policies p WHERE p.id = policy_renewal_tracking.policy_id 
    AND can_access_branch(auth.uid(), p.branch_id)
  )
);

CREATE POLICY "Branch users can manage renewal tracking"
ON public.policy_renewal_tracking FOR ALL
USING (
  is_active_user(auth.uid()) AND EXISTS (
    SELECT 1 FROM policies p WHERE p.id = policy_renewal_tracking.policy_id 
    AND can_access_branch(auth.uid(), p.branch_id)
  )
);

-- Add trigger for updated_at
CREATE TRIGGER update_policy_renewal_tracking_updated_at
  BEFORE UPDATE ON public.policy_renewal_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add SMS reminder settings columns to sms_settings table
ALTER TABLE public.sms_settings
ADD COLUMN IF NOT EXISTS renewal_reminder_template TEXT DEFAULT 'مرحباً {client_name}، نذكرك بأن تأمين سيارتك رقم {car_number} سينتهي بتاريخ {policy_end_date}. للتجديد تواصل معنا.',
ADD COLUMN IF NOT EXISTS renewal_reminder_days INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS enable_auto_renewal_reminders BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS renewal_reminder_cooldown_days INTEGER DEFAULT 7;

-- Create RPC for fetching created policies with server-side pagination
CREATE OR REPLACE FUNCTION public.report_created_policies(
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_policy_type TEXT DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  created_at TIMESTAMPTZ,
  created_by_id UUID,
  created_by_name TEXT,
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
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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

-- Create RPC for fetching renewals (expiring policies)
CREATE OR REPLACE FUNCTION public.report_renewals(
  p_end_month DATE DEFAULT NULL,
  p_days_remaining INTEGER DEFAULT NULL,
  p_policy_type TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  end_date DATE,
  days_remaining INTEGER,
  client_id UUID,
  client_name TEXT,
  client_file_number TEXT,
  client_phone TEXT,
  car_number TEXT,
  policy_type_parent TEXT,
  policy_type_child TEXT,
  company_name TEXT,
  company_name_ar TEXT,
  insurance_price NUMERIC,
  renewal_status TEXT,
  renewal_notes TEXT,
  last_contacted_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  total_rows BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month_start DATE;
  v_month_end DATE;
BEGIN
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Calculate month range
  IF p_end_month IS NOT NULL THEN
    v_month_start := DATE_TRUNC('month', p_end_month)::DATE;
    v_month_end := (DATE_TRUNC('month', p_end_month) + INTERVAL '1 month - 1 day')::DATE;
  ELSE
    v_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_month_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE;
  END IF;

  RETURN QUERY
  WITH filtered_policies AS (
    SELECT
      p.id,
      p.end_date,
      (p.end_date - CURRENT_DATE)::INTEGER AS days_remaining,
      p.client_id,
      c.full_name AS client_name,
      c.file_number AS client_file_number,
      c.phone_number AS client_phone,
      car.car_number,
      p.policy_type_parent::TEXT,
      p.policy_type_child::TEXT,
      ic.name AS company_name,
      ic.name_ar AS company_name_ar,
      p.insurance_price,
      COALESCE(prt.renewal_status, 'not_contacted') AS renewal_status,
      prt.notes AS renewal_notes,
      prt.last_contacted_at,
      prt.reminder_sent_at
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN cars car ON car.id = p.car_id
    LEFT JOIN insurance_companies ic ON ic.id = p.company_id
    LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
    WHERE p.deleted_at IS NULL
      AND p.cancelled IS NOT TRUE
      AND p.transferred IS NOT TRUE
      AND can_access_branch(auth.uid(), p.branch_id)
      -- Filter by month or days remaining
      AND (
        (p_days_remaining IS NOT NULL AND (p.end_date - CURRENT_DATE) <= p_days_remaining AND (p.end_date - CURRENT_DATE) >= 0)
        OR (p_days_remaining IS NULL AND p.end_date >= v_month_start AND p.end_date <= v_month_end)
      )
      AND (p_policy_type IS NULL OR p.policy_type_parent::TEXT = p_policy_type)
      AND (
        p_search IS NULL OR
        c.full_name ILIKE '%' || p_search || '%' OR
        c.phone_number ILIKE '%' || p_search || '%' OR
        c.file_number ILIKE '%' || p_search || '%' OR
        car.car_number ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    fp.*,
    COUNT(*) OVER() AS total_rows
  FROM filtered_policies fp
  ORDER BY fp.end_date ASC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

-- Summary function for renewals
CREATE OR REPLACE FUNCTION public.report_renewals_summary(
  p_end_month DATE DEFAULT NULL
)
RETURNS TABLE (
  total_expiring BIGINT,
  not_contacted BIGINT,
  sms_sent BIGINT,
  called BIGINT,
  renewed BIGINT,
  not_interested BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month_start DATE;
  v_month_end DATE;
BEGIN
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_end_month IS NOT NULL THEN
    v_month_start := DATE_TRUNC('month', p_end_month)::DATE;
    v_month_end := (DATE_TRUNC('month', p_end_month) + INTERVAL '1 month - 1 day')::DATE;
  ELSE
    v_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_month_end := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE;
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) AS total_expiring,
    COUNT(*) FILTER (WHERE COALESCE(prt.renewal_status, 'not_contacted') = 'not_contacted') AS not_contacted,
    COUNT(*) FILTER (WHERE prt.renewal_status = 'sms_sent') AS sms_sent,
    COUNT(*) FILTER (WHERE prt.renewal_status = 'called') AS called,
    COUNT(*) FILTER (WHERE prt.renewal_status = 'renewed') AS renewed,
    COUNT(*) FILTER (WHERE prt.renewal_status = 'not_interested') AS not_interested
  FROM policies p
  LEFT JOIN policy_renewal_tracking prt ON prt.policy_id = p.id
  WHERE p.deleted_at IS NULL
    AND p.cancelled IS NOT TRUE
    AND p.transferred IS NOT TRUE
    AND can_access_branch(auth.uid(), p.branch_id)
    AND p.end_date >= v_month_start
    AND p.end_date <= v_month_end;
END;
$$;