-- Create client_notes table for tracking follow-up interactions
CREATE TABLE public.client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES profiles(id),
  branch_id uuid REFERENCES branches(id)
);

-- Indexes for performance
CREATE INDEX idx_client_notes_client ON client_notes(client_id);
CREATE INDEX idx_client_notes_created ON client_notes(created_at DESC);

-- Enable RLS
ALTER TABLE client_notes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "client_notes_select" ON client_notes
  FOR SELECT TO authenticated
  USING (can_access_branch(auth.uid(), branch_id));

CREATE POLICY "client_notes_insert" ON client_notes
  FOR INSERT TO authenticated
  WITH CHECK (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "client_notes_delete" ON client_notes
  FOR DELETE TO authenticated
  USING (is_super_admin(auth.uid()) OR created_by = auth.uid());