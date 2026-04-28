/**
 * billingCycle.ts
 * ================
 * Helpers for displaying agent prices and period labels correctly across
 * monthly and yearly subscriptions. The DB stores `agents.monthly_price`
 * as the per-month rate even for yearly subscribers (so per-month displays
 * keep working); yearly subscribers actually pay `monthly_price × 12`
 * upfront once per year, with `subscription_expires_at` set 1 year out.
 *
 * Use these helpers anywhere we render a price or period — never
 * hardcode "/شهر" or "اشتراك شهري" in JSX again.
 */

export type BillingCycle = 'monthly' | 'yearly';

/**
 * Convert a monthly rate into the actual amount billed per cycle.
 * Yearly cycles pay the monthly rate × 12 once per year.
 */
export function getCycleAmount(
  monthlyPrice: number | null | undefined,
  cycle: BillingCycle | null | undefined,
): number {
  const m = Number(monthlyPrice ?? 0);
  return cycle === 'yearly' ? m * 12 : m;
}

/**
 * Arabic labels for the cycle. `null`/`undefined` defaults to monthly.
 */
export function getCycleLabels(cycle: BillingCycle | null | undefined) {
  const isYearly = cycle === 'yearly';
  return {
    isYearly,
    /** Short suffix after a price, e.g. "₪3,300 / سنة" */
    suffix: isYearly ? '/ سنة' : '/ شهر',
    /** Adverb form, e.g. "₪3,300 سنوياً" */
    adverb: isYearly ? 'سنوياً' : 'شهرياً',
    /** Full subscription label, e.g. "اشتراك سنوي" */
    subscriptionLabel: isYearly ? 'اشتراك سنوي' : 'اشتراك شهري',
    /** Cost-tile title, e.g. "التكلفة السنوية" */
    costTitle: isYearly ? 'التكلفة السنوية' : 'التكلفة الشهرية',
    /** Price-row title, e.g. "السعر السنوي" */
    priceTitle: isYearly ? 'السعر السنوي' : 'السعر الشهري',
    /** Period length in days — the renewal denominator for progress bars. */
    periodDays: isYearly ? 365 : 30,
  };
}
