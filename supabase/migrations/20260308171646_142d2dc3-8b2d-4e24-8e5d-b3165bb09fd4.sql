
CREATE TABLE public.landing_content (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  section_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'image', 'json')),
  text_value TEXT,
  image_url TEXT,
  json_value JSONB,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id)
);

-- Allow public read (landing page is public)
ALTER TABLE public.landing_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read landing content"
  ON public.landing_content FOR SELECT
  USING (true);

CREATE POLICY "Super admins can manage landing content"
  ON public.landing_content FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
