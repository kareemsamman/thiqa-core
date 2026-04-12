-- Ensure the `branding` storage bucket and its policies exist in
-- production. The original migration 20260217103905 declared them but
-- the bucket never made it into the live project (same failure mode as
-- the usage limits tables), so uploading a site logo from the admin
-- branding settings screen always failed with "Bucket not found".

INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Public read access for branding" ON storage.objects;
CREATE POLICY "Public read access for branding"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

DROP POLICY IF EXISTS "Authenticated users can upload branding" ON storage.objects;
CREATE POLICY "Authenticated users can upload branding"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'branding' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can update branding" ON storage.objects;
CREATE POLICY "Authenticated users can update branding"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'branding' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can delete branding" ON storage.objects;
CREATE POLICY "Authenticated users can delete branding"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'branding' AND auth.uid() IS NOT NULL);

NOTIFY pgrst, 'reload schema';
