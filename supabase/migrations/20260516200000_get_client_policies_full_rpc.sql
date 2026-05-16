-- ============================================================
-- get_client_policies_full
--
-- One RPC that returns everything ClientDetails.fetchPolicies +
-- fetchPolicyMetadata used to need across TWO sequential round-trips:
--   • policy rows with the same 5 joined entities the PostgREST
--     fetch was pulling (company / car / creator / road_service /
--     broker)
--   • per-policy paid_total + accidents_count + children_count +
--     files_count (formerly a separate get_client_policy_metadata
--     RPC fired AFTER the policies query returned)
--
-- Before: fetchPolicies (1 RTT) → fetchPolicyMetadata (1 RTT). Two
-- sequential round-trips before the policies tab can render its
-- pills (paid / accidents / files badges).
--
-- After: one round-trip. Postgres runs the joins + correlated
-- count subqueries in a single statement, and the wire payload is
-- still ~one JSON object per policy.
--
-- The joined entities are emitted as nested jsonb so the React side
-- can keep treating each policy as `{ ..., company: {...}, car:
-- {...}, ... }` — same shape PostgREST was producing via `select=…
-- company:insurance_companies(...)`. NULL entities become NULL
-- nested objects (matches the LEFT JOIN semantics the JS code
-- already handles via optional chaining).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_client_policies_full(
  p_client_id uuid
)
RETURNS TABLE(
  policy jsonb,
  paid_total numeric,
  accidents_count bigint,
  children_count bigint,
  files_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jsonb_build_object(
      'id', p.id,
      'policy_number', p.policy_number,
      'document_number', p.document_number,
      'policy_type_parent', p.policy_type_parent,
      'policy_type_child', p.policy_type_child,
      'start_date', p.start_date,
      'end_date', p.end_date,
      'insurance_price', p.insurance_price,
      'office_commission', p.office_commission,
      'profit', p.profit,
      'cancelled', p.cancelled,
      'transferred', p.transferred,
      'group_id', p.group_id,
      'transferred_car_number', p.transferred_car_number,
      'transferred_to_car_number', p.transferred_to_car_number,
      'transferred_from_policy_id', p.transferred_from_policy_id,
      'created_at', p.created_at,
      'branch_id', p.branch_id,
      'notes', p.notes,
      'is_under_24', p.is_under_24,
      'broker_id', p.broker_id,
      'broker_direction', p.broker_direction,
      'broker_buy_price', p.broker_buy_price,
      'company', CASE WHEN ic.id IS NOT NULL
        THEN jsonb_build_object('name', ic.name, 'name_ar', ic.name_ar)
        ELSE NULL END,
      'car', CASE WHEN c.id IS NOT NULL
        THEN jsonb_build_object('id', c.id, 'car_number', c.car_number)
        ELSE NULL END,
      'creator', CASE WHEN pr.id IS NOT NULL
        THEN jsonb_build_object('full_name', pr.full_name, 'email', pr.email)
        ELSE NULL END,
      'road_service', CASE WHEN rs.id IS NOT NULL
        THEN jsonb_build_object('name', rs.name, 'name_ar', rs.name_ar)
        ELSE NULL END,
      'broker', CASE WHEN b.id IS NOT NULL
        THEN jsonb_build_object('id', b.id, 'name', b.name)
        ELSE NULL END
    ) AS policy,
    COALESCE((
      SELECT SUM(pp.amount)
      FROM public.policy_payments pp
      WHERE pp.policy_id = p.id
        AND COALESCE(pp.refused, FALSE) = FALSE
    ), 0)::numeric AS paid_total,
    (
      SELECT COUNT(*)::bigint
      FROM public.accident_reports ar
      WHERE ar.policy_id = p.id
    ) AS accidents_count,
    (
      SELECT COUNT(*)::bigint
      FROM public.policy_children pc
      WHERE pc.policy_id = p.id
    ) AS children_count,
    (
      SELECT COUNT(*)::bigint
      FROM public.media_files mf
      WHERE mf.entity_id = p.id
        AND mf.entity_type IN ('policy', 'policy_insurance', 'policy_file')
        AND mf.deleted_at IS NULL
    ) AS files_count
  FROM public.policies p
  LEFT JOIN public.insurance_companies ic ON ic.id = p.company_id
  LEFT JOIN public.cars c ON c.id = p.car_id
  LEFT JOIN public.profiles pr ON pr.id = p.created_by_admin_id
  LEFT JOIN public.road_services rs ON rs.id = p.road_service_id
  LEFT JOIN public.brokers b ON b.id = p.broker_id
  WHERE p.client_id = p_client_id
    AND p.deleted_at IS NULL
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_policies_full(uuid) TO authenticated;
