-- ============================================================
-- Fix: policy_payments.branch_id should follow the parent policy,
-- not the person who recorded the payment.
--
-- Bug:
--   The legacy trigger set_payment_branch_id (migration
--   20260128130938) populated policy_payments.branch_id from the
--   inserting user's profile.branch_id. That's wrong — a payment
--   for a Branch A policy doesn't change branches just because the
--   payment was typed in by a worker in Branch B (or by a global
--   admin with no branch set, who'd leave it NULL).
--
--   Symptom on Cheques / Receipts: a global admin picks "Branch A"
--   in the new branch filter and sees nothing (or the wrong rows),
--   because the underlying policy_payments rows carry the inserter's
--   branch, not the policy's.
--
-- Fix:
--   1. Rewrite set_payment_branch_id to derive branch_id from the
--      parent policies row first, falling back to the inserter's
--      profile only when the policy itself has no branch (legacy
--      data). New behavior: the payment lives where the policy lives.
--   2. Backfill every existing payment whose branch_id disagrees
--      with its policy.
--   3. Re-sync the auto-generated receipts whose branch_id is now
--      out of date because of (2).
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_payment_branch_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy_branch_id uuid;
  v_user_branch_id uuid;
BEGIN
  -- Caller already passed an explicit branch — respect it.
  IF NEW.branch_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Primary source: the parent policy's branch. This is what
  -- "branch of this payment" should mean — the payment belongs to
  -- whichever branch is collecting on the policy, regardless of who
  -- typed in the row.
  IF NEW.policy_id IS NOT NULL THEN
    SELECT branch_id INTO v_policy_branch_id
    FROM public.policies
    WHERE id = NEW.policy_id;
    IF v_policy_branch_id IS NOT NULL THEN
      NEW.branch_id := v_policy_branch_id;
      RETURN NEW;
    END IF;
  END IF;

  -- Fall back to the inserter's branch only when the policy itself
  -- has no branch_id (legacy data or admin-created agency-wide
  -- policies). Keeps the worker UX from before — a worker entering
  -- a payment for a NULL-branch policy will at least scope it to
  -- their own branch.
  SELECT branch_id INTO v_user_branch_id
  FROM public.profiles
  WHERE id = auth.uid();
  IF v_user_branch_id IS NOT NULL THEN
    NEW.branch_id := v_user_branch_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger registration is unchanged from 20260128130938 — replace in
-- place so the rewritten function is what fires on every INSERT.
DROP TRIGGER IF EXISTS set_payment_branch_id_trigger ON public.policy_payments;
CREATE TRIGGER set_payment_branch_id_trigger
  BEFORE INSERT ON public.policy_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_payment_branch_id();

-- Backfill: every payment whose branch_id disagrees with its policy
-- gets corrected to the policy's branch. Skip rows where the policy
-- has no branch_id of its own (nothing to align to). Skip rows whose
-- branch_id already matches.
--
-- The validate_policy_payment_total trigger fires on UPDATE and
-- recomputes a sum; disable it for this scoped backfill so a stale
-- aggregation can't block the realignment.
ALTER TABLE public.policy_payments DISABLE TRIGGER trg_validate_policy_payment_total;

UPDATE public.policy_payments AS pp
SET branch_id = p.branch_id
FROM public.policies AS p
WHERE pp.policy_id = p.id
  AND p.branch_id IS NOT NULL
  AND pp.branch_id IS DISTINCT FROM p.branch_id;

ALTER TABLE public.policy_payments ENABLE TRIGGER trg_validate_policy_payment_total;

-- Re-sync auto-generated receipts (source = 'auto') so their
-- branch_id matches the policy / corrected payment. Manually-entered
-- receipts (source = 'manual') stay untouched — those carry their own
-- branch_id whatever the admin set on creation.
UPDATE public.receipts AS r
SET branch_id = COALESCE(p.branch_id, pp.branch_id)
FROM public.policy_payments AS pp
JOIN public.policies AS p ON p.id = pp.policy_id
WHERE r.source = 'auto'
  AND r.payment_id = pp.id
  AND r.branch_id IS DISTINCT FROM COALESCE(p.branch_id, pp.branch_id);
