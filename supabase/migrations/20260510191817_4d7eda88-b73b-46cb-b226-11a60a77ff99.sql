DO $$
DECLARE
  v_agent uuid := 'f37f11e5-6b05-4948-bd1a-c9a490eeb20e';
  v_branch uuid := 'ebb6725f-0a32-498b-ac86-57fd68e36d71';
  v_excluded uuid[] := ARRAY[
    'cec30a88-53f9-4ddd-ac6e-28b8a20ef1c9',
    '7d44bcf2-134a-48e8-af04-dfce7734990c',
    '28ecd9c6-d8c3-4b3c-9a66-9cc0c1361f73',
    'a7eb47a5-bb8e-42b2-8c43-5ed8247693a2'
  ]::uuid[];
BEGIN
  INSERT INTO policy_payments (policy_id, payment_type, amount, payment_date, agent_id, branch_id, source, provider, notes)
  SELECT first_policy_id, 'cash'::payment_type, ROUND(remaining::numeric, 2), CURRENT_DATE,
         v_agent, v_branch, 'user', 'manual', 'تسوية تلقائية - دفعة نقدية كاملة (باقة)'
  FROM (
    SELECT p.group_id,
           (array_agg(p.id ORDER BY p.created_at))[1] AS first_policy_id,
           SUM(p.insurance_price + COALESCE(p.office_commission,0)) -
             COALESCE((SELECT SUM(pp.amount) FROM policy_payments pp
                       JOIN policies p2 ON p2.id=pp.policy_id
                       WHERE p2.group_id = p.group_id AND p2.deleted_at IS NULL
                         AND NOT COALESCE(pp.refused,false)),0) AS remaining
    FROM policies p
    JOIN clients c ON c.id = p.client_id
    WHERE c.agent_id = v_agent AND c.id <> ALL(v_excluded)
      AND p.cancelled = false AND p.deleted_at IS NULL AND p.broker_id IS NULL
      AND p.group_id IS NOT NULL
    GROUP BY p.group_id
  ) g
  WHERE remaining > 0.01;

  INSERT INTO policy_payments (policy_id, payment_type, amount, payment_date, agent_id, branch_id, source, provider, notes)
  SELECT p.id, 'cash'::payment_type,
         ROUND(((p.insurance_price + COALESCE(p.office_commission,0)) - COALESCE(paid.s,0))::numeric, 2),
         CURRENT_DATE, v_agent, v_branch, 'user', 'manual', 'تسوية تلقائية - دفعة نقدية كاملة'
  FROM policies p
  JOIN clients c ON c.id = p.client_id
  LEFT JOIN LATERAL (
    SELECT SUM(amount) AS s FROM policy_payments pp
    WHERE pp.policy_id = p.id AND NOT COALESCE(pp.refused,false)
  ) paid ON true
  WHERE c.agent_id = v_agent AND c.id <> ALL(v_excluded)
    AND p.cancelled = false AND p.deleted_at IS NULL AND p.broker_id IS NULL
    AND p.group_id IS NULL
    AND ((p.insurance_price + COALESCE(p.office_commission,0)) - COALESCE(paid.s,0)) > 0.01;
END $$;