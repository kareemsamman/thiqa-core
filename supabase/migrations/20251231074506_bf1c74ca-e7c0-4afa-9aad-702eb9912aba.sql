
-- =====================================================
-- AB Ledger: نظام السجل المحاسبي الموحد
-- =====================================================

-- ENUM for reference types
CREATE TYPE public.ledger_reference_type AS ENUM (
  'policy_created',
  'policy_cancelled',
  'policy_transferred',
  'payment_received',
  'payment_refused',
  'cheque_returned',
  'cheque_restored',
  'company_settlement',
  'broker_settlement',
  'customer_refund',
  'manual_adjustment'
);

-- ENUM for counterparty types  
CREATE TYPE public.ledger_counterparty_type AS ENUM (
  'insurance_company',
  'customer',
  'broker',
  'internal'
);

-- ENUM for ledger categories
CREATE TYPE public.ledger_category AS ENUM (
  'premium_income',           -- إيراد قسط التأمين
  'company_payable',          -- التزام لشركة التأمين
  'company_payable_reversal', -- عكس الالتزام (إلغاء)
  'commission_income',        -- عمولة واردة
  'commission_expense',       -- عمولة صادرة (ELZAMI)
  'profit_share',             -- حصة الربح
  'receivable_collected',     -- تحصيل مستحق
  'receivable_reversal',      -- عكس تحصيل (شيك راجع)
  'refund_payable',           -- مرتجع مستحق للعميل
  'broker_receivable',        -- مستحق من الوسيط
  'broker_payable',           -- مستحق للوسيط
  'broker_settlement_paid',   -- تسوية - دفعنا للوسيط
  'broker_settlement_received', -- تسوية - استلمنا من الوسيط
  'company_settlement_paid',  -- تسوية - دفعنا للشركة
  'adjustment'                -- تعديل يدوي
);

-- ENUM for ledger status
CREATE TYPE public.ledger_status AS ENUM (
  'posted',    -- مسجل
  'reversed',  -- معكوس
  'pending'    -- معلق
);

-- Main Ledger Table
CREATE TABLE public.ab_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- التاريخ والوقت
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- المرجع
  reference_type public.ledger_reference_type NOT NULL,
  reference_id UUID NOT NULL,
  
  -- الطرف المقابل
  counterparty_type public.ledger_counterparty_type NOT NULL,
  counterparty_id UUID,
  
  -- القيمة المالية (موجب = لصالح AB، سالب = على AB)
  amount NUMERIC NOT NULL,
  
  -- التصنيف
  category public.ledger_category NOT NULL,
  
  -- الحالة
  status public.ledger_status NOT NULL DEFAULT 'posted',
  
  -- ربط العكس
  reversal_of UUID REFERENCES public.ab_ledger(id),
  reversed_by UUID REFERENCES public.ab_ledger(id),
  
  -- معلومات إضافية
  description TEXT,
  policy_type TEXT,
  policy_id UUID,
  
  -- التتبع
  branch_id UUID REFERENCES public.branches(id),
  created_by_admin_id UUID REFERENCES public.profiles(id),
  
  -- فهرسة
  CONSTRAINT positive_or_negative_amount CHECK (amount <> 0)
);

-- فهارس للأداء
CREATE INDEX idx_ab_ledger_transaction_date ON public.ab_ledger(transaction_date);
CREATE INDEX idx_ab_ledger_reference ON public.ab_ledger(reference_type, reference_id);
CREATE INDEX idx_ab_ledger_counterparty ON public.ab_ledger(counterparty_type, counterparty_id);
CREATE INDEX idx_ab_ledger_category ON public.ab_ledger(category);
CREATE INDEX idx_ab_ledger_status ON public.ab_ledger(status);
CREATE INDEX idx_ab_ledger_policy_id ON public.ab_ledger(policy_id);
CREATE INDEX idx_ab_ledger_branch ON public.ab_ledger(branch_id);

-- تفعيل RLS
ALTER TABLE public.ab_ledger ENABLE ROW LEVEL SECURITY;

-- سياسات الأمان
CREATE POLICY "Admins can view all ledger entries" 
ON public.ab_ledger 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage ledger entries" 
ON public.ab_ledger 
FOR ALL 
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Branch users can view their branch ledger" 
ON public.ab_ledger 
FOR SELECT 
USING (
  is_active_user(auth.uid()) 
  AND can_access_branch(auth.uid(), branch_id)
);

-- إضافة عمود commission_expense للبوليصات (للإلزامي)
ALTER TABLE public.policies 
ADD COLUMN IF NOT EXISTS elzami_cost NUMERIC DEFAULT 0;

-- تحديث عمود elzami_cost للبوليصات الإلزامية الموجودة
-- سيتم تحديث البيانات في خطوة منفصلة
COMMENT ON COLUMN public.policies.elzami_cost IS 'تكلفة عمولة الإلزامي - قيمة سالبة تُخصم من صافي AB';

-- دالة لحساب صافي رصيد AB
CREATE OR REPLACE FUNCTION public.get_ab_balance(
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  total_income NUMERIC,
  total_expense NUMERIC,
  net_balance NUMERIC,
  company_payables NUMERIC,
  broker_payables NUMERIC,
  broker_receivables NUMERIC,
  customer_refunds_due NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END), 0) AS total_income,
    COALESCE(SUM(CASE WHEN l.amount < 0 THEN ABS(l.amount) ELSE 0 END), 0) AS total_expense,
    COALESCE(SUM(l.amount), 0) AS net_balance,
    COALESCE(SUM(CASE WHEN l.category = 'company_payable' THEN ABS(l.amount) ELSE 0 END), 0) 
      - COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' THEN l.amount ELSE 0 END), 0) AS company_payables,
    COALESCE(SUM(CASE WHEN l.category = 'broker_payable' THEN ABS(l.amount) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN l.category = 'broker_settlement_paid' THEN l.amount ELSE 0 END), 0) AS broker_payables,
    COALESCE(SUM(CASE WHEN l.category = 'broker_receivable' THEN l.amount ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN l.category = 'broker_settlement_received' THEN l.amount ELSE 0 END), 0) AS broker_receivables,
    COALESCE(SUM(CASE WHEN l.category = 'refund_payable' THEN ABS(l.amount) ELSE 0 END), 0) AS customer_refunds_due
  FROM public.ab_ledger l
  WHERE l.status = 'posted'
    AND (p_from_date IS NULL OR l.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR l.transaction_date <= p_to_date)
    AND (p_branch_id IS NULL OR l.branch_id = p_branch_id);
END;
$$;

-- دالة لحساب رصيد شركة تأمين محددة
CREATE OR REPLACE FUNCTION public.get_company_balance(
  p_company_id UUID,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS TABLE (
  total_payable NUMERIC,
  total_paid NUMERIC,
  outstanding NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN l.category = 'company_payable' THEN ABS(l.amount) ELSE 0 END), 0) AS total_payable,
    COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' THEN l.amount ELSE 0 END), 0) AS total_paid,
    COALESCE(SUM(CASE WHEN l.category = 'company_payable' THEN ABS(l.amount) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' THEN l.amount ELSE 0 END), 0) AS outstanding
  FROM public.ab_ledger l
  WHERE l.status = 'posted'
    AND l.counterparty_type = 'insurance_company'
    AND l.counterparty_id = p_company_id
    AND (p_from_date IS NULL OR l.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR l.transaction_date <= p_to_date);
END;
$$;

-- دالة لإدخال قيد محاسبي
CREATE OR REPLACE FUNCTION public.insert_ledger_entry(
  p_reference_type ledger_reference_type,
  p_reference_id UUID,
  p_counterparty_type ledger_counterparty_type,
  p_counterparty_id UUID,
  p_amount NUMERIC,
  p_category ledger_category,
  p_description TEXT DEFAULT NULL,
  p_policy_type TEXT DEFAULT NULL,
  p_policy_id UUID DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_admin_id UUID DEFAULT NULL,
  p_transaction_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id UUID;
BEGIN
  INSERT INTO public.ab_ledger (
    reference_type,
    reference_id,
    counterparty_type,
    counterparty_id,
    amount,
    category,
    description,
    policy_type,
    policy_id,
    branch_id,
    created_by_admin_id,
    transaction_date
  ) VALUES (
    p_reference_type,
    p_reference_id,
    p_counterparty_type,
    p_counterparty_id,
    p_amount,
    p_category,
    p_description,
    p_policy_type,
    p_policy_id,
    p_branch_id,
    p_admin_id,
    p_transaction_date
  )
  RETURNING id INTO v_entry_id;
  
  RETURN v_entry_id;
END;
$$;

-- دالة لعكس قيد محاسبي
CREATE OR REPLACE FUNCTION public.reverse_ledger_entry(
  p_entry_id UUID,
  p_reason TEXT DEFAULT 'Reversal',
  p_admin_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original RECORD;
  v_reversal_id UUID;
BEGIN
  -- جلب القيد الأصلي
  SELECT * INTO v_original
  FROM public.ab_ledger
  WHERE id = p_entry_id AND status = 'posted';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entry not found or already reversed';
  END IF;
  
  -- إنشاء قيد العكس
  INSERT INTO public.ab_ledger (
    reference_type,
    reference_id,
    counterparty_type,
    counterparty_id,
    amount,
    category,
    description,
    policy_type,
    policy_id,
    branch_id,
    created_by_admin_id,
    reversal_of,
    status
  ) VALUES (
    v_original.reference_type,
    v_original.reference_id,
    v_original.counterparty_type,
    v_original.counterparty_id,
    -v_original.amount, -- عكس القيمة
    v_original.category,
    'عكس: ' || COALESCE(p_reason, ''),
    v_original.policy_type,
    v_original.policy_id,
    v_original.branch_id,
    p_admin_id,
    p_entry_id,
    'posted'
  )
  RETURNING id INTO v_reversal_id;
  
  -- تحديث القيد الأصلي
  UPDATE public.ab_ledger
  SET status = 'reversed', reversed_by = v_reversal_id
  WHERE id = p_entry_id;
  
  RETURN v_reversal_id;
END;
$$;
