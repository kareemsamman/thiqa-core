-- Debt tracking: exclude broker-arranged policies from the client debt
-- list, and pool payments across broker siblings inside a package so
-- packages that were paid against the broker row show as covered.
--
-- Background: report_debt_policies_for_clients previously returned
-- every active policy (including broker rows) and used a per-policy
-- `paid` sum. That caused two problems visible on the Debt Tracking
-- page:
--   1. Broker-side deals (the broker owes us, not the client) showed
--      up as client debt.
--   2. In the أسامة حسام package (THIRD_FULL on a broker deal +
--      ROAD_SERVICE non-broker), the customer paid the whole package
--      against the THIRD_FULL row, but the RPC joined payments only
--      to the surviving rows per-policy, so ROAD_SERVICE still looked
--      unpaid.
--
-- New behavior:
--   * Only non-broker rows are returned (one row per non-broker
--     policy, same shape as before).
--   * The `paid` column is computed at the group level: for rows that
--     sit inside a group_id, we take the group's total pooled payments
--     and distribute them across the non-broker siblings smallest-
--     first. Standalone policies keep their own direct payments.
--   * Capping per group stays implicit — we never hand out more than
--     a policy's own price.

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
  -- Per-group pool. Sum every payment in the group (broker + non-
  -- broker siblings) and the non-broker owed amount for the group.
  group_pool AS (
    SELECT
      ap.group_id,
      SUM(pps.paid) AS pooled_paid,
      SUM(
        CASE
          WHEN ap.broker_id IS NULL
          THEN ap.insurance_price +
               CASE WHEN ap.policy_type_parent = 'ELZAMI'
                    THEN COALESCE(ap.office_commission, 0)
                    ELSE 0
               END
          ELSE 0
        END
      ) AS non_broker_owed
    FROM active_policies ap
    JOIN policy_payments_sum pps ON pps.policy_id = ap.id
    WHERE ap.group_id IS NOT NULL
    GROUP BY ap.group_id
  ),
  -- Distribute the group pool across non-broker siblings smallest-
  -- price first so the smallest unpaid components clear first. This
  -- mirrors the JS logic in DebtPaymentModal.
  ranked AS (
    SELECT
      ap.*,
      pps.paid AS direct_paid,
      ROW_NUMBER() OVER (
        PARTITION BY ap.group_id
        ORDER BY (ap.insurance_price +
                 CASE WHEN ap.policy_type_parent = 'ELZAMI'
                      THEN COALESCE(ap.office_commission, 0)
                      ELSE 0
                 END) ASC, ap.id
      ) AS rn_in_group,
      SUM(ap.insurance_price +
          CASE WHEN ap.policy_type_parent = 'ELZAMI'
               THEN COALESCE(ap.office_commission, 0)
               ELSE 0
          END)
      OVER (
        PARTITION BY ap.group_id
        ORDER BY (ap.insurance_price +
                 CASE WHEN ap.policy_type_parent = 'ELZAMI'
                      THEN COALESCE(ap.office_commission, 0)
                      ELSE 0
                 END) ASC, ap.id
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
      CASE WHEN r.policy_type_parent = 'ELZAMI'
           THEN COALESCE(r.office_commission, 0)
           ELSE 0
      END AS office_commission_effective,
      LEAST(
        r.insurance_price +
        CASE WHEN r.policy_type_parent = 'ELZAMI'
             THEN COALESCE(r.office_commission, 0)
             ELSE 0
        END,
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
      CASE WHEN ap.policy_type_parent = 'ELZAMI'
           THEN COALESCE(ap.office_commission, 0)
           ELSE 0
      END AS office_commission_effective,
      LEAST(
        ap.insurance_price +
        CASE WHEN ap.policy_type_parent = 'ELZAMI'
             THEN COALESCE(ap.office_commission, 0)
             ELSE 0
        END,
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
