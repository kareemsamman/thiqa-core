CREATE POLICY "Authenticated users can insert platform settings"
  ON public.thiqa_platform_settings
  FOR INSERT TO authenticated
  WITH CHECK (true);