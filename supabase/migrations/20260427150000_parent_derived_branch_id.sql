-- ============================================================
-- Parent-derived branch_id for tables whose natural branch lives
-- on a parent record, not on the inserter.
--
-- Mirrors the policy_payments fix from 20260427140000. The generic
-- auto_set_branch_id() trigger from 20260426150000 stamps every new
-- row with the inserter's profile.branch_id. That's correct for
-- standalone tables but wrong for tables whose row really belongs
-- to the branch of its parent (e.g., a media file uploaded for a
-- Branch A policy belongs to Branch A, not to whichever branch
-- the uploader happens to work in).
--
-- Affected tables (parent → derivation):
--   * media_files          → polymorphic via entity_type/entity_id
--                            client/car/policy/cheque
--   * accident_reports     → policies.branch_id (policy_id NOT NULL)
--   * customer_signatures  → clients.branch_id (client_id NOT NULL)
--   * sms_logs             → already has sms_logs_fill_agent_id_trg
--                            that resolves branch from client/policy;
--                            the generic auto_set_branch_id_sms_logs
--                            fires first and stamps the inserter's
--                            branch, making the parent-derivation
--                            unreachable. Just drop the generic
--                            trigger and let the existing one work.
--
-- Tables intentionally left alone (no parent to derive from):
--   * outside_cheques        — standalone, no client/policy FK
--   * correspondence_letters — recipient is a free-text name + phone,
--                              no FK to a client/policy parent
--
-- Each specialized trigger keeps the same fall-back behavior the
-- generic trigger had: if the parent doesn't have a branch_id (legacy
-- agency-wide rows) or the row has no parent at all, copy the
-- inserter's profile.branch_id. That preserves worker UX — a worker
-- inserting for a NULL-branch parent will still scope the new row
-- to their own branch.
-- ============================================================

-- 1. media_files ----------------------------------------------

CREATE OR REPLACE FUNCTION public.set_media_files_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_branch_id uuid;
  v_user_branch_id uuid;
BEGIN
  -- Caller passed an explicit branch — respect it.
  IF NEW.branch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Polymorphic parent lookup. entity_type values come from the
  -- upload-media edge function and the FileUploader UI:
  --   'client', 'car', 'policy', 'cheque' (cheque → policy_payments)
  IF NEW.entity_type IS NOT NULL AND NEW.entity_id IS NOT NULL THEN
    CASE NEW.entity_type
      WHEN 'client' THEN
        SELECT branch_id INTO v_parent_branch_id
        FROM public.clients WHERE id = NEW.entity_id;
      WHEN 'car' THEN
        SELECT branch_id INTO v_parent_branch_id
        FROM public.cars WHERE id = NEW.entity_id;
      WHEN 'policy' THEN
        SELECT branch_id INTO v_parent_branch_id
        FROM public.policies WHERE id = NEW.entity_id;
      WHEN 'cheque' THEN
        SELECT branch_id INTO v_parent_branch_id
        FROM public.policy_payments WHERE id = NEW.entity_id;
      ELSE
        v_parent_branch_id := NULL;
    END CASE;

    IF v_parent_branch_id IS NOT NULL THEN
      NEW.branch_id := v_parent_branch_id;
      RETURN NEW;
    END IF;
  END IF;

  -- No parent / parent has no branch → fall back to inserter.
  SELECT branch_id INTO v_user_branch_id
  FROM public.profiles
  WHERE id = auth.uid();
  IF v_user_branch_id IS NOT NULL THEN
    NEW.branch_id := v_user_branch_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_set_branch_id_media_files ON public.media_files;
DROP TRIGGER IF EXISTS set_media_files_branch_id_trigger ON public.media_files;
CREATE TRIGGER set_media_files_branch_id_trigger
  BEFORE INSERT ON public.media_files
  FOR EACH ROW
  EXECUTE FUNCTION public.set_media_files_branch_id();

-- Backfill: re-derive branch_id from the parent for any media row
-- where the parent has a branch and the current value disagrees.
-- Uses a CTE so the parent lookup runs once per row.
WITH derived AS (
  SELECT
    mf.id,
    CASE mf.entity_type
      WHEN 'client' THEN (SELECT c.branch_id FROM public.clients c WHERE c.id = mf.entity_id)
      WHEN 'car'    THEN (SELECT cr.branch_id FROM public.cars cr WHERE cr.id = mf.entity_id)
      WHEN 'policy' THEN (SELECT p.branch_id FROM public.policies p WHERE p.id = mf.entity_id)
      WHEN 'cheque' THEN (SELECT pp.branch_id FROM public.policy_payments pp WHERE pp.id = mf.entity_id)
      ELSE NULL
    END AS parent_branch_id
  FROM public.media_files mf
  WHERE mf.entity_type IN ('client', 'car', 'policy', 'cheque')
    AND mf.entity_id IS NOT NULL
)
UPDATE public.media_files mf
SET branch_id = d.parent_branch_id
FROM derived d
WHERE mf.id = d.id
  AND d.parent_branch_id IS NOT NULL
  AND mf.branch_id IS DISTINCT FROM d.parent_branch_id;

-- 2. accident_reports -----------------------------------------

CREATE OR REPLACE FUNCTION public.set_accident_reports_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy_branch_id uuid;
  v_user_branch_id uuid;
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- accident_reports.policy_id is NOT NULL by schema, but check
  -- defensively in case a future migration relaxes that.
  IF NEW.policy_id IS NOT NULL THEN
    SELECT branch_id INTO v_policy_branch_id
    FROM public.policies WHERE id = NEW.policy_id;
    IF v_policy_branch_id IS NOT NULL THEN
      NEW.branch_id := v_policy_branch_id;
      RETURN NEW;
    END IF;
  END IF;

  SELECT branch_id INTO v_user_branch_id
  FROM public.profiles WHERE id = auth.uid();
  IF v_user_branch_id IS NOT NULL THEN
    NEW.branch_id := v_user_branch_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_set_branch_id_accident_reports ON public.accident_reports;
DROP TRIGGER IF EXISTS set_accident_reports_branch_id_trigger ON public.accident_reports;
CREATE TRIGGER set_accident_reports_branch_id_trigger
  BEFORE INSERT ON public.accident_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_accident_reports_branch_id();

UPDATE public.accident_reports ar
SET branch_id = p.branch_id
FROM public.policies p
WHERE ar.policy_id = p.id
  AND p.branch_id IS NOT NULL
  AND ar.branch_id IS DISTINCT FROM p.branch_id;

-- 3. customer_signatures --------------------------------------

CREATE OR REPLACE FUNCTION public.set_customer_signatures_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_branch_id uuid;
  v_user_branch_id uuid;
BEGIN
  IF NEW.branch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- customer_signatures.client_id is NOT NULL by schema.
  IF NEW.client_id IS NOT NULL THEN
    SELECT branch_id INTO v_client_branch_id
    FROM public.clients WHERE id = NEW.client_id;
    IF v_client_branch_id IS NOT NULL THEN
      NEW.branch_id := v_client_branch_id;
      RETURN NEW;
    END IF;
  END IF;

  SELECT branch_id INTO v_user_branch_id
  FROM public.profiles WHERE id = auth.uid();
  IF v_user_branch_id IS NOT NULL THEN
    NEW.branch_id := v_user_branch_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_set_branch_id_customer_signatures ON public.customer_signatures;
DROP TRIGGER IF EXISTS set_customer_signatures_branch_id_trigger ON public.customer_signatures;
CREATE TRIGGER set_customer_signatures_branch_id_trigger
  BEFORE INSERT ON public.customer_signatures
  FOR EACH ROW
  EXECUTE FUNCTION public.set_customer_signatures_branch_id();

UPDATE public.customer_signatures cs
SET branch_id = c.branch_id
FROM public.clients c
WHERE cs.client_id = c.id
  AND c.branch_id IS NOT NULL
  AND cs.branch_id IS DISTINCT FROM c.branch_id;

-- 4. sms_logs -------------------------------------------------
--
-- sms_logs already has sms_logs_fill_agent_id_trg (migration
-- 20260415140000) which resolves branch_id from client_id /
-- policy_id when not pre-set. The generic auto_set_branch_id
-- trigger fires alphabetically first and stamps the inserter's
-- branch, making the parent-derivation in fill_agent_id
-- unreachable. Drop the generic trigger; the existing one
-- handles it correctly.
DROP TRIGGER IF EXISTS auto_set_branch_id_sms_logs ON public.sms_logs;

-- Backfill: match the priority order in sms_logs_fill_agent_id_trg
-- — client_id wins over policy_id when both are set. (In practice
-- client and policy carry the same branch since policies derive
-- branch from their client, so they usually agree.)
WITH derived AS (
  SELECT sl.id,
         COALESCE(c.branch_id, p.branch_id) AS parent_branch_id
  FROM public.sms_logs sl
  LEFT JOIN public.policies p ON p.id = sl.policy_id
  LEFT JOIN public.clients c ON c.id = sl.client_id
)
UPDATE public.sms_logs sl
SET branch_id = d.parent_branch_id
FROM derived d
WHERE sl.id = d.id
  AND d.parent_branch_id IS NOT NULL
  AND sl.branch_id IS DISTINCT FROM d.parent_branch_id;
