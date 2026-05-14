-- Surface the matched car number in search_global results.
--
-- When a client is matched via cars.car_number ILIKE, the previous
-- function returned matched_car_id but not the actual car_number. The
-- UI needs the number itself to render "🚗 311" under the client name
-- so the user can tell at a glance WHICH car of his portfolio matched
-- his search — otherwise the dropdown shows the client's ID number
-- and looks like an unrelated hit.

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
  v_is_name_search boolean;
  v_clients jsonb;
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

  v_is_name_search := substring(v_term, 1, 1) ~ '[[:alpha:]]';

  IF v_is_name_search THEN
    WITH direct_clients AS (
      SELECT id, full_name, id_number, phone_number,
             NULL::uuid AS matched_car_id,
             NULL::text AS matched_car_number
      FROM public.clients
      WHERE deleted_at IS NULL
        AND full_name_normalized ILIKE '%' || v_term_norm || '%'
      LIMIT 10
    ),
    client_cars AS (
      SELECT client_id, array_agg(car_number ORDER BY rn) AS car_numbers
      FROM (
        SELECT client_id, car_number,
               row_number() OVER (PARTITION BY client_id ORDER BY created_at DESC) AS rn
        FROM public.cars
        WHERE deleted_at IS NULL
          AND client_id IN (SELECT id FROM direct_clients)
      ) ranked
      WHERE rn <= 3
      GROUP BY client_id
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',                 uc.id,
      'full_name',          uc.full_name,
      'id_number',          uc.id_number,
      'phone_number',       uc.phone_number,
      'cars',               coalesce(cc.car_numbers, ARRAY[]::text[]),
      'matched_car_id',     uc.matched_car_id,
      'matched_car_number', uc.matched_car_number
    )), '[]'::jsonb)
    INTO v_clients
    FROM direct_clients uc
    LEFT JOIN client_cars cc ON cc.client_id = uc.id;
  ELSE
    WITH direct_clients AS (
      SELECT id, full_name, id_number, phone_number,
             NULL::uuid AS matched_car_id,
             NULL::text AS matched_car_number
      FROM public.clients
      WHERE deleted_at IS NULL
        AND (
          phone_number     ILIKE '%' || v_term || '%'
          OR phone_number_2 ILIKE '%' || v_term || '%'
          OR id_number      ILIKE '%' || v_term || '%'
          OR file_number    ILIKE '%' || v_term || '%'
        )
      LIMIT 10
    ),
    car_matched_clients AS (
      SELECT c.id, c.full_name, c.id_number, c.phone_number,
             car.id         AS matched_car_id,
             car.car_number AS matched_car_number
      FROM public.cars car
      JOIN public.clients c
        ON c.id = car.client_id AND c.deleted_at IS NULL
      WHERE car.deleted_at IS NULL
        AND car.car_number ILIKE '%' || v_term || '%'
      LIMIT 10
    ),
    union_clients AS (
      SELECT DISTINCT ON (id)
        id, full_name, id_number, phone_number,
        matched_car_id, matched_car_number
      FROM (
        SELECT * FROM direct_clients
        UNION ALL
        SELECT * FROM car_matched_clients
      ) u
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
      'id',                 uc.id,
      'full_name',          uc.full_name,
      'id_number',          uc.id_number,
      'phone_number',       uc.phone_number,
      'cars',               coalesce(cc.car_numbers, ARRAY[]::text[]),
      'matched_car_id',     uc.matched_car_id,
      'matched_car_number', uc.matched_car_number
    )), '[]'::jsonb)
    INTO v_clients
    FROM union_clients uc
    LEFT JOIN client_cars cc ON cc.client_id = uc.id;
  END IF;

  RETURN jsonb_build_object(
    'clients',  v_clients,
    'policies', '[]'::jsonb,
    'receipts', '[]'::jsonb
  );
END;
$$;
