-- Arabic-insensitive search for client names.
--
-- Problem: searching "اسامة" (plain alef) doesn't match stored "أسامة"
-- (alef with hamza above) because ILIKE compares code points. Users
-- rarely type the exact hamza form, so matching has to be tolerant of
-- common Arabic letter variants.
--
-- Fix: a normalize_arabic() function that folds the common variants
-- (أإآ→ا, ى→ي, ؤ→و, ئ→ي, ة→ه, tatweel removed, lowercase, whitespace
-- collapsed). A generated `full_name_normalized` column on clients
-- applies the function at write time; a trigram index makes
-- substring ILIKE against that column fast. Every search input in the
-- app then queries full_name_normalized with a JS-normalized query
-- and the same match falls into place regardless of which hamza form
-- the customer or the user typed.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.normalize_arabic(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    regexp_replace(
      translate(
        lower(coalesce(p_text, '')),
        'أإآىؤئةـ',
        'اااايويه '
      ),
      '\s+', ' ', 'g'
    );
$$;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS full_name_normalized text
  GENERATED ALWAYS AS (public.normalize_arabic(full_name)) STORED;

CREATE INDEX IF NOT EXISTS idx_clients_full_name_normalized_trgm
  ON public.clients USING gin (full_name_normalized gin_trgm_ops);
