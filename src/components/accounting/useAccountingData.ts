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

export interface ClientReceiptRow {
  id: string;
  receipt_date: string;
  amount: number;
  payment_method: string | null;
  /** User-facing voucher label (e.g. "R162/2026"). For payment rows we
   *  prefer `policy_payments.receipt_number` (the shared session
   *  number, so a bulk cheque collection prints one number across all
   *  policies it covered). For other types we synthesize from the
   *  receipts row's own `receipt_number` + a per-type prefix. */
  voucher_number: string | null;
  receipt_number: number | null;
  cheque_number: string | null;
  notes: string | null;
  client_id: string | null;
  client_name: string | null;
  /** Customer fields surfaced as optional columns on the accounting
   *  tables (per user: "اكتر معلومات الزبون"). Mirrored client_name
   *  on the receipts row stays authoritative; the joined values fill
   *  in everything else. */
  client_id_number: string | null;
  client_phone: string | null;
  /** Linked policy's car number, when the receipt was tied to a
   *  specific policy. Optional column the user toggles on when
   *  reconciling against a paper file. */
  car_number: string | null;
  policy_id: string | null;
  /** policy_payments.id — only set for payment + cancellation rows
   *  mirrored from policy_payments. Used to print the bulk receipt
   *  voucher via `generate-voucher` when the user clicks the row. */
  payment_id: string | null;
  policy_document_number: string | null;
  policy_number: string | null;
  cancelled_at: string | null;
  /** Receipt type — used by ClientsSection to split the credit/debit
   *  bucket without relying on amount sign. New إشعار مدين rows are
   *  receipt_type='debit_note' with positive amount; legacy entries
   *  are receipt_type='credit_note' with negative amount. */
  receipt_type: string;
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
  /** سند قبض rows — payments received FROM clients (the agency's
   *  income side). Mirrored from `policy_payments` by the receipts
   *  trigger so a bulk cheque collection still appears as one row per
   *  policy share. */
  clientPayments: ClientReceiptRow[];
  /** سند إلغاء rows — refused/voided cheques. Each row reverses a
   *  prior سند قبض (linked via `cancels_receipt_id`) but isn't itself
   *  a cash movement; it just removes the earlier payment from the
   *  customer's running balance. */
  clientCancellations: ClientReceiptRow[];
  /** سند الصرف rows — actual cash leaving the agency to a client
   *  (refunds on cancel/transfer or manual disbursements). One row per
   *  voucher (multi-method sessions are already aggregated by the
   *  client_settlements → receipts mirror trigger). */
  clientDisbursements: ClientReceiptRow[];
  /** إشعار دائن / إشعار مدين rows. Both share receipt_type='credit_note'
   *  in the DB; the SIGN of `amount` flips the user-facing label:
   *    • amount > 0 → إشعار دائن (office owes customer — wallet credit)
   *    • amount < 0 → إشعار مدين (customer owes office extra — paper debit)
   *  Sections that need only one flavor split on `amount` themselves. */
  clientCreditNotes: ClientReceiptRow[];
  /** إشعار مدين للوسطاء — paper credits the office issued against
   *  brokers' outstanding debt. Subtracted from the broker debt
   *  pill ('المتبقي على الوسطاء') and from the broker balance pills
   *  inside AddSettlementDialog. No cash movement; effectively a
   *  write-down of what the broker owes us. */
  brokerCreditNotes: ClientReceiptRow[];
  /** إشعار دائن / مدين للشركات — credit/debit notes the office filed
   *  against an insurance company (commission claw-back, refund pending,
   *  administrative reconciliation). Written by AddCompanyDebitNoteDialog
   *  / AddCompanyCreditNoteDialog with `company_id` set and `client_id`
   *  + `broker_id` null. Surfaced on the companies accounting tab so
   *  the same place that shows سند صرف / سند قبض also shows these. */
  companyCreditNotes: ClientReceiptRow[];
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
  client_id: string | null;
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

interface RawClientReceipt {
  id: string;
  receipt_date: string;
  amount: number | null;
  payment_method: string | null;
  voucher_number: string | null;
  receipt_number: number | null;
  cheque_number: string | null;
  notes: string | null;
  client_id: string | null;
  client_name: string | null;
  policy_id: string | null;
  payment_id: string | null;
  car_number: string | null;
  cancelled_at: string | null;
  clients: { id_number: string | null; phone_number: string | null } | null;
  policies:
    | {
        document_number: string | null;
        policy_number: string | null;
        client_id: string | null;
        cars: { car_number: string | null } | null;
        clients: { id_number: string | null; phone_number: string | null } | null;
      }
    | null;
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
  const [clientPaymentsRaw, setClientPaymentsRaw] = useState<ClientReceiptRow[]>([]);
  const [clientCancellationsRaw, setClientCancellationsRaw] = useState<ClientReceiptRow[]>([]);
  const [clientDisbursementsRaw, setClientDisbursementsRaw] = useState<ClientReceiptRow[]>([]);
  const [clientCreditNotesRaw, setClientCreditNotesRaw] = useState<ClientReceiptRow[]>([]);
  const [brokerCreditNotesRaw, setBrokerCreditNotesRaw] = useState<ClientReceiptRow[]>([]);
  const [companyCreditNotesRaw, setCompanyCreditNotesRaw] = useState<ClientReceiptRow[]>([]);
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
           client_id, company_id, broker_id, broker_direction,
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
      // Mirror receipts grouped by policy_id — used to compute the
      // primary_receipt on each IssuanceRow so the "سندات القبض" cell
      // can show the real voucher number AND open the print/send
      // dialog when the row only has ONE receipt.
      type PaymentMirror = {
        receipt_id: string;
        voucher_number: string | null;
        receipt_type: string;
        payment_id: string | null;
        client_phone: string | null;
      };
      const paymentMirrorsByPolicy = new Map<string, PaymentMirror[]>();
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

        // Separate query for the mirror receipts. We also pull
        // receipt_number + receipt_date so we can synthesize the
        // user-facing R{n}/{year} label when voucher_number is NULL
        // (the trigger-mirrored case for some legacy payment rows).
        // Joining clients so the action dialog can send via SMS /
        // WhatsApp without a follow-up lookup.
        const { data: payMirrors } = await supabase
          .from('receipts')
          .select(
            'id, policy_id, voucher_number, receipt_number, receipt_date, receipt_type, payment_id, cancelled_at, clients(phone_number)',
          )
          .in('policy_id', policyIds)
          .eq('receipt_type', 'payment');

        // Look up the shared session label on policy_payments — that's
        // the R-number a single bulk سند قبض stamps across all its
        // policy-share rows. Prefer it over the per-receipt serial so
        // multi-policy sessions print the same number everywhere.
        const mirrorPaymentIds = Array.from(
          new Set(
            ((payMirrors ?? []) as Array<{ payment_id: string | null }>)
              .map((m) => m.payment_id)
              .filter((id): id is string => !!id),
          ),
        );
        const sessionReceiptByPaymentId = new Map<string, string>();
        if (mirrorPaymentIds.length > 0) {
          const { data: payMeta } = await supabase
            .from('policy_payments')
            .select('id, receipt_number')
            .in('id', mirrorPaymentIds);
          for (const p of (payMeta ?? []) as Array<{
            id: string;
            receipt_number: string | null;
          }>) {
            if (p.receipt_number) sessionReceiptByPaymentId.set(p.id, p.receipt_number);
          }
        }

        for (const m of (payMirrors ?? []) as Array<{
          id: string;
          policy_id: string | null;
          voucher_number: string | null;
          receipt_number: number | null;
          receipt_date: string | null;
          receipt_type: string;
          payment_id: string | null;
          cancelled_at: string | null;
          clients?: { phone_number: string | null } | null;
        }>) {
          if (!m.policy_id || m.cancelled_at) continue;
          // Cascade: explicit voucher_number → shared session label
          // from policy_payments → synthesized R{serial}/{year} from
          // receipts.receipt_number. Last-resort null means the cell
          // hides the receipts pill — but with this cascade that
          // should be vanishingly rare.
          let label = m.voucher_number;
          if (!label && m.payment_id && sessionReceiptByPaymentId.has(m.payment_id)) {
            label = sessionReceiptByPaymentId.get(m.payment_id)!;
          }
          if (!label && m.receipt_number != null) {
            const yr = m.receipt_date
              ? new Date(m.receipt_date).getFullYear()
              : new Date().getFullYear();
            label = `R${m.receipt_number}/${yr}`;
          }
          const arr = paymentMirrorsByPolicy.get(m.policy_id) ?? [];
          arr.push({
            receipt_id: m.id,
            voucher_number: label,
            receipt_type: m.receipt_type,
            payment_id: m.payment_id,
            client_phone: m.clients?.phone_number ?? null,
          });
          paymentMirrorsByPolicy.set(m.policy_id, arr);
        }
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
        {
          id: string | null;
          name: string | null;
          id_number: string | null;
          phone: string | null;
        }
      >();
      policyRows.forEach((p) => {
        clientByPolicy.set(p.id, {
          id: p.client_id ?? null,
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
          // Collect every mirror receipt across the group's sub-
          // policies so the cell knows whether a single voucher
          // covers the whole package. Only when EXACTLY one mirror
          // exists do we surface it as primary_receipt — otherwise
          // the cell stays "N سند" + drawer.
          const groupMirrors = group.flatMap(
            (s) => paymentMirrorsByPolicy.get(s.id) ?? [],
          );
          const primary_receipt = groupMirrors.length === 1
            ? {
                ...groupMirrors[0],
                client_phone: groupMirrors[0].client_phone ?? clientInfo?.phone ?? null,
              }
            : null;
          return {
            id: main.group_id ?? main.id,
            document_number: documentNumber,
            client_id: clientInfo?.id ?? null,
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
            primary_receipt,
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
      const csRowsBase = (csData ?? []) as unknown as RawCompanySettlement[];

      // Eagerly fetch the mirror receipts for every company settlement
      // we just loaded so the accounting table can render real voucher
      // numbers AND open ReceiptActionsDialog without an async lookup.
      // Without this, the cell printed "تسوية" and clicking sometimes
      // threw "السند غير متوفر للطباعة/الإرسال" on rows whose mirror
      // hadn't been read yet.
      const csIds = csRowsBase.map((s) => s.id);
      type SettlementMirror = {
        voucher_number: string | null;
        receipt_id: string;
        receipt_type: string;
        payment_id: string | null;
      };
      const mirrorByCompanySettlementId = new Map<string, SettlementMirror>();
      if (csIds.length > 0) {
        // Also fetch receipt_number + receipt_date so we can synthesize
        // R{n}/{year} for incoming settlements where the trigger left
        // voucher_number NULL (per 20260514170000 — the formatter on
        // /receipts uses the serial to build the label).
        const { data: mirrorRows } = await supabase
          .from('receipts')
          .select('id, company_settlement_id, voucher_number, receipt_number, receipt_date, receipt_type, payment_id')
          .in('company_settlement_id', csIds);
        for (const m of (mirrorRows ?? []) as Array<{
          id: string;
          company_settlement_id: string;
          voucher_number: string | null;
          receipt_number: number | null;
          receipt_date: string | null;
          receipt_type: string;
          payment_id: string | null;
        }>) {
          if (!m.company_settlement_id) continue;
          // Synthesize the voucher label when the mirror only has a
          // serial receipt_number (incoming branch of the trigger).
          // Prefix follows the same convention the kashf and /receipts
          // pages use: R for payment, D for disbursement.
          let label = m.voucher_number;
          if (!label && m.receipt_number != null) {
            const yr = m.receipt_date
              ? new Date(m.receipt_date).getFullYear()
              : new Date().getFullYear();
            const prefix = m.receipt_type === 'disbursement' ? 'D' : 'R';
            label = `${prefix}${m.receipt_number}/${yr}`;
          }
          mirrorByCompanySettlementId.set(m.company_settlement_id, {
            receipt_id: m.id,
            voucher_number: label,
            receipt_type: m.receipt_type,
            payment_id: m.payment_id,
          });
        }
      }

      const csRows: (Omit<SettlementRow, 'direction'> & { direction: 'outgoing' | 'incoming' })[] = csRowsBase.map((s) => {
        const mirror = mirrorByCompanySettlementId.get(s.id) ?? null;
        return {
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
          voucher_number: mirror?.voucher_number ?? null,
          receipt_id: mirror?.receipt_id ?? null,
          receipt_type: mirror?.receipt_type ?? null,
          payment_id: mirror?.payment_id ?? null,
        };
      });
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

      // 6. Client receipts — fetch every flavor that hits a client's
      //    account from the agency's side. We read them all in one
      //    query and split client-side by receipt_type so the
      //    accounting page can show سند قبض / سند صرف / سند إلغاء /
      //    إشعار دائن / إشعار مدين totals next to the company/broker
      //    views. Cancelled (refused) rows are excluded from totals
      //    downstream; we keep them in the raw list for display.
      let crQuery = supabase
        .from('receipts')
        .select(
          `id, receipt_date, amount, payment_method, voucher_number,
           receipt_number, cheque_number, notes, client_id, client_name,
           broker_id, company_id, policy_id, payment_id, car_number, cancelled_at,
           receipt_type,
           clients(id_number, phone_number),
           policies(document_number, policy_number, client_id, cars(car_number), clients(id_number, phone_number))`,
        )
        .in('receipt_type', ['payment', 'cancellation', 'disbursement', 'credit_note', 'debit_note'])
        .eq('is_imported', false)
        .order('receipt_date', { ascending: false });
      if (agentId) crQuery = crQuery.eq('agent_id', agentId);
      if (branchId) crQuery = crQuery.eq('branch_id', branchId);
      const { data: crData } = await crQuery;
      const mapClientReceipt = (r: RawClientReceipt & { broker_id?: string | null; receipt_type?: string }): ClientReceiptRow => ({
        id: r.id,
        receipt_date: r.receipt_date,
        amount: Number(r.amount ?? 0),
        payment_method: r.payment_method,
        voucher_number: r.voucher_number,
        receipt_number: r.receipt_number,
        cheque_number: r.cheque_number,
        notes: r.notes,
        // Trigger-mirrored payment rows leave receipts.client_id null;
        // fall through to the linked policy's client_id so the customer
        // filter on the accounting page still matches those rows.
        client_id: r.client_id ?? r.policies?.client_id ?? null,
        client_name: r.client_name,
        // Customer detail joined from `clients`. Prefer the direct
        // join (manual vouchers explicitly set receipts.client_id),
        // then fall back to the policy's client (auto-mirrored payment
        // / cancellation rows leave receipts.client_id null).
        client_id_number:
          r.clients?.id_number ?? r.policies?.clients?.id_number ?? null,
        client_phone:
          r.clients?.phone_number ?? r.policies?.clients?.phone_number ?? null,
        // Car number comes from either the denormalized column on
        // `receipts` (set by the cancellation flow) or the linked
        // policy's `cars` join. Prefer the denormalized value first
        // since refused-cheque rows null out the policy link.
        car_number: r.car_number ?? r.policies?.cars?.car_number ?? null,
        policy_id: r.policy_id,
        payment_id: r.payment_id ?? null,
        policy_document_number: r.policies?.document_number ?? null,
        policy_number: r.policies?.policy_number ?? null,
        cancelled_at: r.cancelled_at,
        receipt_type: (r.receipt_type as string) ?? '',
      });
      const crRows = (crData ?? []) as unknown as (RawClientReceipt & {
        receipt_type: string;
        broker_id?: string | null;
        company_id?: string | null;
      })[];

      // Look up the SHARED policy_payments.receipt_number ("R162/2026")
      // for every payment row in this fetch. That text is what the
      // user expects to see — a single number that covers a bulk
      // cheque collection across multiple policies. Without this
      // enrichment the accounting table prints "—" since the
      // receipts.voucher_number column is null on the auto-mirrored
      // payment rows.
      const paymentIdsToLookUp = Array.from(
        new Set(
          crRows
            .filter((r) =>
              (r.receipt_type === 'payment' || r.receipt_type === 'cancellation') &&
              r.payment_id != null,
            )
            .map((r) => r.payment_id as string),
        ),
      );
      const receiptNumberByPaymentId = new Map<string, string>();
      if (paymentIdsToLookUp.length > 0) {
        const { data: payMeta } = await supabase
          .from('policy_payments')
          .select('id, receipt_number')
          .in('id', paymentIdsToLookUp);
        for (const p of (payMeta ?? []) as { id: string; receipt_number: string | null }[]) {
          if (p.receipt_number) receiptNumberByPaymentId.set(p.id, p.receipt_number);
        }
      }

      // Build a per-type prefix used to synthesize a voucher label
      // when the row lacks one. Mirrors the kashf's formatVoucherNumber
      // so both surfaces agree on what "R12/2026" / "C5/2026" mean.
      const prefixForType: Record<string, string> = {
        payment: 'R',
        cancellation: 'R',
        credit_note: 'C',
        debit_note: 'M',
        disbursement: 'D',
        accident_fee: 'A',
      };
      const enrichVoucherNumber = (
        row: ClientReceiptRow,
      ): ClientReceiptRow => {
        if (row.voucher_number) return row;
        // Payment rows ride on the shared policy_payments.receipt_number
        // so a bulk session prints one label everywhere it appears.
        if (row.payment_id && receiptNumberByPaymentId.has(row.payment_id)) {
          return { ...row, voucher_number: receiptNumberByPaymentId.get(row.payment_id)! };
        }
        // Fallback for non-payment rows (or payment rows missing the
        // session text — older imports) — synthesize from the
        // receipts.receipt_number int + the per-type prefix.
        if (row.receipt_number == null) return row;
        const year = new Date(row.receipt_date).getFullYear();
        const prefix = prefixForType[row.receipt_type] ?? 'R';
        return { ...row, voucher_number: `${prefix}${row.receipt_number}/${year}` };
      };

      // payment + cancellation: client-side. Both ignore broker_id —
      // broker payments don't flow through the customer receipts
      // table. We keep cancelled (refused) rows in the raw list so
      // the سند الغاء sub-tab can render them; totals filter them.
      setClientPaymentsRaw(
        crRows
          .filter((r) => r.receipt_type === 'payment' && !r.broker_id)
          .map(mapClientReceipt)
          .map(enrichVoucherNumber),
      );
      setClientCancellationsRaw(
        crRows
          .filter((r) => r.receipt_type === 'cancellation' && !r.broker_id)
          .map(mapClientReceipt)
          .map(enrichVoucherNumber),
      );
      // disbursement rows: client-only (the broker disbursement
      // path uses the broker_settlements table directly, not the
      // receipts mirror).
      setClientDisbursementsRaw(
        crRows
          .filter((r) => r.receipt_type === 'disbursement')
          .map(mapClientReceipt)
          .map(enrichVoucherNumber),
      );
      // credit_note + debit_note rows: split THREE ways so each
      // accounting tab sees only its own bucket:
      //   • broker_id set        → broker credit/debit note
      //   • company_id set       → company credit/debit note
      //   • neither               → client credit/debit note
      // AddCompanyDebitNoteDialog writes rows with company_id and
      // null client_id/broker_id, so without this split they used to
      // leak into the clientCreditNotes bucket.
      const creditNoteRows = crRows.filter((r) => r.receipt_type === 'credit_note' || r.receipt_type === 'debit_note');
      setClientCreditNotesRaw(
        creditNoteRows
          .filter((r) => !r.broker_id && !r.company_id)
          .map(mapClientReceipt)
          .map(enrichVoucherNumber),
      );
      setBrokerCreditNotesRaw(
        creditNoteRows
          .filter((r) => !!r.broker_id)
          .map((r) => ({ ...enrichVoucherNumber(mapClientReceipt(r)), broker_id: r.broker_id ?? null }) as ClientReceiptRow & { broker_id: string | null }),
      );
      setCompanyCreditNotesRaw(
        creditNoteRows
          .filter((r) => !r.broker_id && !!r.company_id)
          .map(mapClientReceipt)
          .map(enrichVoucherNumber),
      );

      // 7. Expenses — only the sum is needed by the pills, but the full
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

  // Client receipt filters reuse the date + payment-method slice of
  // the same AccountingFiltersValue used for company / broker tables.
  // Company / type filters don't apply (a client receipt isn't tied
  // to a single insurance company or policy type).
  const filteredClientPayments = useMemo(
    () => applyClientReceiptFilters(clientPaymentsRaw, filters),
    [clientPaymentsRaw, filters],
  );
  const filteredClientCancellations = useMemo(
    () => applyClientReceiptFilters(clientCancellationsRaw, filters),
    [clientCancellationsRaw, filters],
  );
  const filteredClientDisbursements = useMemo(
    () => applyClientReceiptFilters(clientDisbursementsRaw, filters),
    [clientDisbursementsRaw, filters],
  );
  const filteredClientCreditNotes = useMemo(
    () => applyClientReceiptFilters(clientCreditNotesRaw, filters),
    [clientCreditNotesRaw, filters],
  );
  const filteredBrokerCreditNotes = useMemo(
    () => applyClientReceiptFilters(brokerCreditNotesRaw, filters),
    [brokerCreditNotesRaw, filters],
  );
  const filteredCompanyCreditNotes = useMemo(
    () => applyClientReceiptFilters(companyCreditNotesRaw, filters),
    [companyCreditNotesRaw, filters],
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
    clientPayments: filteredClientPayments,
    clientCancellations: filteredClientCancellations,
    clientDisbursements: filteredClientDisbursements,
    clientCreditNotes: filteredClientCreditNotes,
    brokerCreditNotes: filteredBrokerCreditNotes,
    companyCreditNotes: filteredCompanyCreditNotes,
    expensesTotal,
    refresh: fetchAll,
    patchSubPolicy,
  };
}

/** Date + payment-method filter for client receipts. Mirrors the
 *  company/broker filter shape so all settlement-like tables behave
 *  consistently on the accounting page. */
function applyClientReceiptFilters(
  rows: ClientReceiptRow[],
  filters: AccountingFiltersValue,
): ClientReceiptRow[] {
  let out = rows;
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    out = out.filter((r) => new Date(r.receipt_date).getTime() >= from);
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    to.setHours(23, 59, 59, 999);
    const toMs = to.getTime();
    out = out.filter((r) => new Date(r.receipt_date).getTime() <= toMs);
  }
  if (filters.paymentMethods.length > 0) {
    const set = new Set(filters.paymentMethods);
    out = out.filter((r) => r.payment_method != null && set.has(r.payment_method));
  }
  return out;
}

/** Free-text search over a client receipt's identifiers — client
 *  name, voucher number, cheque number, notes. */
export function matchesClientReceiptSearch(
  row: ClientReceiptRow,
  q: string,
): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  const fields: (string | null | undefined)[] = [
    row.client_name,
    row.voucher_number,
    row.cheque_number,
    row.policy_document_number,
    row.notes,
  ];
  return fields.some((v) => v != null && v.toLowerCase().includes(term));
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
