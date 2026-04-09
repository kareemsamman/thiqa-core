-- Create or replace function to get tasks with pending from previous days
CREATE OR REPLACE FUNCTION get_tasks_with_users_and_pending(target_date DATE)
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  created_by UUID,
  assigned_to UUID,
  due_date DATE,
  due_time TIME,
  status TEXT,
  reminder_shown BOOLEAN,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  branch_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  creator_id UUID,
  creator_full_name TEXT,
  creator_email TEXT,
  assignee_id UUID,
  assignee_full_name TEXT,
  assignee_email TEXT,
  is_overdue BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id, t.title, t.description, t.created_by, t.assigned_to,
    t.due_date, t.due_time, t.status::TEXT, t.reminder_shown,
    t.completed_at, t.completed_by, t.branch_id, t.created_at, t.updated_at,
    c.id as creator_id, c.full_name as creator_full_name, c.email as creator_email,
    a.id as assignee_id, a.full_name as assignee_full_name, a.email as assignee_email,
    (t.due_date < target_date AND t.status = 'pending') as is_overdue
  FROM tasks t
  LEFT JOIN profiles c ON t.created_by = c.id
  LEFT JOIN profiles a ON t.assigned_to = a.id
  WHERE 
    -- Tasks for the selected date (any status)
    t.due_date = target_date
    OR
    -- Pending tasks from previous days (overdue)
    (t.due_date < target_date AND t.status = 'pending')
  ORDER BY 
    -- Show overdue tasks first, then by date and time
    CASE WHEN t.due_date < target_date AND t.status = 'pending' THEN 0 ELSE 1 END,
    t.due_date ASC,
    t.due_time ASC;
END;
$$;