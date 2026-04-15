-- Every INSERT into sms_logs has to carry agent_id because the column
-- is NOT NULL (backfilled + tightened in 20260413190000). Historically
-- most of the edge functions that send SMS just never set agent_id —
-- they write phone, message, client_id/branch_id, etc., and leave
-- agent_id blank. The insert then fails the NOT NULL check, the SMS
-- goes out anyway, and nothing shows on /sms-history.
--
-- Rather than editing ~15 call sites across 11 edge functions and
-- redeploying them all, add a BEFORE INSERT trigger that resolves
-- agent_id (and branch_id when missing) using the same priority
-- order the backfill migration used:
--   1. NEW.branch_id -> branches.agent_id
--   2. NEW.client_id -> clients.agent_id  (+ branches.agent_id as
--      a branch fallback so RLS's can_access_branch check still
--      passes for the caller)
--   3. NEW.policy_id -> policies.agent_id
--   4. NEW.created_by -> profiles.agent_id
--
-- If all four paths fail we raise — that's genuinely orphaned and we
-- want to surface the bug instead of silently dropping the row.

CREATE OR REPLACE FUNCTION public.sms_logs_fill_agent_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch_id uuid;
  v_agent_id uuid;
BEGIN
  IF NEW.agent_id IS NOT NULL AND NEW.branch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 1. branch_id already set? Resolve agent from branches.
  IF NEW.branch_id IS NOT NULL THEN
    SELECT b.agent_id INTO v_agent_id
    FROM public.branches b
    WHERE b.id = NEW.branch_id;
    IF v_agent_id IS NOT NULL AND NEW.agent_id IS NULL THEN
      NEW.agent_id := v_agent_id;
    END IF;
  END IF;

  -- 2. client_id -> clients.agent_id (+ clients.branch_id as
  --    branch fallback).
  IF (NEW.agent_id IS NULL OR NEW.branch_id IS NULL) AND NEW.client_id IS NOT NULL THEN
    SELECT c.agent_id, c.branch_id
      INTO v_agent_id, v_branch_id
    FROM public.clients c
    WHERE c.id = NEW.client_id;
    IF NEW.agent_id IS NULL AND v_agent_id IS NOT NULL THEN
      NEW.agent_id := v_agent_id;
    END IF;
    IF NEW.branch_id IS NULL AND v_branch_id IS NOT NULL THEN
      NEW.branch_id := v_branch_id;
    END IF;
  END IF;

  -- 3. policy_id -> policies.agent_id (+ policies.branch_id)
  IF (NEW.agent_id IS NULL OR NEW.branch_id IS NULL) AND NEW.policy_id IS NOT NULL THEN
    SELECT p.agent_id, p.branch_id
      INTO v_agent_id, v_branch_id
    FROM public.policies p
    WHERE p.id = NEW.policy_id;
    IF NEW.agent_id IS NULL AND v_agent_id IS NOT NULL THEN
      NEW.agent_id := v_agent_id;
    END IF;
    IF NEW.branch_id IS NULL AND v_branch_id IS NOT NULL THEN
      NEW.branch_id := v_branch_id;
    END IF;
  END IF;

  -- 4. created_by -> profiles.agent_id (+ profiles.branch_id)
  IF (NEW.agent_id IS NULL OR NEW.branch_id IS NULL) AND NEW.created_by IS NOT NULL THEN
    SELECT pr.agent_id, pr.branch_id
      INTO v_agent_id, v_branch_id
    FROM public.profiles pr
    WHERE pr.id = NEW.created_by;
    IF NEW.agent_id IS NULL AND v_agent_id IS NOT NULL THEN
      NEW.agent_id := v_agent_id;
    END IF;
    IF NEW.branch_id IS NULL AND v_branch_id IS NOT NULL THEN
      NEW.branch_id := v_branch_id;
    END IF;
  END IF;

  IF NEW.agent_id IS NULL THEN
    RAISE EXCEPTION
      'sms_logs insert has no agent_id and could not resolve one from branch_id=%, client_id=%, policy_id=%, created_by=%',
      NEW.branch_id, NEW.client_id, NEW.policy_id, NEW.created_by;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sms_logs_fill_agent_id_trg ON public.sms_logs;
CREATE TRIGGER sms_logs_fill_agent_id_trg
BEFORE INSERT ON public.sms_logs
FOR EACH ROW
EXECUTE FUNCTION public.sms_logs_fill_agent_id();
