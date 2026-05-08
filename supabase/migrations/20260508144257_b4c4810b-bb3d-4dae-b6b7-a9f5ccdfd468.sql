ALTER TABLE public.media_files
  ADD COLUMN IF NOT EXISTS stream_video_guid text,
  ADD COLUMN IF NOT EXISTS stream_library_id text;

CREATE INDEX IF NOT EXISTS idx_media_files_stream_guid ON public.media_files(stream_video_guid) WHERE stream_video_guid IS NOT NULL;