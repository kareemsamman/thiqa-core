import { useCallback, useEffect, useState } from 'react';
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
  refresh: () => Promise<void>;
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
  company_id: string | null;
  broker_id: string | null;
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
  status: string;
  refused: boolean | null;
  notes: string | null;
  company_id: string | null;
  insurance_companies: { name: string; name_ar: string | null } | null;
}

interface RawBrokerSettlement {
  id: string;
  settlement_date: string;
  total_amount: number | null;
  payment_type: string | null;
  cheque_number: string | null;
  status: string;
  refused: boolean | null;
  notes: string | null;
  direction: 'we_owe' | 'broker_owes' | null;
  broker_id: string | null;
  brokers: { name: string } | null;
}

/**
 * Centralized fetch for the new accounting page. Each "section"
 * (companies / brokers / expenses) consumes a slice of the result.
 *
 * Filters are applied post-fetch on the client — not at the SQL level —
 * so toggling a filter doesn't re-hit the network. The dataset for an
 * agent is small (a few thousand rows max), so this is fine.
 */
export function useAccountingData(filters: AccountingFiltersValue): UseAccountingDataReturn {
  const { agentId } = useAgentContext();

  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [brokers, setBrokers] = useState<BrokerOption[]>([]);
  const [policies, setPolicies] = useState<IssuanceRow[]>([]);
  const [companySettlements, setCompanySettlements] = useState<SettlementRow[]>([]);
  const [brokerSettlements, setBrokerSettlements] = useState<SettlementRow[]>([]);

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
           company_id, broker_id,
           clients(full_name, id_number, phone_number),
           cars(id, car_number, car_type, car_value, year),
           insurance_companies(id, name, name_ar, broker_id)`,
        )
        .is('deleted_at', null)
        .order('issue_date', { ascending: false, nullsFirst: false });

      if (agentId) policyQuery = policyQuery.eq('agent_id', agentId);

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
        group_id: p.group_id,
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
          const aggregate = group.reduce(
            (acc, s) => {
              const recs = receiptsByPolicy.get(s.id);
              acc.insurance_price += s.insurance_price;
              acc.payed_for_company += Number(s.payed_for_company ?? 0);
              acc.profit += Number(s.profit ?? 0);
              acc.office_commission += Number(s.office_commission ?? 0);
              acc.broker_buy_price += Number(s.broker_buy_price ?? 0);
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

      // 4. Company settlements
      let csQuery = supabase
        .from('company_settlements')
        .select(
          'id, settlement_date, total_amount, payment_type, cheque_number, status, refused, notes, company_id, insurance_companies(name, name_ar)',
        )
        .order('settlement_date', { ascending: false });
      if (agentId) csQuery = csQuery.eq('agent_id', agentId);
      const { data: csData } = await csQuery;
      const csRows: SettlementRow[] = ((csData ?? []) as unknown as RawCompanySettlement[]).map((s) => ({
        id: s.id,
        settlement_date: s.settlement_date,
        total_amount: Number(s.total_amount ?? 0),
        payment_type: s.payment_type,
        cheque_number: s.cheque_number,
        status: s.status,
        refused: s.refused,
        notes: s.notes,
        entity_id: s.company_id ?? null,
        entity_name: s.insurance_companies?.name_ar || s.insurance_companies?.name || null,
      }));
      setCompanySettlements(csRows);

      // 5. Broker settlements
      let bsQuery = supabase
        .from('broker_settlements')
        .select(
          'id, settlement_date, total_amount, payment_type, cheque_number, status, refused, notes, direction, broker_id, brokers(name)',
        )
        .order('settlement_date', { ascending: false });
      if (agentId) bsQuery = bsQuery.eq('agent_id', agentId);
      const { data: bsData } = await bsQuery;
      const bsRows: SettlementRow[] = ((bsData ?? []) as unknown as RawBrokerSettlement[]).map((s) => ({
        id: s.id,
        settlement_date: s.settlement_date,
        total_amount: Number(s.total_amount ?? 0),
        payment_type: s.payment_type,
        cheque_number: s.cheque_number,
        status: s.status,
        refused: s.refused,
        notes: s.notes,
        direction: s.direction,
        entity_id: s.broker_id ?? null,
        entity_name: s.brokers?.name ?? null,
      }));
      setBrokerSettlements(bsRows);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ---- Apply filters client-side ----
  const filteredPolicies = applyFilters(policies, filters);
  const issuances = filteredPolicies.filter((p) => !p.main.cancelled);
  const returns = filteredPolicies.filter((p) => !!p.main.cancelled);

  const filteredCompanySettlements = applySettlementFilters(
    companySettlements,
    filters,
    filters.companies, // entity-id filter pulls from selected companies
  );
  const companyDisbursements = filteredCompanySettlements; // payments to companies
  // company_settlements only tracks money we PAID to companies. There's
  // no "money received from companies" table in this schema — refunds
  // come back as `refused=true` on the original settlement, not a new
  // row. We keep this empty array so the receipts tab can show an
  // explanatory empty state.
  const companyReceipts: SettlementRow[] = [];

  const filteredBrokerSettlements = applySettlementFilters(
    brokerSettlements,
    filters,
    [], // brokers filter not exposed via AccountingFiltersValue yet
  );

  return {
    loading,
    companies,
    brokers,
    issuances,
    returns,
    companySettlements: companyDisbursements,
    companyReceipts,
    brokerSettlements: filteredBrokerSettlements,
    refresh: fetchAll,
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
    // receipts/payment_method are still group-level — they're linked to
    // policies so a per-sub recompute would need the receipts map. The
    // table column shows the package's payment method anyway; narrowing
    // doesn't change that meaningfully for the user's purpose.
  };
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
