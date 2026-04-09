-- Create tasks table for daily task management
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  
  -- People
  created_by uuid NOT NULL REFERENCES profiles(id),
  assigned_to uuid NOT NULL REFERENCES profiles(id),
  
  -- Timing
  due_date date NOT NULL,
  due_time time NOT NULL,
  
  -- Status
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at timestamp with time zone,
  completed_by uuid REFERENCES profiles(id),
  
  -- Reminder
  reminder_shown boolean DEFAULT false,
  
  -- Branch
  branch_id uuid REFERENCES branches(id),
  
  -- Tracking
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their tasks"
  ON public.tasks FOR SELECT
  USING (
    is_active_user(auth.uid()) AND 
    (assigned_to = auth.uid() OR created_by = auth.uid() OR has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "Users can create tasks"
  ON public.tasks FOR INSERT
  WITH CHECK (is_active_user(auth.uid()));

CREATE POLICY "Users can update their assigned tasks"
  ON public.tasks FOR UPDATE
  USING (
    is_active_user(auth.uid()) AND 
    (assigned_to = auth.uid() OR created_by = auth.uid() OR has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "Task creators can delete"
  ON public.tasks FOR DELETE
  USING (
    is_active_user(auth.uid()) AND 
    (created_by = auth.uid() OR has_role(auth.uid(), 'admin'))
  );

-- Performance indexes
CREATE INDEX idx_tasks_assigned_to ON public.tasks(assigned_to);
CREATE INDEX idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_created_by ON public.tasks(created_by);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;