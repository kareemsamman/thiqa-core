-- Add column to store edited field positions and custom text
ALTER TABLE public.accident_reports 
ADD COLUMN IF NOT EXISTS edited_fields_json JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.accident_reports.edited_fields_json IS 'Stores user-edited field positions, text content, and custom fields for the accident report HTML view';