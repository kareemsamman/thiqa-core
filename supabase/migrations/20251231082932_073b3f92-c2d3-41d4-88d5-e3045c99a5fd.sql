-- =====================================================
-- Phase 1: Cleanup bad ledger entries
-- =====================================================

-- Delete premium_income entries (wrong category)
DELETE FROM ab_ledger WHERE category = 'premium_income';

-- Delete profit_share entries (wrong category)  
DELETE FROM ab_ledger WHERE category = 'profit_share';

-- Delete receivable_collected that came from wrong triggers
DELETE FROM ab_ledger 
WHERE category = 'receivable_collected' 
AND reference_type = 'policy_cancelled';

-- Delete duplicate entries using created_at to keep oldest
DELETE FROM ab_ledger a
USING (
  SELECT 
    policy_id, 
    category, 
    reference_type, 
    amount,
    MIN(created_at) as keep_created
  FROM ab_ledger
  WHERE policy_id IS NOT NULL
  GROUP BY policy_id, category, reference_type, amount
  HAVING COUNT(*) > 1
) dups
WHERE a.policy_id = dups.policy_id
  AND a.category = dups.category
  AND a.reference_type = dups.reference_type
  AND a.amount = dups.amount
  AND a.created_at != dups.keep_created;

-- =====================================================
-- Phase 2: Fix ledger_on_policy_cancelled function
-- =====================================================

CREATE OR REPLACE FUNCTION public.ledger_on_policy_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_original RECORD;
BEGIN
  -- Only trigger when cancelled changes from false/null to true
  IF NEW.cancelled = true AND (OLD.cancelled IS NULL OR OLD.cancelled = false) THEN
    
    -- Loop through original policy_created entries that are still posted
    FOR v_original IN 
      SELECT * FROM ab_ledger 
      WHERE policy_id = NEW.id 
        AND reference_type = 'policy_created'
        AND status = 'posted'
    LOOP
      -- Mark original as reversed
      UPDATE ab_ledger SET status = 'reversed' WHERE id = v_original.id;
      
      -- Create reversal entry
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
      ) VALUES (
        'policy_cancelled'::ledger_reference_type,
        NEW.id,
        v_original.counterparty_type,
        v_original.counterparty_id,
        -v_original.amount,
        CASE 
          WHEN v_original.category = 'company_payable' THEN 'company_payable_reversal'::ledger_category
          WHEN v_original.category = 'broker_payable' THEN 'broker_payable'::ledger_category
          WHEN v_original.category = 'broker_receivable' THEN 'broker_receivable'::ledger_category
          WHEN v_original.category = 'commission_expense' THEN 'commission_expense'::ledger_category
          ELSE v_original.category
        END,
        'عكس بسبب الإلغاء: ' || COALESCE(v_original.description, ''),
        v_original.policy_type,
        NEW.id,
        NEW.branch_id,
        NEW.cancelled_by_admin_id,
        v_original.id,
        COALESCE(NEW.cancellation_date, CURRENT_DATE),
        'posted'
      );
    END LOOP;
    
  END IF;
  
  RETURN NEW;
END;
$function$;

-- =====================================================
-- Phase 3: Fix ledger_on_policy_created function
-- =====================================================

CREATE OR REPLACE FUNCTION public.ledger_on_policy_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_elzami_cost NUMERIC := 0;
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.cancelled = true THEN
    RETURN NEW;
  END IF;
  
  IF NEW.policy_type_parent = 'ELZAMI' AND NEW.company_id IS NOT NULL THEN
    SELECT COALESCE(elzami_commission, 0) INTO v_elzami_cost
    FROM insurance_companies WHERE id = NEW.company_id;
  END IF;
  
  IF NEW.payed_for_company IS NOT NULL AND NEW.payed_for_company > 0 AND NEW.company_id IS NOT NULL THEN
    PERFORM insert_ledger_entry(
      'policy_created'::ledger_reference_type,
      NEW.id,
      'insurance_company'::ledger_counterparty_type,
      NEW.company_id,
      -NEW.payed_for_company,
      'company_payable'::ledger_category,
      'مستحق لشركة التأمين',
      NEW.policy_type_parent::TEXT,
      NEW.id,
      NEW.branch_id,
      NEW.created_by_admin_id,
      NEW.start_date
    );
  END IF;
  
  IF NEW.policy_type_parent = 'ELZAMI' AND v_elzami_cost > 0 THEN
    PERFORM insert_ledger_entry(
      'policy_created'::ledger_reference_type,
      NEW.id,
      'insurance_company'::ledger_counterparty_type,
      NEW.company_id,
      -v_elzami_cost,
      'commission_expense'::ledger_category,
      'تكلفة عمولة الإلزامي',
      NEW.policy_type_parent::TEXT,
      NEW.id,
      NEW.branch_id,
      NEW.created_by_admin_id,
      NEW.start_date
    );
    NEW.elzami_cost := v_elzami_cost;
  END IF;
  
  IF NEW.broker_id IS NOT NULL AND NEW.profit IS NOT NULL AND NEW.profit > 0 THEN
    IF NEW.broker_direction = 'from_broker' THEN
      PERFORM insert_ledger_entry(
        'policy_created'::ledger_reference_type,
        NEW.id,
        'broker'::ledger_counterparty_type,
        NEW.broker_id,
        -NEW.profit,
        'broker_payable'::ledger_category,
        'مستحق للوسيط (الوسيط أحضر الصفقة)',
        NEW.policy_type_parent::TEXT,
        NEW.id,
        NEW.branch_id,
        NEW.created_by_admin_id,
        NEW.start_date
      );
    ELSIF NEW.broker_direction = 'to_broker' THEN
      PERFORM insert_ledger_entry(
        'policy_created'::ledger_reference_type,
        NEW.id,
        'broker'::ledger_counterparty_type,
        NEW.broker_id,
        NEW.profit,
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
$function$;

-- =====================================================
-- Phase 4: Create triggers (drop duplicates first)
-- =====================================================

DROP TRIGGER IF EXISTS ledger_policy_created ON policies;
DROP TRIGGER IF EXISTS ledger_policy_cancelled ON policies;
DROP TRIGGER IF EXISTS trg_ledger_policy_created ON policies;
DROP TRIGGER IF EXISTS trg_ledger_policy_cancelled ON policies;
DROP TRIGGER IF EXISTS ledger_customer_refund ON customer_wallet_transactions;
DROP TRIGGER IF EXISTS trg_ledger_customer_refund ON customer_wallet_transactions;

CREATE TRIGGER ledger_policy_created
  BEFORE INSERT ON policies
  FOR EACH ROW
  EXECUTE FUNCTION ledger_on_policy_created();

CREATE TRIGGER ledger_policy_cancelled
  AFTER UPDATE ON policies
  FOR EACH ROW
  WHEN (NEW.cancelled = true AND (OLD.cancelled IS NULL OR OLD.cancelled = false))
  EXECUTE FUNCTION ledger_on_policy_cancelled();

CREATE TRIGGER ledger_customer_refund
  AFTER INSERT ON customer_wallet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ledger_on_customer_refund();

-- =====================================================
-- Phase 5: Backfill refund_payable for old cancelled policies
-- =====================================================

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
  transaction_date,
  status
)
SELECT
  'customer_refund'::ledger_reference_type,
  cwt.id,
  'customer'::ledger_counterparty_type,
  cwt.client_id,
  -cwt.amount,
  'refund_payable'::ledger_category,
  'مرتجع للعميل - ' || COALESCE(cwt.description, ''),
  p.policy_type_parent::TEXT,
  cwt.policy_id,
  cwt.branch_id,
  COALESCE(p.cancellation_date, CURRENT_DATE),
  'posted'
FROM customer_wallet_transactions cwt
JOIN policies p ON p.id = cwt.policy_id
WHERE cwt.transaction_type IN ('refund', 'transfer_refund_owed')
  AND NOT EXISTS (
    SELECT 1 FROM ab_ledger al 
    WHERE al.reference_type = 'customer_refund' 
      AND al.reference_id = cwt.id
  );

-- =====================================================
-- Phase 6: Backfill missing entries for non-cancelled policies
-- =====================================================

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
  transaction_date,
  status
)
SELECT
  'policy_created'::ledger_reference_type,
  p.id,
  'insurance_company'::ledger_counterparty_type,
  p.company_id,
  -p.payed_for_company,
  'company_payable'::ledger_category,
  'مستحق لشركة التأمين (backfill)',
  p.policy_type_parent::TEXT,
  p.id,
  p.branch_id,
  p.start_date,
  'posted'
FROM policies p
WHERE p.cancelled = false
  AND p.deleted_at IS NULL
  AND p.payed_for_company > 0
  AND p.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ab_ledger al 
    WHERE al.policy_id = p.id 
      AND al.category = 'company_payable'
      AND al.status = 'posted'
  );

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
  transaction_date,
  status
)
SELECT
  'policy_created'::ledger_reference_type,
  p.id,
  'insurance_company'::ledger_counterparty_type,
  p.company_id,
  -ic.elzami_commission,
  'commission_expense'::ledger_category,
  'تكلفة عمولة الإلزامي (backfill)',
  p.policy_type_parent::TEXT,
  p.id,
  p.branch_id,
  p.start_date,
  'posted'
FROM policies p
JOIN insurance_companies ic ON ic.id = p.company_id
WHERE p.cancelled = false
  AND p.deleted_at IS NULL
  AND p.policy_type_parent = 'ELZAMI'
  AND ic.elzami_commission > 0
  AND NOT EXISTS (
    SELECT 1 FROM ab_ledger al 
    WHERE al.policy_id = p.id 
      AND al.category = 'commission_expense'
      AND al.status = 'posted'
  );

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
  transaction_date,
  status
)
SELECT
  'policy_created'::ledger_reference_type,
  p.id,
  'broker'::ledger_counterparty_type,
  p.broker_id,
  p.profit,
  'broker_receivable'::ledger_category,
  'مستحق من الوسيط (backfill)',
  p.policy_type_parent::TEXT,
  p.id,
  p.branch_id,
  p.start_date,
  'posted'
FROM policies p
WHERE p.cancelled = false
  AND p.deleted_at IS NULL
  AND p.broker_id IS NOT NULL
  AND p.broker_direction = 'to_broker'
  AND p.profit > 0
  AND NOT EXISTS (
    SELECT 1 FROM ab_ledger al 
    WHERE al.policy_id = p.id 
      AND al.category = 'broker_receivable'
      AND al.status = 'posted'
  );

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
  transaction_date,
  status
)
SELECT
  'policy_created'::ledger_reference_type,
  p.id,
  'broker'::ledger_counterparty_type,
  p.broker_id,
  -p.profit,
  'broker_payable'::ledger_category,
  'مستحق للوسيط (backfill)',
  p.policy_type_parent::TEXT,
  p.id,
  p.branch_id,
  p.start_date,
  'posted'
FROM policies p
WHERE p.cancelled = false
  AND p.deleted_at IS NULL
  AND p.broker_id IS NOT NULL
  AND p.broker_direction = 'from_broker'
  AND p.profit > 0
  AND NOT EXISTS (
    SELECT 1 FROM ab_ledger al 
    WHERE al.policy_id = p.id 
      AND al.category = 'broker_payable'
      AND al.status = 'posted'
  );