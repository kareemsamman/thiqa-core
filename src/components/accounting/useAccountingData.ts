import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import type { Enums } from '@/integrations/supabase/types';
import { IssuanceRow, policyTypeKey } from './accountingTypes';
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
  issue_date: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number | null;
  payed_for_company: number | null;
  profit: number | null;
  office_commission: number | null;
  policy_type_parent: Enums<'policy_type_parent'>;
  policy_type_child: Enums<'policy_type_child'> | null;
  cancelled: boolean | null;
  is_under_24: boolean | null;
  company_id: string | null;
  broker_id: string | null;
  clients: { full_name: string } | null;
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
          `id, policy_number, issue_date, start_date, end_date,
           insurance_price, payed_for_company, profit, office_commission,
           policy_type_parent, policy_type_child, cancelled, is_under_24,
           company_id, broker_id,
           clients(full_name),
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

      const issuances: IssuanceRow[] = policyRows.map((p) => {
        const recs = receiptsByPolicy.get(p.id);
        return {
          id: p.id,
          policy_number: p.policy_number,
          issue_date: p.issue_date,
          start_date: p.start_date,
          end_date: p.end_date,
          insurance_price: Number(p.insurance_price ?? 0),
          payed_for_company: p.payed_for_company,
          profit: p.profit,
          office_commission: p.office_commission,
          policy_type_parent: p.policy_type_parent,
          policy_type_child: p.policy_type_child,
          cancelled: p.cancelled,
          is_under_24: p.is_under_24,
          client_name: p.clients?.full_name ?? null,
          car_id: p.cars?.id ?? null,
          car_number: p.cars?.car_number ?? null,
          car_type: p.cars?.car_type ?? null,
          car_value: p.cars?.car_value ?? null,
          car_year: p.cars?.year ?? null,
          company_id: p.company_id,
          company_name: p.insurance_companies?.name_ar || p.insurance_companies?.name || null,
          broker_id: p.broker_id ?? p.insurance_companies?.broker_id ?? null,
          receipts_count: recs?.count ?? 0,
          receipts_total: recs?.total ?? 0,
          primary_payment_method: recs?.primaryType ?? null,
          primary_receipt_number: recs?.primaryNumber ?? null,
        };
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
  const issuances = filteredPolicies.filter((p) => !p.cancelled);
  const returns = filteredPolicies.filter((p) => !!p.cancelled);

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
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    out = out.filter((r) => new Date(r.issue_date ?? r.start_date).getTime() >= from);
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    to.setHours(23, 59, 59, 999);
    const toMs = to.getTime();
    out = out.filter((r) => new Date(r.issue_date ?? r.start_date).getTime() <= toMs);
  }
  if (filters.companies.length > 0) {
    const set = new Set(filters.companies);
    out = out.filter((r) => r.company_id != null && set.has(r.company_id));
  }
  if (filters.types.length > 0) {
    const set = new Set(filters.types);
    out = out.filter((r) => set.has(policyTypeKey(r.policy_type_parent, r.policy_type_child)));
  }
  if (filters.paymentMethods.length > 0) {
    const set = new Set(filters.paymentMethods);
    out = out.filter((r) => r.primary_payment_method != null && set.has(r.primary_payment_method));
  }
  return out;
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
