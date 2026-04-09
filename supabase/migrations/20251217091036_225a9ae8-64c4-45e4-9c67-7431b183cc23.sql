-- Create media_files table
CREATE TABLE public.media_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  cdn_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  entity_type TEXT, -- 'client', 'car', 'policy', 'cheque', etc.
  entity_id UUID,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE -- soft delete
);

-- Enable RLS
ALTER TABLE public.media_files ENABLE ROW LEVEL SECURITY;

-- Active users can view non-deleted media
CREATE POLICY "Active users can view media"
ON public.media_files
FOR SELECT
USING (is_active_user(auth.uid()) AND deleted_at IS NULL);

-- Active users can upload media
CREATE POLICY "Active users can upload media"
ON public.media_files
FOR INSERT
WITH CHECK (is_active_user(auth.uid()) AND uploaded_by = auth.uid());

-- Active users can soft delete their own media, admins can delete any
CREATE POLICY "Users can soft delete own media"
ON public.media_files
FOR UPDATE
USING (is_active_user(auth.uid()) AND (uploaded_by = auth.uid() OR has_role(auth.uid(), 'admin')));

-- Create indexes for performance
CREATE INDEX idx_media_files_entity ON public.media_files(entity_type, entity_id);
CREATE INDEX idx_media_files_uploaded_by ON public.media_files(uploaded_by);
CREATE INDEX idx_media_files_created_at ON public.media_files(created_at DESC);
CREATE INDEX idx_media_files_mime_type ON public.media_files(mime_type);