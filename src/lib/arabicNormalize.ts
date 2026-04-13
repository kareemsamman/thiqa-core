// Client-side mirror of the DB `public.normalize_arabic` function so that
// search queries hitting columns like clients.full_name_normalized apply
// the same folding on the input before sending.
//
// Folding rules (must stay in sync with the SQL function):
//   أ إ آ → ا
//   ى     → ي
//   ؤ     → و
//   ئ     → ي
//   ة     → ه
//   ـ (tatweel) → space
//   lowercase, collapse whitespace

const FOLD_MAP: Record<string, string> = {
  "\u0623": "\u0627", // أ
  "\u0625": "\u0627", // إ
  "\u0622": "\u0627", // آ
  "\u0649": "\u064A", // ى → ي
  "\u0624": "\u0648", // ؤ → و
  "\u0626": "\u064A", // ئ → ي
  "\u0629": "\u0647", // ة → ه
  "\u0640": " ",       // ـ → space
};

export function normalizeArabic(input: string | null | undefined): string {
  if (!input) return "";
  let out = "";
  for (const ch of input.toLowerCase()) {
    out += FOLD_MAP[ch] ?? ch;
  }
  return out.replace(/\s+/g, " ").trim();
}
