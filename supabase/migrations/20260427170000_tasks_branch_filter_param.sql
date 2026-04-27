-- ============================================================
-- Add p_branch_id parameter to get_tasks_with_users_and_pending
--
-- The Tasks page is the last operational nav page that didn't
-- expose a branch filter to admins. Workers were already scoped
-- via the branch_isolation RLS policy on the tasks table (added
-- by 20260426150000), but admins — who legitimately see every
-- branch — had no way to narrow the view to a single branch
-- when triaging.
--
-- Mirrors the parameter shape used by every other RPC the agent
-- app calls from a branch-filtered page (see
-- 20260427130000_branch_filter_param_on_rpcs.sql):
--   p_branch_id IS NULL     → no extra filter (worker scope via
--                              branch_isolation still applies)
--   p_branch_id IS NOT NULL → narrows the result to that branch
--                             on top of the existing scope. A
--                             worker who somehow passes another
--                             branch's id gets nothing back.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_tasks_with_users_and_pending(date);

CREATE OR REPLACE FUNCTION public.get_tasks_with_users_and_pending(
  target_date date,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  created_by uuid,
  assigned_to uuid,
  due_date date,
  due_time time,
  status text,
  reminder_shown boolean,
  completed_at timestamptz,
  completed_by uuid,
  branch_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_id uuid,
  creator_full_name text,
  creator_email text,
  assignee_id uuid,
  assignee_full_name text,
  assignee_email text,
  is_overdue boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.title, t.description, t.created_by, t.assigned_to,
    t.due_date, t.due_time, t.status::text, t.reminder_shown,
    t.completed_at, t.completed_by, t.branch_id, t.created_at, t.updated_at,
    c.id AS creator_id, c.full_name AS creator_full_name, c.email AS creator_email,
    a.id AS assignee_id, a.full_name AS assignee_full_name, a.email AS assignee_email,
    (t.due_date < target_date AND t.status = 'pending') AS is_overdue
  FROM public.tasks t
  LEFT JOIN public.profiles c ON t.created_by = c.id
  LEFT JOIN public.profiles a ON t.assigned_to = a.id
  WHERE
    (
      -- Tasks for the selected date (any status)
      t.due_date = target_date
      OR
      -- Pending tasks from previous days (overdue)
      (t.due_date < target_date AND t.status = 'pending')
    )
    AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
  ORDER BY
    -- Show overdue tasks first, then by date and time
    CASE WHEN t.due_date < target_date AND t.status = 'pending' THEN 0 ELSE 1 END,
    t.due_date ASC,
    t.due_time ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tasks_with_users_and_pending(date, uuid) TO authenticated;
