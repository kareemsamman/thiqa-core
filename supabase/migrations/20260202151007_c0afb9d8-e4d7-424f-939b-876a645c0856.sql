-- Fix report_renewals function - cast ENUM to TEXT for comparison
CREATE OR REPLACE FUNCTION public.report_renewals(
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_company_id uuid DEFAULT NULL::uuid,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_policy_type text DEFAULT NULL::text,
  p_broker_id uuid DEFAULT NULL::uuid,
  p_show_renewed boolean DEFAULT NULL::boolean,
  p_show_cancelled boolean DEFAULT NULL::boolean
)
RETURNS TABLE(
  policy_id uuid,
  policy_number text,
  policy_type text,
  policy_type_parent text,
  start_date date,
  end_date date,
  total_price numeric,
  company_payment numeric,
  profit numeric,
  client_id uuid,
  client_name text,
  client_phone text,
  client_id_number text,
  car_id uuid,
  car_number text,
  car_details text,
  company_id uuid,
  company_name text,
  broker_id uuid,
  broker_name text,
  branch_id uuid,
  branch_name text,
  is_renewed boolean,
  renewed_policy_id uuid,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as policy_id,
    p.policy_number,
    p.policy_type,
    p.policy_type_parent::text as policy_type_parent,
    p.start_date,
    p.end_date,
    p.total_price,
    p.company_payment,
    p.profit,
    c.id as client_id,
    c.full_name as client_name,
    c.phone_number as client_phone,
    c.id_number as client_id_number,
    car.id as car_id,
    car.car_number,
    CONCAT(car.manufacturer_name, ' ', car.model, ' ', car.year) as car_details,
    ic.id as company_id,
    ic.name as company_name,
    b.id as broker_id,
    b.name as broker_name,
    br.id as branch_id,
    br.name as branch_name,
    p.is_renewed,
    p.renewed_policy_id,
    p.status,
    p.created_at
  FROM policies p
  LEFT JOIN clients c ON p.client_id = c.id
  LEFT JOIN cars car ON p.car_id = car.id
  LEFT JOIN insurance_companies ic ON p.company_id = ic.id
  LEFT JOIN brokers b ON c.broker_id = b.id
  LEFT JOIN branches br ON p.branch_id = br.id
  WHERE p.deleted_at IS NULL
    AND (p_start_date IS NULL OR p.end_date >= p_start_date)
    AND (p_end_date IS NULL OR p.end_date <= p_end_date)
    AND (p_company_id IS NULL OR p.company_id = p_company_id)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
    AND (p_broker_id IS NULL OR c.broker_id = p_broker_id)
    AND (p_show_renewed IS NULL OR p.is_renewed = p_show_renewed)
    AND (p_show_cancelled IS NULL OR (p_show_cancelled = true) OR p.status != 'cancelled')
  ORDER BY p.end_date ASC;
END;
$$;

-- Fix report_renewals_service function - cast ENUM to TEXT for comparison
CREATE OR REPLACE FUNCTION public.report_renewals_service(
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date,
  p_company_id uuid DEFAULT NULL::uuid,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_policy_type text DEFAULT NULL::text,
  p_broker_id uuid DEFAULT NULL::uuid,
  p_show_renewed boolean DEFAULT NULL::boolean,
  p_show_cancelled boolean DEFAULT NULL::boolean,
  p_page_number integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS TABLE(
  policy_id uuid,
  policy_number text,
  policy_type text,
  policy_type_parent text,
  start_date date,
  end_date date,
  total_price numeric,
  company_payment numeric,
  profit numeric,
  client_id uuid,
  client_name text,
  client_phone text,
  client_id_number text,
  car_id uuid,
  car_number text,
  car_details text,
  company_id uuid,
  company_name text,
  broker_id uuid,
  broker_name text,
  branch_id uuid,
  branch_name text,
  is_renewed boolean,
  renewed_policy_id uuid,
  status text,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_count bigint;
  v_offset integer;
BEGIN
  -- Calculate offset
  v_offset := (p_page_number - 1) * p_page_size;
  
  -- Get total count first
  SELECT COUNT(*) INTO v_total_count
  FROM policies p
  LEFT JOIN clients c ON p.client_id = c.id
  WHERE p.deleted_at IS NULL
    AND (p_start_date IS NULL OR p.end_date >= p_start_date)
    AND (p_end_date IS NULL OR p.end_date <= p_end_date)
    AND (p_company_id IS NULL OR p.company_id = p_company_id)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
    AND (p_broker_id IS NULL OR c.broker_id = p_broker_id)
    AND (p_show_renewed IS NULL OR p.is_renewed = p_show_renewed)
    AND (p_show_cancelled IS NULL OR (p_show_cancelled = true) OR p.status != 'cancelled');
  
  RETURN QUERY
  SELECT 
    p.id as policy_id,
    p.policy_number,
    p.policy_type,
    p.policy_type_parent::text as policy_type_parent,
    p.start_date,
    p.end_date,
    p.total_price,
    p.company_payment,
    p.profit,
    c.id as client_id,
    c.full_name as client_name,
    c.phone_number as client_phone,
    c.id_number as client_id_number,
    car.id as car_id,
    car.car_number,
    CONCAT(car.manufacturer_name, ' ', car.model, ' ', car.year) as car_details,
    ic.id as company_id,
    ic.name as company_name,
    b.id as broker_id,
    b.name as broker_name,
    br.id as branch_id,
    br.name as branch_name,
    p.is_renewed,
    p.renewed_policy_id,
    p.status,
    p.created_at,
    v_total_count as total_count
  FROM policies p
  LEFT JOIN clients c ON p.client_id = c.id
  LEFT JOIN cars car ON p.car_id = car.id
  LEFT JOIN insurance_companies ic ON p.company_id = ic.id
  LEFT JOIN brokers b ON c.broker_id = b.id
  LEFT JOIN branches br ON p.branch_id = br.id
  WHERE p.deleted_at IS NULL
    AND (p_start_date IS NULL OR p.end_date >= p_start_date)
    AND (p_end_date IS NULL OR p.end_date <= p_end_date)
    AND (p_company_id IS NULL OR p.company_id = p_company_id)
    AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    AND (p_policy_type IS NULL OR p.policy_type_parent::text = p_policy_type)
    AND (p_broker_id IS NULL OR c.broker_id = p_broker_id)
    AND (p_show_renewed IS NULL OR p.is_renewed = p_show_renewed)
    AND (p_show_cancelled IS NULL OR (p_show_cancelled = true) OR p.status != 'cancelled')
  ORDER BY p.end_date ASC
  LIMIT p_page_size
  OFFSET v_offset;
END;
$$;