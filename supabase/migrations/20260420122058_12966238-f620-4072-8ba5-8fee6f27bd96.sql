-- 1. Restrict payment_settings SELECT to admins only (protect Tranzila api_password)
DROP POLICY IF EXISTS "agent_data_select_payment_settings" ON public.payment_settings;
DROP POLICY IF EXISTS "Agent users can view payment settings" ON public.payment_settings;
DROP POLICY IF EXISTS "Authenticated users can view payment settings" ON public.payment_settings;

CREATE POLICY "Admins can view payment settings"
ON public.payment_settings
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_super_admin(auth.uid())
);

-- 2. Restrict branding bucket writes to the user's own agent folder
-- File path convention: {agent_id}/...
DROP POLICY IF EXISTS "Authenticated users can upload branding" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update branding" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete branding" ON storage.objects;

CREATE POLICY "Agent admins can upload to own branding folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'branding'
  AND (
    public.is_super_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'admin'::app_role)
      AND (storage.foldername(name))[1] = (
        SELECT au.agent_id::text FROM public.agent_users au WHERE au.user_id = auth.uid() LIMIT 1
      )
    )
  )
);

CREATE POLICY "Agent admins can update own branding folder"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'branding'
  AND (
    public.is_super_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'admin'::app_role)
      AND (storage.foldername(name))[1] = (
        SELECT au.agent_id::text FROM public.agent_users au WHERE au.user_id = auth.uid() LIMIT 1
      )
    )
  )
);

CREATE POLICY "Agent admins can delete own branding folder"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'branding'
  AND (
    public.is_super_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'admin'::app_role)
      AND (storage.foldername(name))[1] = (
        SELECT au.agent_id::text FROM public.agent_users au WHERE au.user_id = auth.uid() LIMIT 1
      )
    )
  )
);