-- Debt RPCs: stop hiding non-ELZAMI office_commission.
--
-- Background: two functions — get_client_balance and
-- report_debt_policies_for_clients — computed a policy's owed amount as
--   insurance_price + CASE WHEN ELZAMI THEN office_commission ELSE 0 END
-- on the old assumption that only ELZAMI carried a real customer-facing
-- commission. The rest of the app (ClientDetails.fetchPaymentSummary,
-- PackageBreakdown, the printed invoice) has always summed
--   insurance_price + office_commission
-- for every non-broker policy regardless of type, so client cards and
-- the invoice totals already include non-ELZAMI commissions.
--
-- With the transfer-fee pullout (migration 20260420130000), the
-- transferred policy's office_commission now also carries the
-- customer-pays adjustment. Clients who still owe the transfer fee
-- disappeared from the Debt Tracking list because the RPC zeroed out
-- exactly that portion — even though ClientDetails correctly showed
-- إجمالي المتبقي > 0 for the same client.
--
-- Fix: include office_commission on every non-broker active policy in
-- both RPCs so the debt list / summary reconcile with the client page
-- and the invoice. ELZAMI behavior is unchanged (it was already
-- counted); other types now match too.
--
-- This is the third place in the stack that did the same ELZAMI-only
-- gating. The comments from 20260413210000 / 20260413320000 pointed at
-- an older model; that model has since drifted and this migration
-- brings the SQL back in line with the TS.
CREATE OR REPLACE FUNCTION public.get_client_balance(p_client_id uuid)
 RETURNS TABLE(total_insurance numeric, total_paid numeric, total_refunds numeric, total_remaining numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH
  active_groups AS (
    SELECT DISTINCT p.group_id
    FROM policies p
    WHERE p.client_id = p_client_id
      AND p.group_id IS NOT NULL
      AND COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
      AND p.broker_id IS NULL
  ),
  group_balances AS (
    SELECT
      ag.group_id,
      (
        SELECT COALESCE(SUM(
          COALESCE(po.insurance_price, 0) + COALESCE(po.office_commission, 0)
        ), 0)
        FROM policies po
        WHERE po.group_id = ag.group_id
          AND po.client_id = p_client_id
          AND po.broker_id IS NULL
          AND COALESCE(po.cancelled, FALSE) = FALSE
          AND COALESCE(po.transferred, FALSE) = FALSE
          AND po.deleted_at IS NULL
      ) AS group_owed,
      (
        SELECT COALESCE(SUM(pp.amount), 0)
        FROM policy_payments pp
        JOIN policies pg ON pg.id = pp.policy_id
        WHERE pg.group_id = ag.group_id
          AND pg.client_id = p_client_id
          AND COALESCE(pg.cancelled, FALSE) = FALSE
          AND COALESCE(pg.transferred, FALSE) = FALSE
          AND pg.deleted_at IS NULL
          AND COALESCE(pp.refused, FALSE) = FALSE
      ) AS group_paid
    FROM active_groups ag
  ),
  single_policies AS (
    SELECT
      p.id,
      COALESCE(p.insurance_price, 0) + COALESCE(p.office_commission, 0) AS owed,
      (
        SELECT COALESCE(SUM(pp.amount), 0)
        FROM policy_payments pp
        WHERE pp.policy_id = p.id
          AND COALESCE(pp.refused, FALSE) = FALSE
      ) AS paid
    FROM policies p
    WHERE p.client_id = p_client_id
      AND p.group_id IS NULL
      AND p.broker_id IS NULL
      AND COALESCE(p.cancelled, FALSE) = FALSE
      AND COALESCE(p.transferred, FALSE) = FALSE
      AND p.deleted_at IS NULL
  ),
  totals AS (
    SELECT
      COALESCE((SELECT SUM(group_owed) FROM group_balances), 0) +
      COALESCE((SELECT SUM(owed)       FROM single_policies), 0) AS total_ins,
      COALESCE((SELECT SUM(LEAST(group_paid, group_owed)) FROM group_balances), 0) +
      COALESCE((SELECT SUM(paid) FROM single_policies), 0) AS total_pay
  ),
  wallet_totals AS (
    SELECT COALESCE(SUM(
      CASE
        WHEN transaction_type IN ('refund', 'transfer_refund_owed', 'manual_refund')
        THEN amount
        WHEN transaction_type = 'transfer_adjustment_due'
        THEN -amount
        ELSE 0
      END
    ), 0) AS total_ref
    FROM customer_wallet_transactions
    WHERE client_id = p_client_id
  )
  SELECT
    t.total_ins::numeric AS total_insurance,
    t.total_pay::numeric AS total_paid,
    wt.total_ref::numeric AS total_refunds,
    GREATEST(0, t.total_ins - t.total_pay - wt.total_ref)::numeric AS total_remaining
  FROM totals t
  CROSS JOIN wallet_totals wt;
END;
$function$;

DROP FUNCTION IF EXISTS public.report_debt_policies_for_clients(uuid[]);

CREATE FUNCTION public.report_debt_policies_for_clients(p_client_ids uuid[])
 RETURNS TABLE(
   client_id uuid,
   policy_id uuid,
   policy_number text,
   document_number text,
   insurance_price numeric,
   office_commission numeric,
   paid numeric,
   remaining numeric,
   start_date date,
   end_date date,
   days_until_expiry integer,
   status text,
   policy_type_parent text,
   policy_type_child text,
   car_number text,
   group_id uuid
 )
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH active_policies AS (
    SELECT
      p.id,
      p.client_id,
      p.policy_number,
      p.document_number,
      p.insurance_price,
      p.office_commission,
      p.policy_type_parent,
      p.policy_type_child,
      p.start_date,
      p.end_date,
      p.group_id,
      p.broker_id,
      p.car_id,
      p.branch_id
    FROM public.policies p
    JOIN public.clients c ON c.id = p.client_id
    WHERE p.cancelled = FALSE
      AND p.deleted_at IS NULL
      AND p.client_id = ANY (p_client_ids)
      AND public.is_active_user(auth.uid())
      AND public.can_access_branch(auth.uid(), c.branch_id)
  ),
  policy_payments_sum AS (
    SELECT
      ap.id AS policy_id,
      COALESCE(SUM(CASE WHEN pp.refused IS NOT TRUE THEN pp.amount ELSE 0 END), 0)::numeric AS paid
    FROM active_policies ap
    LEFT JOIN public.policy_payments pp ON pp.policy_id = ap.id
    GROUP BY ap.id
  ),
  group_pool AS (
    SELECT
      ap.group_id,
      SUM(pps.paid) AS pooled_paid,
      SUM(
        CASE
          WHEN ap.broker_id IS NULL
          THEN COALESCE(ap.insurance_price, 0) + COALESCE(ap.office_commission, 0)
          ELSE 0
        END
      ) AS non_broker_owed
    FROM active_policies ap
    JOIN policy_payments_sum pps ON pps.policy_id = ap.id
    WHERE ap.group_id IS NOT NULL
    GROUP BY ap.group_id
  ),
  ranked AS (
    SELECT
      ap.*,
      pps.paid AS direct_paid,
      ROW_NUMBER() OVER (
        PARTITION BY ap.group_id
        ORDER BY (COALESCE(ap.insurance_price, 0) + COALESCE(ap.office_commission, 0)) ASC, ap.id
      ) AS rn_in_group,
      SUM(COALESCE(ap.insurance_price, 0) + COALESCE(ap.office_commission, 0))
      OVER (
        PARTITION BY ap.group_id
        ORDER BY (COALESCE(ap.insurance_price, 0) + COALESCE(ap.office_commission, 0)) ASC, ap.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS cumulative_before
    FROM active_policies ap
    JOIN policy_payments_sum pps ON pps.policy_id = ap.id
    WHERE ap.broker_id IS NULL
      AND ap.group_id IS NOT NULL
  ),
  grouped_rows AS (
    SELECT
      r.id,
      r.client_id,
      r.policy_number,
      r.document_number,
      r.insurance_price,
      COALESCE(r.office_commission, 0) AS office_commission_effective,
      LEAST(
        COALESCE(r.insurance_price, 0) + COALESCE(r.office_commission, 0),
        GREATEST(
          0,
          LEAST(gp.pooled_paid, gp.non_broker_owed) - COALESCE(r.cumulative_before, 0)
        )
      ) AS allocated_paid,
      r.start_date,
      r.end_date,
      r.policy_type_parent,
      r.policy_type_child,
      r.car_id,
      r.group_id
    FROM ranked r
    JOIN group_pool gp ON gp.group_id = r.group_id
  ),
  standalone_rows AS (
    SELECT
      ap.id,
      ap.client_id,
      ap.policy_number,
      ap.document_number,
      ap.insurance_price,
      COALESCE(ap.office_commission, 0) AS office_commission_effective,
      LEAST(
        COALESCE(ap.insurance_price, 0) + COALESCE(ap.office_commission, 0),
        pps.paid
      ) AS allocated_paid,
      ap.start_date,
      ap.end_date,
      ap.policy_type_parent,
      ap.policy_type_child,
      ap.car_id,
      ap.group_id
    FROM active_policies ap
    JOIN policy_payments_sum pps ON pps.policy_id = ap.id
    WHERE ap.broker_id IS NULL
      AND ap.group_id IS NULL
  ),
  final_rows AS (
    SELECT * FROM grouped_rows
    UNION ALL
    SELECT * FROM standalone_rows
  )
  SELECT
    fr.client_id,
    fr.id AS policy_id,
    fr.policy_number,
    fr.document_number::text AS document_number,
    fr.insurance_price::numeric AS insurance_price,
    fr.office_commission_effective::numeric AS office_commission,
    fr.allocated_paid::numeric AS paid,
    ((fr.insurance_price + fr.office_commission_effective)
     - fr.allocated_paid)::numeric AS remaining,
    fr.start_date::date AS start_date,
    fr.end_date::date AS end_date,
    (fr.end_date::date - CURRENT_DATE)::int AS days_until_expiry,
    CASE
      WHEN fr.end_date::date < CURRENT_DATE THEN 'expired'
      WHEN (fr.end_date::date - CURRENT_DATE) <= 30 THEN 'expiring_soon'
      ELSE 'active'
    END AS status,
    fr.policy_type_parent::text AS policy_type_parent,
    fr.policy_type_child::text AS policy_type_child,
    car.car_number,
    fr.group_id
  FROM final_rows fr
  LEFT JOIN public.cars car ON car.id = fr.car_id
  WHERE ((fr.insurance_price + fr.office_commission_effective) - fr.allocated_paid) > 0
  ORDER BY fr.client_id, fr.start_date DESC, fr.end_date DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.report_debt_policies_for_clients(uuid[]) TO authenticated;
