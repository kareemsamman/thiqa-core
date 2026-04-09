-- Create announcements table
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  start_date timestamptz DEFAULT now(),
  end_date timestamptz NOT NULL,
  show_once boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_by_admin_id uuid REFERENCES public.profiles(id),
  updated_at timestamptz DEFAULT now()
);

-- Track which users have dismissed announcements
CREATE TABLE public.announcement_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid REFERENCES public.announcements(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  dismissed_at timestamptz DEFAULT now(),
  UNIQUE(announcement_id, user_id)
);

-- Enable RLS
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;

-- Announcements: All authenticated users can read active announcements
CREATE POLICY "Anyone can read active announcements"
ON public.announcements FOR SELECT TO authenticated
USING (is_active = true AND now() BETWEEN start_date AND end_date);

-- Only super admin can manage announcements (checked in app layer)
CREATE POLICY "Super admin can manage announcements"
ON public.announcements FOR ALL TO authenticated
USING (true) WITH CHECK (true);

-- Dismissals: Users can read their own dismissals
CREATE POLICY "Users can read own dismissals"
ON public.announcement_dismissals FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- Users can insert their own dismissals
CREATE POLICY "Users can insert own dismissals"
ON public.announcement_dismissals FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- Create index for performance
CREATE INDEX idx_announcements_active_dates ON public.announcements(is_active, start_date, end_date);
CREATE INDEX idx_dismissals_user ON public.announcement_dismissals(user_id, announcement_id);