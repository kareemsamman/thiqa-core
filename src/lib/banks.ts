/**
 * Registry of banks and payment institutions used on cheque inputs /
 * displays. Sourced from Bank of Israel's MICR bank-code list (so the
 * codes match what's printed at the bottom of real IL/PS cheques).
 *
 * The UI still stores `bank_code` and `branch_code` as free-text columns,
 * so the picker can accept any 2+ digit value — this list just powers the
 * searchable dropdown and the display-name lookup.
 */

export interface BankRecord {
  /** MICR bank code (typically 2 digits, zero-padded). */
  code: string;
  /** Arabic display name — preferred in the app. */
  nameAr: string;
}

// Full list as-provided. Codes are zero-padded 2-digit strings so they
// sort and compare predictably. Order matches the Bank of Israel list.
export const BANKS: BankRecord[] = [
  { code: "01", nameAr: "ماكس إت فايننشلز" },
  { code: "02", nameAr: "بنك بوعلي أغودات يسرائيل (فاغي)" },
  { code: "04", nameAr: "بنك يهاف" },
  { code: "05", nameAr: "يسراكارت" },
  { code: "06", nameAr: "بنك أدانيم" },
  { code: "07", nameAr: "كال - بطاقات ائتمان لإسرائيل" },
  { code: "08", nameAr: "بنك هسفنوت" },
  { code: "09", nameAr: "بنك البريد" },
  { code: "10", nameAr: "بنك لئومي" },
  { code: "11", nameAr: "بنك ديسكونت" },
  { code: "12", nameAr: "بنك هبوعليم" },
  { code: "13", nameAr: "بنك إيغود" },
  { code: "14", nameAr: "بنك أوتسار هحيال" },
  { code: "17", nameAr: "بنك مركنتيل ديسكونت" },
  { code: "18", nameAr: "وان زيرو - البنك الرقمي الأول" },
  { code: "20", nameAr: "بنك مزراحي طفحوت" },
  { code: "22", nameAr: "سيتي بنك" },
  { code: "23", nameAr: "HSBC" },
  { code: "24", nameAr: "بنك هبوعليم (الأمريكي الإسرائيلي سابقاً)" },
  { code: "25", nameAr: "BNP Paribas إسرائيل" },
  { code: "26", nameAr: "يو بنك" },
  { code: "27", nameAr: "باركليز بنك" },
  { code: "28", nameAr: "هبوعليم (كونتيننتال سابقاً)" },
  { code: "30", nameAr: "البنك للتجارة" },
  { code: "31", nameAr: "البنك الدولي الأول لإسرائيل" },
  { code: "32", nameAr: "بنك للتمويل والتجارة" },
  { code: "33", nameAr: "بنك ديسكونت (مركنتيل سابقاً)" },
  { code: "34", nameAr: "البنك العربي الإسرائيلي" },
  { code: "37", nameAr: "بنك الأردن" },
  { code: "38", nameAr: "البنك التجاري الفلسطيني" },
  { code: "39", nameAr: "بنك الدولة الهندي (SBI)" },
  { code: "43", nameAr: "البنك الأهلي الأردني" },
  { code: "46", nameAr: "بنك مسد" },
  { code: "48", nameAr: "بنك أوتسار هحيال (عوفيد لئومي سابقاً)" },
  { code: "49", nameAr: "البنك العربي" },
  { code: "50", nameAr: "مسب - مركز المقاصة البنكي" },
  { code: "52", nameAr: "بنك بوعلي أغودات يسرائيل (فاغي)" },
  { code: "54", nameAr: "بنك القدس (يروشلايم)" },
  { code: "59", nameAr: "شبا - خدمات بنكية آلية" },
  { code: "60", nameAr: "كاردكوم" },
  { code: "61", nameAr: "ترانزيلا" },
  { code: "65", nameAr: "حيسخ - صندوق توفير للتعليم" },
  { code: "66", nameAr: "بنك القاهرة عمّان" },
  { code: "67", nameAr: "بنك الأراضي العربية" },
  { code: "68", nameAr: "بنك دكسيا / البنك البلدي" },
  { code: "71", nameAr: "البنك التجاري الأردني" },
  { code: "73", nameAr: "البنك الإسلامي العربي" },
  { code: "74", nameAr: "البنك البريطاني للشرق الأوسط" },
  { code: "76", nameAr: "بنك فلسطين للاستثمار" },
  { code: "77", nameAr: "بنك لئومي للرهن العقاري" },
  { code: "82", nameAr: "القدس للتنمية والاستثمار" },
  { code: "83", nameAr: "بنك الاتحاد" },
  { code: "84", nameAr: "بنك الإسكان" },
  { code: "89", nameAr: "بنك فلسطين" },
  { code: "90", nameAr: "بنك ديسكونت للرهن العقاري" },
  { code: "93", nameAr: "بنك الأردن الكويت" },
  { code: "99", nameAr: "بنك إسرائيل (البنك المركزي)" },
];

// Keyed map for O(1) display-name lookups at render time.
const BANKS_BY_CODE = new Map<string, BankRecord>(BANKS.map((b) => [b.code, b]));

/** Normalize any user-entered value to a canonical 2-digit code (trims
 *  whitespace and left-pads single digits). Unknown codes still pass
 *  through — the picker accepts manual entry. */
export const normalizeBankCode = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  // If the user typed a single digit, pad to 2 so "4" matches "04".
  if (/^\d$/.test(trimmed)) return trimmed.padStart(2, "0");
  return trimmed;
};

/** Resolve a stored code to its Arabic name. Returns `""` if unknown so
 *  callers can render the raw code as a fallback. */
export const getBankName = (code: string | null | undefined): string => {
  const norm = normalizeBankCode(code);
  if (!norm) return "";
  return BANKS_BY_CODE.get(norm)?.nameAr ?? "";
};

/** Full record lookup; returns `undefined` for unknown codes. */
export const getBank = (code: string | null | undefined): BankRecord | undefined => {
  const norm = normalizeBankCode(code);
  if (!norm) return undefined;
  return BANKS_BY_CODE.get(norm);
};

/** Sorted list for dropdowns — numeric sort by code so the picker order
 *  matches the Bank of Israel reference list. */
export const BANK_OPTIONS: BankRecord[] = [...BANKS].sort((a, b) => {
  const an = parseInt(a.code, 10);
  const bn = parseInt(b.code, 10);
  return an - bn;
});
