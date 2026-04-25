import type { Enums } from '@/integrations/supabase/types';

/**
 * One row in the accounting issuances table = one معاملة.
 *
 * A معاملة can be:
 *   - a standalone policy (group_id = null) — sub_policies has length 1
 *   - a package (group_id != null) — sub_policies has all rows sharing
 *     that group_id, with `main` set to the highest-priority sub-policy
 *     per `pickPackageDocumentNumber`'s tier order.
 *
 * Aggregated numeric fields (insurance_price, payed_for_company,
 * profit, office_commission, broker_buy_price, receipts_*) are summed
 * across `sub_policies`. Non-aggregated fields (client, car, company,
 * dates) are read off the `main` sub-policy since they're shared
 * within a group.
 */
export interface SubPolicy {
  id: string;
  policy_number: string | null;
  document_number: string | null;
  issue_date: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  payed_for_company: number | null;
  profit: number | null;
  office_commission: number | null;
  broker_buy_price: number | null;
  policy_type_parent: Enums<'policy_type_parent'>;
  policy_type_child: Enums<'policy_type_child'> | null;
  cancelled: boolean | null;
  is_under_24: boolean | null;
  car_id: string | null;
  car_number: string | null;
  car_type: Enums<'car_type'> | null;
  car_value: number | null;
  car_year: number | null;
  company_id: string | null;
  company_name: string | null;
  broker_id: string | null;
  group_id: string | null;
}

export interface IssuanceRow {
  /** Stable id — group_id when grouped, sub-policy id otherwise. */
  id: string;
  /** Number that maps to the معاملة (e.g. "30/2026"). Read-only. */
  document_number: string | null;
  /** Client name — shared within a group. */
  client_name: string | null;
  /** All policies in this معاملة (1 for single, N for package). */
  sub_policies: SubPolicy[];
  /** The sub-policy whose values represent the معاملة as a whole. */
  main: SubPolicy;
  /** Convenience flag — single edits land on `main.id` directly. */
  is_grouped: boolean;
  /** Aggregates. */
  insurance_price: number;
  payed_for_company: number;
  profit: number;
  office_commission: number;
  broker_buy_price: number;
  receipts_count: number;
  receipts_total: number;
  primary_payment_method: string | null;
}

export const POLICY_TYPE_DISPLAY: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD: 'ثالث',
  FULL: 'شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء حوادث',
  HEALTH: 'صحي',
};

export function policyTypeKey(parent: string, child: string | null): string {
  if (parent === 'THIRD_FULL' && child) return child;
  return parent;
}

export function policyTypeLabel(parent: string, child: string | null): string {
  return POLICY_TYPE_DISPLAY[policyTypeKey(parent, child)] ?? parent;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  transfer: 'تحويل بنكي',
  visa: 'فيزا',
  customer_cheque: 'شيك عميل',
};

const MAIN_TYPE_PRIORITY: Record<string, number> = {
  THIRD_FULL: 0,
  ELZAMI: 1,
};

/** Pick the lead sub-policy of a group (mirrors pickPackageDocumentNumber's tiering). */
export function pickMainSubPolicy(subs: SubPolicy[]): SubPolicy {
  return [...subs].sort((a, b) => {
    const ra = MAIN_TYPE_PRIORITY[a.policy_type_parent] ?? 99;
    const rb = MAIN_TYPE_PRIORITY[b.policy_type_parent] ?? 99;
    if (ra !== rb) return ra - rb;
    const da = a.document_number ?? '';
    const db = b.document_number ?? '';
    return da.localeCompare(db, 'en', { numeric: true });
  })[0];
}
