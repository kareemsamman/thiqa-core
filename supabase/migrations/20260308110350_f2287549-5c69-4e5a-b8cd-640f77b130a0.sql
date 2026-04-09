
CREATE TABLE public.thiqa_platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  setting_value text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.thiqa_platform_settings ENABLE ROW LEVEL SECURITY;

-- Super admins access via service role; also allow authenticated read for the edge function fallback
CREATE POLICY "Authenticated users can read platform settings"
  ON public.thiqa_platform_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can update platform settings"
  ON public.thiqa_platform_settings FOR UPDATE TO authenticated USING (true);

INSERT INTO public.thiqa_platform_settings (setting_key, setting_value) VALUES
  ('smtp_host', 'smtp.hostinger.com'),
  ('smtp_port', '465'),
  ('smtp_user', ''),
  ('smtp_password', ''),
  ('smtp_sender_name', 'Thiqa Insurance');
