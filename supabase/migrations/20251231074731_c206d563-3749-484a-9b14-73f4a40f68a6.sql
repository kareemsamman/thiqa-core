
-- =====================================================
-- Triggers for automatic ledger entries
-- =====================================================

-- Trigger function: إنشاء قيود عند إنشاء بوليصة جديدة
CREATE OR REPLACE FUNCTION public.ledger_on_policy_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  
  -- 1. Premium Income (إيراد التأمين)
  IF NEW.insurance_price > 0 THEN
    PERFORM insert_ledger_entry(
      'policy_created'::ledger_reference_type,
      NEW.id,
      'customer'::ledger_counterparty_type,
      NEW.client_id,
      NEW.insurance_price,
      'premium_income'::ledger_category,
      'إيراد بوليصة جديدة',
      NEW.policy_type_parent::TEXT,
      NEW.id,
      NEW.branch_id,
      NEW.created_by_admin_id,
      NEW.start_date
    );
  END IF;
  
  -- 2. Company Payable (التزام لشركة التأمين)
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
  
  -- 3. ELZAMI Commission Expense (تكلفة عمولة الإلزامي)
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
  
  -- 4. Profit Share (حصة الربح) - only for non-ELZAMI
  IF NEW.policy_type_parent <> 'ELZAMI' AND NEW.profit IS NOT NULL AND NEW.profit > 0 THEN
    PERFORM insert_ledger_entry(
      'policy_created'::ledger_reference_type,
      NEW.id,
      'internal'::ledger_counterparty_type,
      NULL,
      NEW.profit,
      'profit_share'::ledger_category,
      'ربح من البوليصة',
      NEW.policy_type_parent::TEXT,
      NEW.id,
      NEW.branch_id,
      NEW.created_by_admin_id,
      NEW.start_date
    );
  END IF;
  
  -- 5. Broker entries if broker_id exists
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
$$;

-- Trigger function: عند إلغاء بوليصة
CREATE OR REPLACE FUNCTION public.ledger_on_policy_cancelled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only trigger when cancelled changes from false to true
  IF NEW.cancelled = true AND (OLD.cancelled IS NULL OR OLD.cancelled = false) THEN
    -- Reverse all posted ledger entries for this policy
    UPDATE ab_ledger
    SET status = 'reversed'
    WHERE policy_id = NEW.id AND status = 'posted';
    
    -- Create reversal entries
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
      transaction_date
    )
    SELECT
      'policy_cancelled'::ledger_reference_type,
      NEW.id,
      counterparty_type,
      counterparty_id,
      -amount,  -- عكس القيمة
      category,
      'عكس بسبب الإلغاء: ' || COALESCE(description, ''),
      policy_type,
      policy_id,
      branch_id,
      NEW.cancelled_by_admin_id,
      id,
      COALESCE(NEW.cancellation_date, CURRENT_DATE)
    FROM ab_ledger
    WHERE policy_id = NEW.id AND status = 'reversed';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger function: عند استلام دفعة
CREATE OR REPLACE FUNCTION public.ledger_on_payment_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy RECORD;
BEGIN
  -- Get policy info
  SELECT p.client_id, p.policy_type_parent, p.branch_id
  INTO v_policy
  FROM policies p WHERE p.id = NEW.policy_id;
  
  -- Only create entry if payment is not refused
  IF NEW.refused IS NOT TRUE THEN
    PERFORM insert_ledger_entry(
      'payment_received'::ledger_reference_type,
      NEW.id,
      'customer'::ledger_counterparty_type,
      v_policy.client_id,
      NEW.amount,
      'receivable_collected'::ledger_category,
      'استلام دفعة من العميل - ' || NEW.payment_type::TEXT,
      v_policy.policy_type_parent::TEXT,
      NEW.policy_id,
      NEW.branch_id,
      NEW.created_by_admin_id,
      NEW.payment_date
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger function: عند رفض/إرجاع دفعة
CREATE OR REPLACE FUNCTION public.ledger_on_payment_refused()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy RECORD;
BEGIN
  -- Only trigger when refused changes from false to true
  IF NEW.refused = true AND (OLD.refused IS NULL OR OLD.refused = false) THEN
    -- Get policy info
    SELECT p.client_id, p.policy_type_parent
    INTO v_policy
    FROM policies p WHERE p.id = NEW.policy_id;
    
    -- Find and reverse the original ledger entry
    UPDATE ab_ledger
    SET status = 'reversed'
    WHERE reference_type = 'payment_received' 
      AND reference_id = NEW.id 
      AND status = 'posted';
    
    -- Create reversal entry
    PERFORM insert_ledger_entry(
      CASE 
        WHEN NEW.payment_type = 'cheque' THEN 'cheque_returned'::ledger_reference_type
        ELSE 'payment_refused'::ledger_reference_type
      END,
      NEW.id,
      'customer'::ledger_counterparty_type,
      v_policy.client_id,
      -NEW.amount,  -- سالب = عكس التحصيل
      'receivable_reversal'::ledger_category,
      CASE 
        WHEN NEW.payment_type = 'cheque' THEN 'شيك راجع'
        ELSE 'دفعة مرفوضة'
      END,
      v_policy.policy_type_parent::TEXT,
      NEW.policy_id,
      NEW.branch_id,
      NULL,
      CURRENT_DATE
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger function: عند تسوية مع الوسيط
CREATE OR REPLACE FUNCTION public.ledger_on_broker_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only for completed settlements that are not refused
  IF NEW.status = 'completed' AND NEW.refused IS NOT TRUE THEN
    IF NEW.direction = 'we_owe' THEN
      -- We paid to broker
      PERFORM insert_ledger_entry(
        'broker_settlement'::ledger_reference_type,
        NEW.id,
        'broker'::ledger_counterparty_type,
        NEW.broker_id,
        NEW.total_amount,  -- موجب = خفض الالتزام
        'broker_settlement_paid'::ledger_category,
        'تسوية - دفعنا للوسيط',
        NULL,
        NULL,
        NEW.branch_id,
        NEW.created_by_admin_id,
        NEW.settlement_date
      );
    ELSE
      -- Broker paid to us
      PERFORM insert_ledger_entry(
        'broker_settlement'::ledger_reference_type,
        NEW.id,
        'broker'::ledger_counterparty_type,
        NEW.broker_id,
        NEW.total_amount,  -- موجب = استلمنا
        'broker_settlement_received'::ledger_category,
        'تسوية - استلمنا من الوسيط',
        NULL,
        NULL,
        NEW.branch_id,
        NEW.created_by_admin_id,
        NEW.settlement_date
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger function: عند إنشاء مرتجع للعميل
CREATE OR REPLACE FUNCTION public.ledger_on_customer_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create ledger entry for refunds
  IF NEW.transaction_type IN ('refund', 'transfer_refund_owed') THEN
    PERFORM insert_ledger_entry(
      'customer_refund'::ledger_reference_type,
      NEW.id,
      'customer'::ledger_counterparty_type,
      NEW.client_id,
      -NEW.amount,  -- سالب = مستحق للعميل
      'refund_payable'::ledger_category,
      NEW.description,
      NULL,
      NEW.policy_id,
      NEW.branch_id,
      NEW.created_by_admin_id,
      CURRENT_DATE
    );
  ELSIF NEW.transaction_type = 'transfer_adjustment_due' THEN
    -- العميل يدين لنا
    PERFORM insert_ledger_entry(
      'customer_refund'::ledger_reference_type,
      NEW.id,
      'customer'::ledger_counterparty_type,
      NEW.client_id,
      NEW.amount,  -- موجب = مستحق لنا
      'receivable_collected'::ledger_category,
      NEW.description,
      NULL,
      NEW.policy_id,
      NEW.branch_id,
      NEW.created_by_admin_id,
      CURRENT_DATE
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create triggers
CREATE TRIGGER trg_ledger_policy_created
  AFTER INSERT ON policies
  FOR EACH ROW
  EXECUTE FUNCTION ledger_on_policy_created();

CREATE TRIGGER trg_ledger_policy_cancelled
  AFTER UPDATE OF cancelled ON policies
  FOR EACH ROW
  EXECUTE FUNCTION ledger_on_policy_cancelled();

CREATE TRIGGER trg_ledger_payment_received
  AFTER INSERT ON policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION ledger_on_payment_received();

CREATE TRIGGER trg_ledger_payment_refused
  AFTER UPDATE OF refused ON policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION ledger_on_payment_refused();

CREATE TRIGGER trg_ledger_broker_settlement
  AFTER INSERT OR UPDATE OF status ON broker_settlements
  FOR EACH ROW
  EXECUTE FUNCTION ledger_on_broker_settlement();

CREATE TRIGGER trg_ledger_customer_refund
  AFTER INSERT ON customer_wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ledger_on_customer_refund();
