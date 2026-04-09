-- Create correspondence_letters table for admin letters/correspondence
CREATE TABLE correspondence_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT,
  body_html TEXT,
  generated_url TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed')),
  sent_at TIMESTAMPTZ,
  created_by_admin_id UUID REFERENCES profiles(id),
  branch_id UUID REFERENCES branches(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE correspondence_letters ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can manage correspondence letters
CREATE POLICY "Admins can manage correspondence" ON correspondence_letters
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- Index for quick lookups
CREATE INDEX idx_correspondence_status ON correspondence_letters(status);
CREATE INDEX idx_correspondence_created_at ON correspondence_letters(created_at DESC);
CREATE INDEX idx_correspondence_branch ON correspondence_letters(branch_id);

-- Trigger to update updated_at
CREATE TRIGGER update_correspondence_letters_updated_at
  BEFORE UPDATE ON correspondence_letters
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();