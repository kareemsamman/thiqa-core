-- Create user_sessions table
CREATE TABLE public.user_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  duration_minutes integer GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (ended_at - started_at)) / 60
    ELSE NULL END
  ) STORED,
  ip_address text,
  user_agent text,
  browser_name text,
  browser_version text,
  os_name text,
  device_type text,
  country text,
  city text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS - Admin only
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view user sessions"
  ON public.user_sessions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR auth.jwt() ->> 'email' = 'morshed500@gmail.com');

-- Indexes for performance
CREATE INDEX idx_user_sessions_user ON public.user_sessions(user_id);
CREATE INDEX idx_user_sessions_started ON public.user_sessions(started_at DESC);
CREATE INDEX idx_user_sessions_active ON public.user_sessions(is_active) WHERE is_active = true;