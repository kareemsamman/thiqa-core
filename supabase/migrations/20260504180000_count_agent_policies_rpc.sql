-- Speed up the per-agent in-period policies count that drives the
-- subscription page usage bars and the new-transaction button lock.
--
-- Background
-- ----------
-- useAgentLimits used to pull every in-period policy row over the
-- wire (id + group_id) and COUNT DISTINCT in JS. Fine at 250 rows,
-- painful at 4k+. With 13+ components mounting the hook independently
-- and a realtime channel re-firing on every wallet/usage write, the
-- waterfall of round-trips stacked up and made the bars and the
-- معاملة جديدة button feel "sometimes fast, sometimes slow".
--
-- Fix
-- ---
--   1. Partial composite covering index on (agent_id, created_at) so
--      the read path is an index-only scan; INCLUDE id + group_id so
--      the COUNT DISTINCT never has to touch the heap. Filtered to
--      `deleted_at IS NULL` to match the front-end filter and keep the
--      index small (soft-deleted policies are excluded from quota).
--   2. SECURITY DEFINER RPC that does the COUNT DISTINCT server-side
--      and returns a single integer. Tenant-scoped via get_my_agent_id
--      (impersonation-aware) with a super-admin bypass for /thiqa
--      cross-tenant reads.

CREATE INDEX IF NOT EXISTS idx_policies_agent_created_at_active
  ON public.policies (agent_id, created_at DESC)
  INCLUDE (id, group_id)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.count_agent_policies_in_period(
  p_agent_id uuid,
  p_period_start timestamptz
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_agent uuid;
  v_is_sa boolean;
  v_count integer;
BEGIN
  v_my_agent := public.get_my_agent_id();
  v_is_sa := COALESCE(public.is_super_admin(auth.uid()), false);

  -- Tenant scope: caller must own (or be impersonating) the agent, or
  -- be a non-impersonating super admin reading any agent. Anything
  -- else returns NULL — don't leak counts across tenants.
  IF NOT v_is_sa AND p_agent_id IS DISTINCT FROM v_my_agent THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(DISTINCT COALESCE(group_id, id))::integer
    INTO v_count
  FROM public.policies
  WHERE agent_id = p_agent_id
    AND deleted_at IS NULL
    AND created_at >= p_period_start;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_agent_policies_in_period(uuid, timestamptz) TO authenticated;
