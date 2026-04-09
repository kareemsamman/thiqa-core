
-- xservice_settings (singleton)
CREATE TABLE public.xservice_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  api_url text NOT NULL DEFAULT '',
  api_key text NOT NULL DEFAULT '',
  agent_name text NOT NULL DEFAULT 'AB',
  xservice_agent_id uuid,
  is_enabled boolean NOT NULL DEFAULT false,
  sync_road_service boolean NOT NULL DEFAULT true,
  sync_accident_fee boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert default singleton row
INSERT INTO public.xservice_settings (id) VALUES (gen_random_uuid());

ALTER TABLE public.xservice_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read xservice_settings"
  ON public.xservice_settings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Only admins can update xservice_settings"
  ON public.xservice_settings FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- xservice_sync_log
CREATE TABLE public.xservice_sync_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id uuid NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  xservice_policy_id text,
  error_message text,
  request_payload jsonb NOT NULL DEFAULT '{}',
  response_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  retried_at timestamptz
);

CREATE INDEX idx_xservice_sync_log_policy ON public.xservice_sync_log(policy_id);
CREATE INDEX idx_xservice_sync_log_status ON public.xservice_sync_log(status);

ALTER TABLE public.xservice_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read xservice_sync_log"
  ON public.xservice_sync_log FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can insert xservice_sync_log"
  ON public.xservice_sync_log FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update xservice_sync_log"
  ON public.xservice_sync_log FOR UPDATE
  USING (true);
