
-- =====================================================
-- 1. Add new ENUM values for company settlements
-- =====================================================

-- Add company_settlement to ledger_reference_type if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'company_settlement' AND enumtypid = 'ledger_reference_type'::regtype) THEN
    ALTER TYPE ledger_reference_type ADD VALUE 'company_settlement';
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'company_settlement_reversal' AND enumtypid = 'ledger_reference_type'::regtype) THEN
    ALTER TYPE ledger_reference_type ADD VALUE 'company_settlement_reversal';
  END IF;
END $$;

-- Add company settlement categories if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'company_payable_reversal' AND enumtypid = 'ledger_category'::regtype) THEN
    ALTER TYPE ledger_category ADD VALUE 'company_payable_reversal';
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'company_settlement_reversal' AND enumtypid = 'ledger_category'::regtype) THEN
    ALTER TYPE ledger_category ADD VALUE 'company_settlement_reversal';
  END IF;
END $$;

-- =====================================================
-- 2. Create company_settlements table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.company_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.insurance_companies(id) ON DELETE RESTRICT,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_type TEXT NOT NULL DEFAULT 'cash',
  cheque_number TEXT,
  cheque_image_url TEXT,
  bank_reference TEXT,
  card_last_four TEXT,
  card_expiry TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  refused BOOLEAN DEFAULT false,
  branch_id UUID REFERENCES public.branches(id),
  created_by_admin_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_company_settlements_company_id ON public.company_settlements(company_id);
CREATE INDEX IF NOT EXISTS idx_company_settlements_date ON public.company_settlements(settlement_date);

-- Enable RLS
ALTER TABLE public.company_settlements ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Branch users can view company settlements" ON public.company_settlements;
CREATE POLICY "Branch users can view company settlements" ON public.company_settlements
  FOR SELECT USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can manage company settlements" ON public.company_settlements;
CREATE POLICY "Branch users can manage company settlements" ON public.company_settlements
  FOR ALL USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_company_settlements_updated_at ON public.company_settlements;
CREATE TRIGGER update_company_settlements_updated_at
  BEFORE UPDATE ON public.company_settlements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 3. Create Ledger Trigger for Company Settlement
-- =====================================================
CREATE OR REPLACE FUNCTION public.ledger_on_company_settlement()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create entry if payment is completed and not refused
  IF NEW.status = 'completed' AND NEW.refused IS NOT TRUE THEN
    PERFORM insert_ledger_entry(
      'company_settlement'::ledger_reference_type,
      NEW.id,
      'insurance_company'::ledger_counterparty_type,
      NEW.company_id,
      NEW.total_amount,  -- موجب = خفض المستحق للشركة
      'company_settlement_paid'::ledger_category,
      'تسديد لشركة التأمين - ' || NEW.payment_type,
      NULL,
      NULL,
      NEW.branch_id,
      NEW.created_by_admin_id,
      NEW.settlement_date
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- 4. Create Trigger for Refused Company Settlement
-- =====================================================
CREATE OR REPLACE FUNCTION public.ledger_on_company_settlement_refused()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when refused changes from false to true
  IF NEW.refused = true AND (OLD.refused IS NULL OR OLD.refused = false) THEN
    -- Find and reverse the original ledger entry
    UPDATE ab_ledger
    SET status = 'reversed'
    WHERE reference_type = 'company_settlement'
      AND reference_id = NEW.id
      AND status = 'posted';
    
    -- Create reversal entry
    PERFORM insert_ledger_entry(
      'company_settlement_reversal'::ledger_reference_type,
      NEW.id,
      'insurance_company'::ledger_counterparty_type,
      NEW.company_id,
      -NEW.total_amount,  -- سالب = إعادة الدين
      'company_settlement_reversal'::ledger_category,
      'عكس تسديد - دفعة مرفوضة/شيك راجع',
      NULL,
      NULL,
      NEW.branch_id,
      NULL,
      CURRENT_DATE
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- 5. Attach Triggers to company_settlements
-- =====================================================
DROP TRIGGER IF EXISTS trigger_company_settlement ON public.company_settlements;
CREATE TRIGGER trigger_company_settlement
  AFTER INSERT ON public.company_settlements
  FOR EACH ROW EXECUTE FUNCTION ledger_on_company_settlement();

DROP TRIGGER IF EXISTS trigger_company_settlement_refused ON public.company_settlements;
CREATE TRIGGER trigger_company_settlement_refused
  AFTER UPDATE OF refused ON public.company_settlements
  FOR EACH ROW EXECUTE FUNCTION ledger_on_company_settlement_refused();

-- =====================================================
-- 6. Fix ledger_on_policy_cancelled to always reverse company_payable
-- =====================================================
CREATE OR REPLACE FUNCTION public.ledger_on_policy_cancelled()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when cancelled changes from false to true
  IF NEW.cancelled = true AND (OLD.cancelled IS NULL OR OLD.cancelled = false) THEN
    -- Mark all original ledger entries as reversed
    UPDATE ab_ledger
    SET status = 'reversed'
    WHERE policy_id = NEW.id AND status = 'posted';
    
    -- Create reversal entries for each posted entry
    INSERT INTO ab_ledger (
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
      transaction_date,
      status
    )
    SELECT
      'policy_cancelled'::ledger_reference_type,
      NEW.id,
      counterparty_type,
      counterparty_id,
      -amount,  -- عكس القيمة
      CASE 
        WHEN category = 'company_payable' THEN 'company_payable_reversal'::ledger_category
        ELSE category
      END,
      'عكس بسبب الإلغاء: ' || COALESCE(description, ''),
      policy_type,
      policy_id,
      branch_id,
      NEW.cancelled_by_admin_id,
      id,
      COALESCE(NEW.cancellation_date, CURRENT_DATE),
      'posted'
    FROM ab_ledger
    WHERE policy_id = NEW.id 
      AND reference_type = 'policy_created'
      AND status = 'reversed';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- 7. Fix ledger_on_policy_created to include company_payable
-- =====================================================
CREATE OR REPLACE FUNCTION public.ledger_on_policy_created()
RETURNS TRIGGER AS $$
DECLARE
  v_elzami_cost NUMERIC := 0;
BEGIN
  -- Skip if policy is being soft-deleted or already cancelled
  IF NEW.deleted_at IS NOT NULL OR NEW.cancelled = true THEN
    RETURN NEW;
  END IF;
  
  -- Get ELZAMI cost if applicable
  IF NEW.policy_type_parent = 'ELZAMI' AND NEW.company_id IS NOT NULL THEN
    SELECT COALESCE(elzami_commission, 0) INTO v_elzami_cost
    FROM insurance_companies WHERE id = NEW.company_id;
  END IF;
  
  -- 1. Company Payable (التزام لشركة التأمين) - ALWAYS for non-null company
  IF NEW.payed_for_company IS NOT NULL AND NEW.payed_for_company > 0 AND NEW.company_id IS NOT NULL THEN
    PERFORM insert_ledger_entry(
      'policy_created'::ledger_reference_type,
      NEW.id,
      'insurance_company'::ledger_counterparty_type,
      NEW.company_id,
      -NEW.payed_for_company,  -- سالب = التزام علينا
      'company_payable'::ledger_category,
      'مستحق لشركة التأمين',
      NEW.policy_type_parent::TEXT,
      NEW.id,
      NEW.branch_id,
      NEW.created_by_admin_id,
      NEW.start_date
    );
  END IF;
  
  -- 2. ELZAMI Commission Expense (تكلفة عمولة الإلزامي)
  IF NEW.policy_type_parent = 'ELZAMI' AND v_elzami_cost > 0 THEN
    PERFORM insert_ledger_entry(
      'policy_created'::ledger_reference_type,
      NEW.id,
      'insurance_company'::ledger_counterparty_type,
      NEW.company_id,
      -v_elzami_cost,  -- سالب = تكلفة علينا
      'commission_expense'::ledger_category,
      'تكلفة عمولة الإلزامي',
      NEW.policy_type_parent::TEXT,
      NEW.id,
      NEW.branch_id,
      NEW.created_by_admin_id,
      NEW.start_date
    );
    
    -- Update elzami_cost column
    NEW.elzami_cost := v_elzami_cost;
  END IF;
  
  -- 3. Broker entries if broker_id exists
  IF NEW.broker_id IS NOT NULL AND NEW.profit IS NOT NULL AND NEW.profit > 0 THEN
    IF NEW.broker_direction = 'from_broker' THEN
      -- Broker brought the deal - we owe broker
      PERFORM insert_ledger_entry(
        'policy_created'::ledger_reference_type,
        NEW.id,
        'broker'::ledger_counterparty_type,
        NEW.broker_id,
        -NEW.profit,  -- سالب = مستحق للوسيط
        'broker_payable'::ledger_category,
        'مستحق للوسيط (الوسيط أحضر الصفقة)',
        NEW.policy_type_parent::TEXT,
        NEW.id,
        NEW.branch_id,
        NEW.created_by_admin_id,
        NEW.start_date
      );
    ELSIF NEW.broker_direction = 'to_broker' THEN
      -- We made this for broker - broker owes us
      PERFORM insert_ledger_entry(
        'policy_created'::ledger_reference_type,
        NEW.id,
        'broker'::ledger_counterparty_type,
        NEW.broker_id,
        NEW.profit,  -- موجب = مستحق من الوسيط
        'broker_receivable'::ledger_category,
        'مستحق من الوسيط (نحن صنعنا للوسيط)',
        NEW.policy_type_parent::TEXT,
        NEW.id,
        NEW.branch_id,
        NEW.created_by_admin_id,
        NEW.start_date
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- 8. Create function to get company wallet balance
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_company_wallet_balance(
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
    -- المستحق للشركة من البوالص (قيم سالبة في الـ ledger = التزام)
    ABS(COALESCE(SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)) AS total_payable,
    -- المدفوع للشركة (قيم موجبة = تسديد)
    COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS total_paid,
    -- المتبقي = المستحق - المدفوع
    ABS(COALESCE(SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0))
    - COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    + ABS(COALESCE(SUM(CASE WHEN l.category = 'company_settlement_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0))
    - ABS(COALESCE(SUM(CASE WHEN l.category = 'company_payable_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)) AS outstanding
  FROM public.ab_ledger l
  WHERE l.counterparty_type = 'insurance_company'
    AND l.counterparty_id = p_company_id
    AND (p_from_date IS NULL OR l.transaction_date >= p_from_date)
    AND (p_to_date IS NULL OR l.transaction_date <= p_to_date);
END;
$$;

-- =====================================================
-- 9. Create function to get all companies wallet summary
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_all_companies_wallet_summary()
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  company_name_ar TEXT,
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
  -- Only allow active users
  IF NOT is_active_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    ic.id AS company_id,
    ic.name AS company_name,
    ic.name_ar AS company_name_ar,
    ABS(COALESCE(SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)) AS total_payable,
    COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0) AS total_paid,
    ABS(COALESCE(SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0))
    - COALESCE(SUM(CASE WHEN l.category = 'company_settlement_paid' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)
    + ABS(COALESCE(SUM(CASE WHEN l.category = 'company_settlement_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0))
    - ABS(COALESCE(SUM(CASE WHEN l.category = 'company_payable_reversal' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)) AS outstanding
  FROM public.insurance_companies ic
  LEFT JOIN public.ab_ledger l ON l.counterparty_id = ic.id AND l.counterparty_type = 'insurance_company'
  WHERE ic.active = true
  GROUP BY ic.id, ic.name, ic.name_ar
  HAVING ABS(COALESCE(SUM(CASE WHEN l.category = 'company_payable' AND l.status = 'posted' THEN l.amount ELSE 0 END), 0)) > 0
  ORDER BY outstanding DESC;
END;
$$;
