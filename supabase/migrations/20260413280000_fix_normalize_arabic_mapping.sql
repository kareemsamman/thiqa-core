-- Fix normalize_arabic: the previous TRANSLATE target string had one extra
-- ا at the front, which shifted every subsequent mapping by one position.
-- Observed symptom: normalize_arabic('أسامة') returned 'اسامي' instead of
-- 'اسامه', because ة was reaching position 8 of the target where ي lived.
--
-- Correct mapping (source length = target length = 8):
--   أ → ا
--   إ → ا
--   آ → ا
--   ى → ي
--   ؤ → و
--   ئ → ي
--   ة → ه
--   ـ → ' '  (tatweel, collapsed to space then squashed by regexp_replace)

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
        'ااايويه '
      ),
      '\s+', ' ', 'g'
    );
$$;

-- The generated column on public.clients has cached the bad values.
-- Postgres re-evaluates GENERATED ALWAYS columns only on row UPDATE, not
-- when the underlying function body changes, so force a rewrite.
UPDATE public.clients
   SET full_name = full_name
 WHERE full_name IS NOT NULL;
