// Shared payment-method label helpers so every surface (tables, dialogs,
// invoices, receipts) renders the same human-readable text for the same
// underlying policy_payments row.
//
// Special case: ELZAMI premiums are paid directly on the insurance
// company's portal with the customer's own card — the money never passes
// through the agency till. We store those rows with payment_type = 'visa'
// and locked = true (see applyElzamiPaymentLogic in PolicyWizard), and
// render them as "فيزا خارجي" so staff know it's an external charge.

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  visa: 'فيزا',
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
