// Shared payment-method label helpers so every surface (tables, dialogs,
// invoices, receipts) renders the same human-readable text for the same
// underlying policy_payments row.
//
// "فيزا خارجي" is the customer paying directly on the insurance
// company's portal with their own card — money never passes through
// us. It now has its own enum value (visa_external) so the label is a
// straight map lookup. Older rows that were stored as ('visa' +
// locked=true) were re-stamped to visa_external by the back-fill
// migration 20260504140100; the locked-visa branch in
// getPaymentTypeLabel is kept as a safety net for any straggler.

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  visa: 'فيزا',
  visa_external: 'فيزا خارجي',
  transfer: 'تحويل',
};

export const EXTERNAL_VISA_LABEL = 'فيزا خارجي';

export interface PaymentForLabel {
  payment_type: string;
  locked?: boolean | null;
}

export function getPaymentTypeLabel(p: PaymentForLabel): string {
  if (p.locked && p.payment_type === 'visa') return EXTERNAL_VISA_LABEL;
  return PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type;
}

// Combine label for a batched/grouped row. Uses the external-visa label
// for any locked visa payment in the batch and deduplicates.
export function getCombinedPaymentTypeLabel(payments: PaymentForLabel[]): string {
  const labels = new Set<string>();
  for (const p of payments) labels.add(getPaymentTypeLabel(p));
  return Array.from(labels).join(' + ');
}
