-- Single-round-trip global search.
--
-- The inline search in the header / bottom toolbar used to fire 5-6
-- separate PostgREST requests per keystroke (clients, cars, policies,
-- receipts, then a second cars query for the matched clients). Each
-- request paid full HTTPS latency; the round-trip count, not the DB
-- work, was the bottleneck after the trgm indexes landed.
--
-- This function rolls everything into one server-side query. The client
-- now does `supabase.rpc('search_global', { p_term })` and renders the
-- response directly.
--
-- SECURITY INVOKER + STABLE: RLS still applies (search must respect
-- whatever the caller can already see), and the planner is free to
-- inline / parallelize.

CREATE OR REPLACE FUNCTION public.search_global(p_term text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_term text;
  v_term_norm text;
  v_clients jsonb;
  v_policies jsonb;
  v_receipts jsonb;
BEGIN
  v_term := trim(coalesce(p_term, ''));
  IF length(v_term) < 2 THEN
    RETURN jsonb_build_object(
      'clients', '[]'::jsonb,
      'policies', '[]'::jsonb,
      'receipts', '[]'::jsonb
    );
  END IF;
  v_term_norm := public.normalize_arabic(v_term);

  -- ── Clients (direct match + via car number) ────────────────────────
  WITH direct_clients AS (
    SELECT id, full_name, id_number, phone_number, NULL::uuid AS matched_car_id
    FROM public.clients
    WHERE deleted_at IS NULL
      AND (
        full_name_normalized ILIKE '%' || v_term_norm || '%'
        OR phone_number     ILIKE '%' || v_term || '%'
        OR phone_number_2   ILIKE '%' || v_term || '%'
        OR id_number        ILIKE '%' || v_term || '%'
        OR file_number      ILIKE '%' || v_term || '%'
      )
    LIMIT 10
  ),
  car_matched_clients AS (
    SELECT c.id, c.full_name, c.id_number, c.phone_number, car.id AS matched_car_id
    FROM public.cars car
    JOIN public.clients c
      ON c.id = car.client_id AND c.deleted_at IS NULL
    WHERE car.deleted_at IS NULL
      AND car.car_number ILIKE '%' || v_term || '%'
    LIMIT 10
  ),
  union_clients AS (
    SELECT DISTINCT ON (id) id, full_name, id_number, phone_number, matched_car_id
    FROM (
      SELECT * FROM direct_clients
      UNION ALL
      SELECT * FROM car_matched_clients
    ) u
    -- Prefer the row that has a matched_car_id over a NULL one.
    ORDER BY id, (matched_car_id IS NULL) ASC
    LIMIT 10
  ),
  client_cars AS (
    SELECT client_id, array_agg(car_number ORDER BY rn) AS car_numbers
    FROM (
      SELECT client_id, car_number,
             row_number() OVER (PARTITION BY client_id ORDER BY created_at DESC) AS rn
      FROM public.cars
      WHERE deleted_at IS NULL
        AND client_id IN (SELECT id FROM union_clients)
    ) ranked
    WHERE rn <= 3
    GROUP BY client_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',             uc.id,
    'full_name',      uc.full_name,
    'id_number',      uc.id_number,
    'phone_number',   uc.phone_number,
    'cars',           coalesce(cc.car_numbers, ARRAY[]::text[]),
    'matched_car_id', uc.matched_car_id
  )), '[]'::jsonb)
  INTO v_clients
  FROM union_clients uc
  LEFT JOIN client_cars cc ON cc.client_id = uc.id;

  -- ── Policies (document_number / policy_number) ─────────────────────
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',              p.id,
    'document_number', p.document_number,
    'policy_number',   p.policy_number,
    'client_name',     cl.full_name,
    'car_number',      car.car_number
  )), '[]'::jsonb)
  INTO v_policies
  FROM (
    SELECT id, document_number, policy_number, client_id, car_id
    FROM public.policies
    WHERE deleted_at IS NULL
      AND (
        document_number ILIKE '%' || v_term || '%'
        OR policy_number ILIKE '%' || v_term || '%'
      )
    LIMIT 8
  ) p
  LEFT JOIN public.clients cl ON cl.id = p.client_id
  LEFT JOIN public.cars    car ON car.id = p.car_id;

  -- ── Receipts (policy_payments.receipt_number) ──────────────────────
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'receipt_number',  pp.receipt_number,
    'policy_id',       pp.policy_id,
    'document_number', p.document_number,
    'client_name',     cl.full_name,
    'car_number',      car.car_number
  )), '[]'::jsonb)
  INTO v_receipts
  FROM (
    SELECT id, receipt_number, policy_id
    FROM public.policy_payments
    WHERE receipt_number IS NOT NULL
      AND receipt_number ILIKE '%' || v_term || '%'
    LIMIT 8
  ) pp
  LEFT JOIN public.policies p   ON p.id = pp.policy_id
  LEFT JOIN public.clients  cl  ON cl.id = p.client_id
  LEFT JOIN public.cars     car ON car.id = p.car_id;

  RETURN jsonb_build_object(
    'clients',  v_clients,
    'policies', v_policies,
    'receipts', v_receipts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_global(text) TO authenticated;
