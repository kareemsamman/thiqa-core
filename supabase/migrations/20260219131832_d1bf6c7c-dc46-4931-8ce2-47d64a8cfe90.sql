
-- Form template folders (nested)
CREATE TABLE public.form_template_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id UUID REFERENCES public.form_template_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Form template files
CREATE TABLE public.form_template_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  folder_id UUID NOT NULL REFERENCES public.form_template_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'image')),
  mime_type TEXT,
  overlay_fields JSONB DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_form_template_folders_parent ON public.form_template_folders(parent_id);
CREATE INDEX idx_form_template_files_folder ON public.form_template_files(folder_id);

-- RLS
ALTER TABLE public.form_template_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_template_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active users can view folders" ON public.form_template_folders
  FOR SELECT USING (is_active_user(auth.uid()));

CREATE POLICY "Active users can manage folders" ON public.form_template_folders
  FOR ALL USING (is_active_user(auth.uid()));

CREATE POLICY "Active users can view files" ON public.form_template_files
  FOR SELECT USING (is_active_user(auth.uid()));

CREATE POLICY "Active users can manage files" ON public.form_template_files
  FOR ALL USING (is_active_user(auth.uid()));

-- Updated_at triggers
CREATE TRIGGER update_form_template_folders_updated_at
  BEFORE UPDATE ON public.form_template_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_form_template_files_updated_at
  BEFORE UPDATE ON public.form_template_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
