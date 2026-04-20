// Pick the single document_number that represents a package (or a
// standalone policy) across every surface — card chip, payments log,
// printed invoice, printed report. Without this, each surface was
// walking its own input array and picking a different member's number,
// so the same معاملة showed three different رقم المعاملة values
// depending on where you looked.
//
// Priority mirrors how the business thinks about "which بوليصة *is*
// the package": THIRD_FULL (شامل / ثالث) wins over ELZAMI wins over
// addons (خدمات طريق / إعفاء رسوم). Ties break on the smallest
// document_number so behavior is deterministic within a tier.
const MAIN_TYPE_PRIORITY: Record<string, number> = {
  THIRD_FULL: 0,
  ELZAMI: 1,
};

type Entry = {
  document_number?: string | null;
  policy_type_parent?: string | null;
};

export function pickPackageDocumentNumber(policies: Entry[]): string | null {
  const stamped = policies
    .filter((p): p is Entry & { document_number: string } =>
      typeof p.document_number === 'string' && p.document_number.trim().length > 0,
    )
    .map(p => ({
      doc: p.document_number.trim(),
      rank: MAIN_TYPE_PRIORITY[p.policy_type_parent ?? ''] ?? 99,
    }));
  if (stamped.length === 0) return null;
  stamped.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.doc.localeCompare(b.doc, 'en', { numeric: true });
  });
  return stamped[0].doc;
}
