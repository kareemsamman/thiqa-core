// Shared category map for "آخر" vouchers (external-party receipts).
//
// Used by:
//   • AddOtherVoucherDialog — populates the التصنيف dropdown
//   • OtherSection (/accounting → آخر) — labels rows + powers the
//     category filter chip strip
//
// Keeping the source-of-truth in one file means the dialog and the
// listing page can never drift on labels. The "other" enum value
// supports free-text categories (the dialog writes whatever the user
// types into اكتب التصنيف into recipient_category), so the helper
// below falls back to the raw value when no canonical match exists.

export interface OtherCategoryOption {
  value: string;
  label: string;
}

export const OTHER_CATEGORY_OPTIONS: OtherCategoryOption[] = [
  { value: 'utility', label: 'كهرباء / ماء / إنترنت / هاتف' },
  { value: 'salary', label: 'راتب / أجر' },
  { value: 'legal', label: 'محامي / رسوم قضائية' },
  { value: 'maintenance', label: 'صيانة / كراج / تنظيف' },
  { value: 'office_supplies', label: 'قرطاسية / طباعة' },
  { value: 'marketing', label: 'إعلانات / تسويق' },
  { value: 'tax_fees', label: 'ضرائب / رسوم رسمية' },
  { value: 'other', label: 'أخرى' },
];

const LABEL_BY_VALUE: Record<string, string> = Object.fromEntries(
  OTHER_CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);

/**
 * Map a stored recipient_category value to its Arabic label.
 *
 * Returns the raw value when it's a free-text custom category (the
 * dialog writes the user's typed text directly to the column when
 * they pick "أخرى"), null when there's no value to label.
 */
export function formatOtherCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return LABEL_BY_VALUE[raw] ?? raw;
}
