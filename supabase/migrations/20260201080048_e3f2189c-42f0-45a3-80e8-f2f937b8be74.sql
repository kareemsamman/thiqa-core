-- Function to get tasks with user information (bypasses RLS for user names)
CREATE OR REPLACE FUNCTION public.get_tasks_with_users(target_date DATE)
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
  assignee_email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    t.id, t.title, t.description, t.created_by, t.assigned_to,
    t.due_date, t.due_time, t.status, t.reminder_shown,
    t.completed_at, t.completed_by, t.branch_id, t.created_at, t.updated_at,
    c.id as creator_id, c.full_name as creator_full_name, c.email as creator_email,
    a.id as assignee_id, a.full_name as assignee_full_name, a.email as assignee_email
  FROM tasks t
  LEFT JOIN profiles c ON t.created_by = c.id
  LEFT JOIN profiles a ON t.assigned_to = a.id
  WHERE t.due_date = target_date
  ORDER BY t.due_time ASC;
$$;