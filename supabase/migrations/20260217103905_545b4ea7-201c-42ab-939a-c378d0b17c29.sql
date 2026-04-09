
-- Create site_settings table (singleton pattern)
CREATE TABLE public.site_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_title text NOT NULL DEFAULT 'AB تأمين',
  site_description text NOT NULL DEFAULT 'نظام إدارة وكيل التأمين',
  logo_url text,
  favicon_url text,
  og_image_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Insert default row
INSERT INTO public.site_settings (site_title, site_description) 
VALUES ('AB تأمين', 'نظام إدارة شامل لوكيل التأمين - إدارة العملاء، السيارات، الوثائق، والمدفوعات');

-- Enable RLS
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read
CREATE POLICY "Anyone can read site settings"
  ON public.site_settings FOR SELECT
  USING (true);

-- Only authenticated users can update (admin check done in app)
CREATE POLICY "Authenticated users can update site settings"
  ON public.site_settings FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Create branding storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('branding', 'branding', true);

-- Public read access
CREATE POLICY "Public read access for branding"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

-- Authenticated users can upload
CREATE POLICY "Authenticated users can upload branding"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'branding' AND auth.uid() IS NOT NULL);

-- Authenticated users can update
CREATE POLICY "Authenticated users can update branding"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'branding' AND auth.uid() IS NOT NULL);

-- Authenticated users can delete
CREATE POLICY "Authenticated users can delete branding"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'branding' AND auth.uid() IS NOT NULL);
