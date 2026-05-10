import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import type { Enums } from '@/integrations/supabase/types';
import { pickPackageDocumentNumber } from '@/lib/packageDocumentNumber';
import {
  IssuanceRow,
  SubPolicy,
  pickMainSubPolicy,
  policyTypeKey,
} from './accountingTypes';
import { SettlementRow } from './SettlementsTable';
import { AccountingFiltersValue } from './AccountingFilters';

export interface CompanyOption {
  id: string;
  name: string;
  name_ar: string | null;
  broker_id: string | null;
}

export interface BrokerOption {
  id: string;
  name: string;
}

interface UseAccountingDataReturn {
  loading: boolean;
  companies: CompanyOption[];
  brokers: BrokerOption[];
  /** All non-cancelled policies (filters applied except cancelled flag). */
  issuances: IssuanceRow[];
  /** Cancelled policies. */
  returns: IssuanceRow[];
  companySettlements: SettlementRow[];
  companyReceipts: SettlementRow[];
  brokerSettlements: SettlementRow[];
  /** Filtered total expense amount — used by the net-profit pill. */
  expensesTotal: number;
  refresh: () => Promise<void>;
  /** Optimistic in-place mutation for a single sub-policy — avoids the
   *  full refetch the package drawer used to trigger on every save. */
  patchSubPolicy: (subId: string, patch: Partial<SubPolicy>) => void;
}

interface RawExpense {
  expense_date: string;
  amount: number | null;
}

interface RawPolicy {
  id: string;
  policy_number: string | null;
  document_number: string | null;
  group_id: string | null;
  issue_date: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number | null;
  payed_for_company: number | null;
  profit: number | null;
  office_commission: number | null;
  broker_buy_price: number | null;
  policy_type_parent: Enums<'policy_type_parent'>;
  policy_type_child: Enums<'policy_type_child'> | null;
  cancelled: boolean | null;
  is_under_24: boolean | null;
  manual_override: boolean | null;
  company_id: string | null;
  broker_id: string | null;
  broker_direction: 'from_broker' | 'to_broker' | null;
  clients: { full_name: string; id_number: string | null; phone_number: string | null } | null;
  cars: {
    id: string;
    car_number: string | null;
    car_type: Enums<'car_type'> | null;
    car_value: number | null;
    year: number | null;
  } | null;
  insurance_companies: {
    id: string;
    name: string;
    name_ar: string | null;
    broker_id: string | null;
  } | null;
}

interface RawPayment {
  policy_id: string;
  amount: number | null;
  payment_type: string;
  refused: boolean | null;
  cheque_number: string | null;
}

interface RawCompanySettlement {
  id: string;
  settlement_date: string;
  total_amount: number | null;
  payment_type: string | null;
  cheque_number: string | null;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url: string | null;
  cheque_image_urls: string[] | null;
  customer_cheque_ids: string[] | null;
  status: string;
  refused: boolean | null;
  notes: string | null;
  direction: 'outgoing' | 'incoming' | null;
  company_id: string | null;
  insurance_companies: { name: string; name_ar: string | null } | null;
}

interface RawBrokerSettlement {
  id: string;
  settlement_date: string;
  total_amount: number | null;
  payment_type: string | null;
  cheque_number: string | null;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url: string | null;
  cheque_image_urls: string[] | null;
  customer_cheque_ids: string[] | null;
  status: string;
  refused: boolean | null;
  notes: string | null;
  direction: 'we_owe' | 'broker_owes' | null;
  broker_id: string | null;
  brokers: { name: string } | null;
}

// Hydrates the cheque image array from either the new array column or
// the legacy single-URL column. Old rows that haven't been edited since
// the migration only have cheque_image_url; treat that as a single-item
// array so the list renders the thumbnail.
function hydrateChequeImages(arr: string[] | null, single: string | null): string[] {
  if (Array.isArray(arr) && arr.length > 0) return arr;
  return single ? [single] : [];
}

/**
 * Centralized fetch for the new accounting page. Each "section"
 * (companies / brokers / expenses) consumes a slice of the result.
 *
 * Filters are applied post-fetch on the client — not at the SQL level —
 * so toggling a filter doesn't re-hit the network. The dataset for an
 * agent is small (a few thousand rows max), so this is fine.
 */
export function useAccountingData(
  filters: AccountingFiltersValue,
  branchId?: string | null,
): UseAccountingDataReturn {
  const { agentId } = useAgentContext();

  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [brokers, setBrokers] = useState<BrokerOption[]>([]);
  const [policies, setPolicies] = useState<IssuanceRow[]>([]);
  const [companySettlements, setCompanySettlements] = useState<
    (SettlementRow & { direction?: 'outgoing' | 'incoming' })[]
  >([]);
  const [brokerSettlements, setBrokerSettlements] = useState<SettlementRow[]>([]);
  const [expenses, setExpenses] = useState<RawExpense[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Companies + brokers (small lookup tables)
      const [{ data: companiesData }, { data: brokersData }] = await Promise.all([
        supabase
          .from('insurance_companies')
          .select('id, name, name_ar, broker_id')
          .eq('active', true)
          .order('name'),
        supabase.from('brokers').select('id, name').order('name'),
      ]);
      setCompanies((companiesData ?? []) as CompanyOption[]);
      setBrokers((brokersData ?? []) as BrokerOption[]);

      // 2. Policies + cars + clients + companies (joined)
      let policyQuery = supabase
        .from('policies')
        .select(
          `id, policy_number, document_number, group_id,
           issue_date, start_date, end_date,
           insurance_price, payed_for_company, profit, office_commission, broker_buy_price,
           policy_type_parent, policy_type_child, cancelled, is_under_24,
           manual_override,
           company_id, broker_id, broker_direction,
           clients(full_name, id_number, phone_number),
           cars(id, car_number, car_type, car_value, year),
           insurance_companies(id, name, name_ar, broker_id)`,
        )
        .is('deleted_at', null)
        .eq('skip_recalc', false)
        .order('issue_date', { ascending: false, nullsFirst: false });

      if (agentId) policyQuery = policyQuery.eq('agent_id', agentId);
      // Page-level branch filter from AgentBranchFilter (global admins
      // only). Workers / branch admins are already scoped by RLS, so
      // skipping the .eq when branchId is null/undefined matches their
      // natural visibility. policies / settlements / expenses all carry
      // branch_id, so the same one-liner applies to each block below.
      if (branchId) policyQuery = policyQuery.eq('branch_id', branchId);

      const { data: policyData } = await policyQuery;
      const policyRows = (policyData ?? []) as unknown as RawPolicy[];

      // 3. Payments per policy (one query, then group)
      const policyIds = policyRows.map((p) => p.id);
      const receiptsByPolicy: Map<
        string,
        { count: number; total: number; primaryType: string | null; primaryNumber: string | null }
      > = new Map();
      if (policyIds.length > 0) {
        const { data: paymentsData } = await supabase
          .from('policy_payments')
          .select('policy_id, amount, payment_type, refused, cheque_number')
          .in('policy_id', policyIds);

        ((paymentsData ?? []) as RawPayment[]).forEach((p) => {
          const cur = receiptsByPolicy.get(p.policy_id) ?? {
            count: 0,
            total: 0,
            primaryType: null as string | null,
            primaryNumber: null as string | null,
          };
          cur.count += 1;
          if (!p.refused) cur.total += Number(p.amount ?? 0);
          if (cur.primaryType == null) {
            cur.primaryType = p.payment_type;
            cur.primaryNumber = p.cheque_number;
          }
          receiptsByPolicy.set(p.policy_id, cur);
        });
      }

      // Flatten each raw row into a SubPolicy used for grouping below.
      const subs: SubPolicy[] = policyRows.map((p) => ({
        id: p.id,
        policy_number: p.policy_number,
        document_number: p.document_number,
        issue_date: p.issue_date,
        start_date: p.start_date,
        end_date: p.end_date,
        insurance_price: Number(p.insurance_price ?? 0),
        payed_for_company: p.payed_for_company,
        profit: p.profit,
        office_commission: p.office_commission,
        broker_buy_price: p.broker_buy_price,
        policy_type_parent: p.policy_type_parent,
        policy_type_child: p.policy_type_child,
        cancelled: p.cancelled,
        is_under_24: p.is_under_24,
        car_id: p.cars?.id ?? null,
        car_number: p.cars?.car_number ?? null,
        car_type: p.cars?.car_type ?? null,
        car_value: p.cars?.car_value ?? null,
        car_year: p.cars?.year ?? null,
        company_id: p.company_id,
        company_name: p.insurance_companies?.name_ar || p.insurance_companies?.name || null,
        broker_id: p.broker_id ?? p.insurance_companies?.broker_id ?? null,
        broker_direction: p.broker_direction,
        group_id: p.group_id,
        manual_override: !!p.manual_override,
      }));

      // Group: standalone (no group_id) → each sub is its own معاملة;
      // otherwise bucket by group_id.
      const groupBuckets = new Map<string, SubPolicy[]>();
      subs.forEach((s) => {
        const key = s.group_id ?? `solo-${s.id}`;
        const arr = groupBuckets.get(key) ?? [];
        arr.push(s);
        groupBuckets.set(key, arr);
      });

      // Map sub-policy id → client info from the original raw fetch,
      // since SubPolicy doesn't carry the joined client.
      const clientByPolicy = new Map<
        string,
        { name: string | null; id_number: string | null; phone: string | null }
      >();
      policyRows.forEach((p) => {
        clientByPolicy.set(p.id, {
          name: p.clients?.full_name ?? null,
          id_number: p.clients?.id_number ?? null,
          phone: p.clients?.phone_number ?? null,
        });
      });

      const issuances: IssuanceRow[] = Array.from(groupBuckets.values()).map(
        (group) => {
          const main = pickMainSubPolicy(group);
          // Row-level money aggregates SUM across sub-policies (excluding
          // ELZAMI when bundled with non-ELZAMI subs). These totals power
          // the summary pills at the top of the table — "إجمالي سعر
          // التأمين", "المستحق للشركات", "الأرباح + العمولات", etc.
          // Per-cell display in the table uses `row.main.*` instead so
          // the visible row reflects only the main sub (THIRD/FULL).
          const hasNonElzami = group.some((s) => s.policy_type_parent !== 'ELZAMI');
          const moneySubs = hasNonElzami
            ? group.filter((s) => s.policy_type_parent !== 'ELZAMI')
            : group;
          const aggregate = group.reduce(
            (acc, s) => {
              const recs = receiptsByPolicy.get(s.id);
              const includeMoney = moneySubs.includes(s);
              if (includeMoney) {
                acc.insurance_price += s.insurance_price;
                acc.payed_for_company += Number(s.payed_for_company ?? 0);
                acc.profit += Number(s.profit ?? 0);
                acc.office_commission += Number(s.office_commission ?? 0);
                acc.broker_buy_price += Number(s.broker_buy_price ?? 0);
              }
              // Receipts are payments from the client — count them across
              // every sub since they represent the customer's payment
              // against the whole package.
              acc.receipts_count += recs?.count ?? 0;
              acc.receipts_total += recs?.total ?? 0;
              if (acc.primary_payment_method == null && recs?.primaryType) {
                acc.primary_payment_method = recs.primaryType;
              }
              return acc;
            },
            {
              insurance_price: 0,
              payed_for_company: 0,
              profit: 0,
              office_commission: 0,
              broker_buy_price: 0,
              receipts_count: 0,
              receipts_total: 0,
              primary_payment_method: null as string | null,
            },
          );

          const documentNumber =
            pickPackageDocumentNumber(
              group.map((s) => ({
                document_number: s.document_number,
                policy_type_parent: s.policy_type_parent,
              })),
            ) ?? main.document_number;

          const clientInfo = clientByPolicy.get(main.id);
          return {
            id: main.group_id ?? main.id,
            document_number: documentNumber,
            client_name: clientInfo?.name ?? null,
            client_id_number: clientInfo?.id_number ?? null,
            client_phone: clientInfo?.phone ?? null,
            sub_policies: group,
            main,
            is_grouped: group.length > 1,
            insurance_price: aggregate.insurance_price,
            payed_for_company: aggregate.payed_for_company,
            profit: aggregate.profit,
            office_commission: aggregate.office_commission,
            broker_buy_price: aggregate.broker_buy_price,
            receipts_count: aggregate.receipts_count,
            receipts_total: aggregate.receipts_total,
            primary_payment_method: aggregate.primary_payment_method,
            manual_override: group.some((s) => s.manual_override),
          };
        },
      );

      // Most-recent first by main's issue_date (fallback start_date).
      issuances.sort((a, b) => {
        const ad = new Date(a.main.issue_date ?? a.main.start_date).getTime();
        const bd = new Date(b.main.issue_date ?? b.main.start_date).getTime();
        return bd - ad;
      });

      setPolicies(issuances);

      // 4. Company settlements (both directions — split client-side
      //    into disbursements / receipts based on `direction`)
      let csQuery = supabase
        .from('company_settlements')
        .select(
          'id, settlement_date, total_amount, payment_type, cheque_number, bank_code, branch_code, cheque_image_url, cheque_image_urls, customer_cheque_ids, status, refused, notes, direction, company_id, insurance_companies(name, name_ar)',
        )
        .order('settlement_date', { ascending: false });
      if (agentId) csQuery = csQuery.eq('agent_id', agentId);
      if (branchId) csQuery = csQuery.eq('branch_id', branchId);
      const { data: csData } = await csQuery;
      const csRows: (Omit<SettlementRow, 'direction'> & { direction: 'outgoing' | 'incoming' })[] = (
        (csData ?? []) as unknown as RawCompanySettlement[]
      ).map((s) => ({
        id: s.id,
        settlement_date: s.settlement_date,
        total_amount: Number(s.total_amount ?? 0),
        payment_type: s.payment_type,
        cheque_number: s.cheque_number,
        bank_code: s.bank_code,
        branch_code: s.branch_code,
        cheque_image_urls: hydrateChequeImages(s.cheque_image_urls, s.cheque_image_url),
        customer_cheque_count: Array.isArray(s.customer_cheque_ids) ? s.customer_cheque_ids.length : 0,
        status: s.status,
        refused: s.refused,
        notes: s.notes,
        entity_id: s.company_id ?? null,
        entity_name: s.insurance_companies?.name_ar || s.insurance_companies?.name || null,
        direction: s.direction ?? 'outgoing',
      }));
      setCompanySettlements(csRows);

      // 5. Broker settlements
      let bsQuery = supabase
        .from('broker_settlements')
        .select(
          'id, settlement_date, total_amount, payment_type, cheque_number, bank_code, branch_code, cheque_image_url, cheque_image_urls, customer_cheque_ids, status, refused, notes, direction, broker_id, brokers(name)',
        )
        .order('settlement_date', { ascending: false });
      if (agentId) bsQuery = bsQuery.eq('agent_id', agentId);
      if (branchId) bsQuery = bsQuery.eq('branch_id', branchId);
      const { data: bsData } = await bsQuery;
      const bsRows: SettlementRow[] = ((bsData ?? []) as unknown as RawBrokerSettlement[]).map((s) => ({
        id: s.id,
        settlement_date: s.settlement_date,
        total_amount: Number(s.total_amount ?? 0),
        payment_type: s.payment_type,
        cheque_number: s.cheque_number,
        bank_code: s.bank_code,
        branch_code: s.branch_code,
        cheque_image_urls: hydrateChequeImages(s.cheque_image_urls, s.cheque_image_url),
        customer_cheque_count: Array.isArray(s.customer_cheque_ids) ? s.customer_cheque_ids.length : 0,
        status: s.status,
        refused: s.refused,
        notes: s.notes,
        direction: s.direction,
        entity_id: s.broker_id ?? null,
        entity_name: s.brokers?.name ?? null,
      }));
      setBrokerSettlements(bsRows);

      // 6. Expenses — only the sum is needed by the pills, but the full
      //    rows are required to apply the date filter client-side.
      let exQuery = supabase.from('expenses').select('expense_date, amount');
      if (agentId) exQuery = exQuery.eq('agent_id', agentId);
      if (branchId) exQuery = exQuery.eq('branch_id', branchId);
      const { data: exData } = await exQuery;
      setExpenses((exData ?? []) as RawExpense[]);
    } finally {
      setLoading(false);
    }
  }, [agentId, branchId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Refetch when external actions (e.g. RecalcProfitsButton, policy create
  // from the wizard) signal that policy data has changed. Avoids the user
  // having to manually reload the accounting page to see fresh numbers.
  useEffect(() => {
    const handler = () => fetchAll();
    window.addEventListener('thiqa:policy-created', handler);
    return () => window.removeEventListener('thiqa:policy-created', handler);
  }, [fetchAll]);

  const patchSubPolicy = useCallback((subId: string, patch: Partial<SubPolicy>) => {
    setPolicies((prev) =>
      prev.map((row) => {
        const idx = row.sub_policies.findIndex((s) => s.id === subId);
        if (idx === -1) return row;
        const nextSubs = row.sub_policies.slice();
        nextSubs[idx] = { ...nextSubs[idx], ...patch };
        // Row-level aggregates sum across non-ELZAMI subs (or all subs
        // for an ELZAMI-only group). Mirrors the initial aggregation in
        // fetchAll so the summary pills stay correct after edits.
        const hasNonElzami = nextSubs.some((s) => s.policy_type_parent !== 'ELZAMI');
        const moneySubs = hasNonElzami
          ? nextSubs.filter((s) => s.policy_type_parent !== 'ELZAMI')
          : nextSubs;
        const aggregate = moneySubs.reduce(
          (acc, s) => {
            acc.insurance_price += Number(s.insurance_price ?? 0);
            acc.payed_for_company += Number(s.payed_for_company ?? 0);
            acc.profit += Number(s.profit ?? 0);
            acc.office_commission += Number(s.office_commission ?? 0);
            acc.broker_buy_price += Number(s.broker_buy_price ?? 0);
            return acc;
          },
          {
            insurance_price: 0,
            payed_for_company: 0,
            profit: 0,
            office_commission: 0,
            broker_buy_price: 0,
          },
        );
        const main = pickMainSubPolicy(nextSubs);
        return {
          ...row,
          sub_policies: nextSubs,
          main,
          ...aggregate,
          manual_override: nextSubs.some((s) => s.manual_override),
        };
      }),
    );
  }, []);

  // ---- Apply filters client-side ----
  // Memoized so a parent re-render driven by an unrelated state change
  // (e.g. typing into a cell) doesn't redo the per-policy filter pass.
  const filteredPolicies = useMemo(() => applyFilters(policies, filters), [policies, filters]);
  const issuances = useMemo(
    () => filteredPolicies.filter((p) => !p.main.cancelled),
    [filteredPolicies],
  );
  const returns = useMemo(
    () => filteredPolicies.filter((p) => !!p.main.cancelled),
    [filteredPolicies],
  );

  // Direction-aware split: 'outgoing' = we paid the company (سند صرف),
  // 'incoming' = company paid us (سند قبض). The new dialog writes the
  // appropriate flag; legacy rows default to outgoing.
  const filteredAllCompanySettlements = useMemo(
    () => applySettlementFilters(companySettlements, filters, filters.companies),
    [companySettlements, filters],
  );
  const companyDisbursements = useMemo(
    () => filteredAllCompanySettlements.filter((s) => (s as { direction?: string }).direction !== 'incoming'),
    [filteredAllCompanySettlements],
  );
  const companyReceipts = useMemo(
    () => filteredAllCompanySettlements.filter((s) => (s as { direction?: string }).direction === 'incoming'),
    [filteredAllCompanySettlements],
  );

  const filteredBrokerSettlements = useMemo(
    () => applySettlementFilters(brokerSettlements, filters, []),
    [brokerSettlements, filters],
  );

  const expensesTotal = useMemo(() => {
    let rows = expenses;
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom).getTime();
      rows = rows.filter((r) => new Date(r.expense_date).getTime() >= from);
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      const toMs = to.getTime();
      rows = rows.filter((r) => new Date(r.expense_date).getTime() <= toMs);
    }
    return rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  }, [expenses, filters]);

  return {
    loading,
    companies,
    brokers,
    issuances,
    returns,
    companySettlements: companyDisbursements,
    companyReceipts,
    brokerSettlements: filteredBrokerSettlements,
    expensesTotal,
    refresh: fetchAll,
    patchSubPolicy,
  };
}

function applyFilters(rows: IssuanceRow[], filters: AccountingFiltersValue): IssuanceRow[] {
  let out = rows;

  // Date filter: match تاريخ الإصدار only — agents asked to filter by
  // when the policy was *issued*, not its coverage window. Rows with
  // null issue_date are excluded from the date filter (they can't
  // match by definition).
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    out = out.filter(
      (r) => r.main.issue_date != null && new Date(r.main.issue_date).getTime() >= from,
    );
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    to.setHours(23, 59, 59, 999);
    const toMs = to.getTime();
    out = out.filter(
      (r) => r.main.issue_date != null && new Date(r.main.issue_date).getTime() <= toMs,
    );
  }

  if (filters.companies.length > 0) {
    const set = new Set(filters.companies);
    out = out.filter((r) => r.main.company_id != null && set.has(r.main.company_id));
  }

  // Type filter is special: instead of just keeping/dropping rows, we
  // *narrow* each row to only the matching sub-policies and re-aggregate.
  // That way filtering a "إلزامي + ثالث + خدمات الطريق" package by ثالث
  // shows just the ثالث's prices in the row — and inline edits land
  // on ثالث's policy_id, not the package's main.
  if (filters.types.length > 0) {
    const set = new Set(filters.types);
    out = out
      .map((r) => narrowByType(r, set))
      .filter((r): r is IssuanceRow => r !== null);
  }

  if (filters.paymentMethods.length > 0) {
    const set = new Set(filters.paymentMethods);
    out = out.filter(
      (r) => r.primary_payment_method != null && set.has(r.primary_payment_method),
    );
  }
  return out;
}

function narrowByType(row: IssuanceRow, allowed: Set<string>): IssuanceRow | null {
  const matched = row.sub_policies.filter((s) =>
    allowed.has(policyTypeKey(s.policy_type_parent, s.policy_type_child)),
  );
  if (matched.length === 0) return null;
  if (matched.length === row.sub_policies.length) return row; // no narrowing needed

  const main = pickMainSubPolicy(matched);
  // Row-level aggregates sum the matched subs (after filter narrowing).
  // Per-cell rendering uses row.main.* in the table, but the totals at
  // the top still need a SUM — same convention as the default rows.
  const insurance_price = matched.reduce((s, p) => s + Number(p.insurance_price ?? 0), 0);
  const payed_for_company = matched.reduce((s, p) => s + Number(p.payed_for_company ?? 0), 0);
  const profit = matched.reduce((s, p) => s + Number(p.profit ?? 0), 0);
  const office_commission = matched.reduce((s, p) => s + Number(p.office_commission ?? 0), 0);
  const broker_buy_price = matched.reduce((s, p) => s + Number(p.broker_buy_price ?? 0), 0);

  return {
    ...row,
    sub_policies: matched,
    main,
    is_grouped: matched.length > 1,
    insurance_price,
    payed_for_company,
    profit,
    office_commission,
    broker_buy_price,
    manual_override: matched.some((s) => s.manual_override),
    // receipts/payment_method are still group-level — they're linked to
    // policies so a per-sub recompute would need the receipts map. The
    // table column shows the package's payment method anyway; narrowing
    // doesn't change that meaningfully for the user's purpose.
  };
}

/**
 * Free-text search over the visible identifiers of a policy row —
 * client name, ID, phone, document number, car number, company name.
 * Empty/whitespace queries match everything.
 */
export function matchesIssuanceSearch(row: IssuanceRow, q: string): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  const fields: (string | null | undefined)[] = [
    row.client_name,
    row.client_id_number,
    row.client_phone,
    row.document_number,
    row.main.car_number,
    row.main.company_name,
  ];
  return fields.some((v) => v != null && v.toLowerCase().includes(term));
}

/** Same idea for settlements — entity, cheque #, notes. */
export function matchesSettlementSearch(row: SettlementRow, q: string): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  const fields: (string | null | undefined)[] = [
    row.entity_name,
    row.cheque_number,
    row.notes,
  ];
  return fields.some((v) => v != null && v.toLowerCase().includes(term));
}

function applySettlementFilters(
  rows: SettlementRow[],
  filters: AccountingFiltersValue,
  entityIds: string[],
): SettlementRow[] {
  let out = rows;
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    out = out.filter((r) => new Date(r.settlement_date).getTime() >= from);
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    to.setHours(23, 59, 59, 999);
    const toMs = to.getTime();
    out = out.filter((r) => new Date(r.settlement_date).getTime() <= toMs);
  }
  if (filters.paymentMethods.length > 0) {
    const set = new Set(filters.paymentMethods);
    out = out.filter((r) => r.payment_type != null && set.has(r.payment_type));
  }
  if (entityIds.length > 0) {
    const set = new Set(entityIds);
    out = out.filter((r) => r.entity_id != null && set.has(r.entity_id));
  }
  return out;
}
