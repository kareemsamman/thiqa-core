/**
 * Registry of Israeli and Palestinian banks used on cheque inputs / displays.
 *
 * Cheque numbers don't encode the issuing bank — that information lives on
 * the MICR line alongside the branch code. We store `bank_code` (IL: 2
 * digits) and `branch_code` (typically 3 digits) as separate columns on
 * every cheque-bearing table, then resolve the display name via this map.
 *
 * Source: Bank of Israel registry of banks operating in Israel/PA. Codes
 * are the ones printed on the MICR line at the bottom of the cheque.
 * `country: 'IL' | 'PS'` lets the cheque picker group IL banks above PA
 * banks so the dropdown doesn't feel random.
 */

export type BankCountry = "IL" | "PS";

export interface BankRecord {
  /** MICR bank code (IL: 2 digits, PA: issued by PMA). */
  code: string;
  /** Arabic display name — preferred in the app. */
  nameAr: string;
  /** English/Hebrew name for tooltips and internal logs. */
  nameEn: string;
  country: BankCountry;
}

// Order within each country doesn't matter — the picker sorts alphabetically
// by `nameAr`. New banks can be appended without touching call sites.
export const BANKS: BankRecord[] = [
  // ── Israeli banks ──
  { code: "04", nameAr: "بنك يهاف",                      nameEn: "Bank Yahav",                country: "IL" },
  { code: "09", nameAr: "بنك البريد",                    nameEn: "Israel Postal Bank",        country: "IL" },
  { code: "10", nameAr: "بنك لئومي",                     nameEn: "Bank Leumi",                country: "IL" },
  { code: "11", nameAr: "بنك دسكونت",                    nameEn: "Discount Bank",             country: "IL" },
  { code: "12", nameAr: "بنك هبوعليم",                   nameEn: "Bank Hapoalim",             country: "IL" },
  { code: "13", nameAr: "بنك إيغود",                     nameEn: "Union Bank of Israel",      country: "IL" },
  { code: "14", nameAr: "بنك أوتسار هحيال",              nameEn: "Otzar Ha-Hayal",            country: "IL" },
  { code: "17", nameAr: "بنك مركنتيل دسكونت",            nameEn: "Mercantile Discount Bank",  country: "IL" },
  { code: "20", nameAr: "بنك مزراحي طفاحوت",             nameEn: "Mizrahi-Tefahot Bank",      country: "IL" },
  { code: "22", nameAr: "سيتي بنك",                      nameEn: "Citibank",                  country: "IL" },
  { code: "23", nameAr: "إتش إس بي سي",                  nameEn: "HSBC",                      country: "IL" },
  { code: "26", nameAr: "يو بنك",                        nameEn: "U-Bank",                    country: "IL" },
  { code: "31", nameAr: "بنك هبوعليم (سابقاً بنك البنك)", nameEn: "Bank of Jerusalem",         country: "IL" },
  { code: "34", nameAr: "بنك أرابيسكا إسرائيل",          nameEn: "Bank Arabisca",             country: "IL" },
  { code: "39", nameAr: "إس بي آي بنك",                  nameEn: "SBI State Bank of India",   country: "IL" },
  { code: "46", nameAr: "بنك ماسّاد",                    nameEn: "Bank Massad",               country: "IL" },
  { code: "52", nameAr: "بنك بوعلي أغوداث إسرائيل",      nameEn: "Bank Poalei Agudat Israel", country: "IL" },
  { code: "54", nameAr: "بنك القدس",                     nameEn: "Bank of Jerusalem",         country: "IL" },
  { code: "59", nameAr: "بنك أ د ك",                     nameEn: "ADK Bank",                  country: "IL" },
  { code: "68", nameAr: "بنك هتعسيا",                    nameEn: "Bank Hateasia",             country: "IL" },

  // ── Palestinian banks (PMA) ──
  { code: "72", nameAr: "بنك فلسطين",                    nameEn: "Bank of Palestine",         country: "PS" },
  { code: "73", nameAr: "البنك الوطني",                  nameEn: "National Bank",             country: "PS" },
  { code: "74", nameAr: "البنك الإسلامي الفلسطيني",      nameEn: "Palestine Islamic Bank",    country: "PS" },
  { code: "75", nameAr: "البنك الإسلامي العربي",         nameEn: "Arab Islamic Bank",         country: "PS" },
  { code: "76", nameAr: "بنك الاستثمار الفلسطيني",       nameEn: "Palestine Investment Bank", country: "PS" },
  { code: "77", nameAr: "البنك التجاري الفلسطيني",       nameEn: "Palestine Commercial Bank", country: "PS" },
  { code: "78", nameAr: "بنك القاهرة عمان",              nameEn: "Cairo Amman Bank",          country: "PS" },
  { code: "79", nameAr: "البنك العربي",                  nameEn: "Arab Bank",                 country: "PS" },
  { code: "80", nameAr: "بنك الأردن",                    nameEn: "Bank of Jordan",            country: "PS" },
  { code: "81", nameAr: "البنك الأهلي الأردني",          nameEn: "Jordan Ahli Bank",          country: "PS" },
  { code: "82", nameAr: "بنك الإسكان للتجارة والتمويل",  nameEn: "Housing Bank",              country: "PS" },
  { code: "83", nameAr: "بنك القدس",                     nameEn: "Al-Quds Bank",              country: "PS" },
  { code: "84", nameAr: "البنك الإسلامي الأردني",        nameEn: "Jordan Islamic Bank",       country: "PS" },
  { code: "85", nameAr: "بنك الصفا",                     nameEn: "Safa Bank",                 country: "PS" },
  { code: "86", nameAr: "بنك سانتدر",                    nameEn: "Santander",                 country: "PS" },
  { code: "87", nameAr: "بنك البركة",                    nameEn: "Al Baraka Bank",            country: "PS" },
  { code: "88", nameAr: "البنك الوطني الإسلامي",         nameEn: "National Islamic Bank",     country: "PS" },
];

// Indexed by code for O(1) lookups at display time.
const BANKS_BY_CODE = new Map<string, BankRecord>(
  BANKS.map((b) => [b.code, b]),
);

/** Resolve a bank code to its Arabic display name. Unknown codes fall
 *  back to `بنك غير معروف` so the UI never renders a blank. */
export const getBankName = (code: string | null | undefined): string => {
  if (!code) return "";
  return BANKS_BY_CODE.get(code.trim())?.nameAr ?? "";
};

/** Full record lookup — returns `undefined` for unknown codes so callers
 *  can show their own placeholder. */
export const getBank = (code: string | null | undefined): BankRecord | undefined => {
  if (!code) return undefined;
  return BANKS_BY_CODE.get(code.trim());
};

/** Sorted list for dropdowns: IL first (alphabetical), then PS. */
export const BANK_OPTIONS: BankRecord[] = [...BANKS].sort((a, b) => {
  if (a.country !== b.country) return a.country === "IL" ? -1 : 1;
  return a.nameAr.localeCompare(b.nameAr, "ar");
});
