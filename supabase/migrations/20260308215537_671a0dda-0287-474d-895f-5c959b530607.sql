
CREATE TABLE public.site_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  page text,
  referrer text,
  user_agent text,
  country text,
  session_id text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_site_analytics_event_type ON public.site_analytics_events (event_type);
CREATE INDEX idx_site_analytics_created_at ON public.site_analytics_events (created_at);

ALTER TABLE public.site_analytics_events ENABLE ROW LEVEL SECURITY;

-- Public insert (anonymous visitors can track)
CREATE POLICY "Anyone can insert analytics events"
  ON public.site_analytics_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only super admins can read
CREATE POLICY "Super admins can read analytics"
  ON public.site_analytics_events FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));
