-- ============================================================
-- get_client_policy_metadata
--
-- Fold the four parallel queries that ClientDetails.fetchPolicyMetadata
-- fires (policy_payments + accident_reports + policy_children +
-- media_files) into one RPC that returns all four aggregates per
-- policy. Before, every ClientDetails mount made FOUR Supabase
-- round-trips for these counts; this drops it to one.
--
-- The four were already in Promise.all on the client so the
-- wall-clock saving is mostly CORS preflight + per-request overhead
-- (~4 HTTP requests → 1). For customers with many policies the
-- single aggregated read is also lighter on the wire — we transfer
-- N rows with 5 small columns each instead of (often) 4×N rows
-- across four separate responses with their own JSON envelopes.
--
-- Counts run as correlated subqueries so we never materialize the
-- joined cross product. Postgres turns each into an indexed scan on
-- the relevant foreign key, so the total work is the same as the
-- four standalone queries — just amortized over one statement.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_client_policy_metadata(
  p_policy_ids uuid[]
)
RETURNS TABLE(
  policy_id uuid,
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
    p.id AS policy_id,
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
  WHERE p.id = ANY(p_policy_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_policy_metadata(uuid[]) TO authenticated;
