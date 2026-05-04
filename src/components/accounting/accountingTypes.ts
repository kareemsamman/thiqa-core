import type { Enums } from '@/integrations/supabase/types';

/** Direction of a broker policy:
 *   - `from_broker`: we bought the policy from a broker (broker is the
 *     seller, broker_buy_price is what we paid them).
 *   - `to_broker`: the broker bought from us (broker is the buyer; our
 *     broker_buy_price field doesn't apply, profit = insurance_price -
 *     payed_for_company).
 */
export type BrokerDirection = 'from_broker' | 'to_broker';

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
  broker_direction: BrokerDirection | null;
  group_id: string | null;
}

export interface IssuanceRow {
  /** Stable id — group_id when grouped, sub-policy id otherwise. */
  id: string;
  /** Number that maps to the معاملة (e.g. "30/2026"). Read-only. */
  document_number: string | null;
  /** Client name — shared within a group. */
  client_name: string | null;
  client_id_number: string | null;
  client_phone: string | null;
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
  bank_transfer: 'تحويل بنكي',
  visa: 'فيزا',
  customer_cheque: 'شيك عميل',
};

const MAIN_TYPE_PRIORITY: Record<string, number> = {
  THIRD_FULL: 0,
  ELZAMI: 1,
};

/**
 * Patch shape returned/stored for inline edits — keys are the columns
 * the user can directly type into a row's cell. Lives in the parent
 * section so summary pills and the calculation modal can reflect
 * unsaved typing (otherwise they'd lag behind the cell value).
 */
export interface IssuanceEditPatch {
  insurance_price?: number;
  payed_for_company?: number;
  profit?: number;
  office_commission?: number;
  broker_buy_price?: number;
  issue_date?: string | null;
  start_date?: string;
  end_date?: string;
  car_value?: number;
}

export type IssuanceEditOverlay = Record<string, IssuanceEditPatch>;

/**
 * Apply a row's local edit patch onto its IssuanceRow, returning a new
 * row with both the per-row aggregates AND the `main` SubPolicy
 * mirroring the new values. Editing only fires on non-grouped rows so
 * we update both views consistently.
 */
export function applyOverlay(
  row: IssuanceRow,
  overlay: IssuanceEditOverlay,
): IssuanceRow {
  const local = overlay[row.id];
  if (!local) return row;
  const next: IssuanceRow = { ...row, main: { ...row.main } };
  if ('insurance_price' in local) {
    next.insurance_price = Number(local.insurance_price ?? row.insurance_price);
    next.main.insurance_price = next.insurance_price;
  }
  if ('payed_for_company' in local) {
    next.payed_for_company = Number(local.payed_for_company ?? row.payed_for_company);
    next.main.payed_for_company = next.payed_for_company;
  }
  if ('profit' in local) {
    next.profit = Number(local.profit ?? row.profit);
    next.main.profit = next.profit;
  }
  if ('office_commission' in local) {
    next.office_commission = Number(local.office_commission ?? row.office_commission);
    next.main.office_commission = next.office_commission;
  }
  if ('broker_buy_price' in local) {
    next.broker_buy_price = Number(local.broker_buy_price ?? row.broker_buy_price);
    next.main.broker_buy_price = next.broker_buy_price;
  }
  if ('issue_date' in local) next.main.issue_date = local.issue_date ?? null;
  if ('start_date' in local && local.start_date) next.main.start_date = local.start_date;
  if ('end_date' in local && local.end_date) next.main.end_date = local.end_date;
  if ('car_value' in local) next.main.car_value = Number(local.car_value ?? row.main.car_value);
  return next;
}

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
