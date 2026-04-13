-- Make get_client_balance package-aware.
--
-- Root cause (real case: أسامة حسام at a.h.musaffer@gmail.com):
--   Two policies in the same group (94916240-…):
--     - THIRD_FULL 2400 with broker_id        → excluded from client owed
--     - ROAD_SERVICE 250 without broker_id    → included in client owed
--   Package total paid by the customer: 2650, recorded against the
--   THIRD_FULL policy (standard practice for package payments). The old
--   get_client_balance filtered out the THIRD_FULL entirely via
--   `broker_id IS NULL`, then joined payments only to the surviving
--   ROAD_SERVICE row → saw 0 paid → reported 250 owed even though the
--   customer had paid the full package.
--
-- New model:
--   - The client's owed amount is still the sum of insurance_price on
--     non-broker, non-cancelled, non-transferred policies (plus
--     office_commission on ELZAMI rows — same as before).
--   - Payments are now computed per-group. For each group that contains
--     at least one active non-broker policy, we sum payments on EVERY
--     policy in the group (including broker siblings), then cap the
--     group's counted paid amount at what the client actually owes for
--     that group. Capping prevents an overpayment in one group (because
--     of a broker sibling) from erasing legitimate debt in another group.
--   - Ungrouped active policies keep their old per-policy calculation.
--   - Wallet refunds unchanged.

CREATE OR REPLACE FUNCTION public.get_client_balance(p_client_id uuid)
 RETURNS TABLE(total_insurance numeric, total_paid numeric, total_refunds numeric, total_remaining numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH
  -- All groups the client has at least one non-broker active policy in
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
      -- Client's owed for this group: non-broker policies only
      (
        SELECT COALESCE(SUM(
          COALESCE(po.insurance_price, 0) +
          CASE
            WHEN po.policy_type_parent = 'ELZAMI'
            THEN COALESCE(po.office_commission, 0)
            ELSE 0
          END
        ), 0)
        FROM policies po
        WHERE po.group_id = ag.group_id
          AND po.client_id = p_client_id
          AND po.broker_id IS NULL
          AND COALESCE(po.cancelled, FALSE) = FALSE
          AND COALESCE(po.transferred, FALSE) = FALSE
          AND po.deleted_at IS NULL
      ) AS group_owed,
      -- Payments pooled across EVERY policy in the group (broker + non-broker)
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
  -- Ungrouped active non-broker policies (standalone)
  single_policies AS (
    SELECT
      p.id,
      COALESCE(p.insurance_price, 0) +
      CASE
        WHEN p.policy_type_parent = 'ELZAMI'
        THEN COALESCE(p.office_commission, 0)
        ELSE 0
      END AS owed,
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
      -- Cap each group's counted payments at the group's owed amount so
      -- broker-side overpayment never erases debt in other groups.
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
