import { format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { IssuanceRow } from './accountingTypes';
import type { SettlementRow } from './SettlementsTable';
import { policyTypeLabel, PAYMENT_METHOD_LABELS } from './accountingTypes';

type StatTone = 'primary' | 'destructive' | 'success' | 'amber' | 'emerald';

interface ReportPayload {
  title: string;
  subtitle?: string;
  meta?: { label: string; value: string }[];
  stats: { label: string; value: string; tone?: StatTone }[];
  columns: { key: string; label: string; align?: 'right' | 'left' | 'center' }[];
  rows: Record<string, string | number | null>[];
  total_key?: string | null;
  total_label?: string | null;
}

const fmtMoney = (n: number) => `₪${Math.round(Number(n || 0)).toLocaleString('en-US')}`;
const fmtDate = (s: string | null | undefined): string => {
  if (!s) return '';
  try {
    return format(parseISO(s), 'dd/MM/yyyy');
  } catch {
    return s;
  }
};

const STATUS_LABEL: Record<string, string> = {
  completed: 'مكتمل',
  pending: 'معلّق',
};

export interface ReportContext {
  /** Which entity surface — drives the title prefix. */
  section: 'companies' | 'brokers';
  /** Active sub-tab. */
  tab: 'all' | 'issuances' | 'returns' | 'disbursements' | 'receipts';
  /** Optional human-readable filter summary (e.g. "01/04/2026 → 30/04/2026"). */
  filterSummary?: string;
}

interface CompanyTotals {
  insuranceSum: number;
  dueGrossSum: number;
  dueSum: number;
  profitSum: number;
  disbursedSum: number;
  netProfitSum: number;
}

interface BrokerTotals {
  sellSum: number;
  profitSum: number;
  remainingFromBrokersSum: number;
  receivedSum: number;
}

/** KPI pills mirroring the on-screen company summary bar. */
export function buildCompanyStats(totals: CompanyTotals): ReportPayload['stats'] {
  return [
    { label: 'إجمالي سعر التأمين', value: fmtMoney(totals.insuranceSum), tone: 'primary' },
    { label: 'المستحق للشركات (إجمالي)', value: fmtMoney(totals.dueGrossSum), tone: 'destructive' },
    { label: 'المستحق للشركات (صافي)', value: fmtMoney(totals.dueSum), tone: 'destructive' },
    { label: 'الأرباح + العمولات', value: fmtMoney(totals.profitSum), tone: 'success' },
    { label: 'مدفوع للشركات', value: fmtMoney(totals.disbursedSum), tone: 'amber' },
    {
      label: 'الأرباح الصافية',
      value: fmtMoney(totals.netProfitSum),
      tone: totals.netProfitSum >= 0 ? 'emerald' : 'destructive',
    },
  ];
}

/** KPI pills mirroring the on-screen broker summary bar. */
export function buildBrokerStats(totals: BrokerTotals): ReportPayload['stats'] {
  return [
    { label: 'سعر البيع للعميل', value: fmtMoney(totals.sellSum), tone: 'primary' },
    { label: 'المتبقي على الوسطاء', value: fmtMoney(totals.remainingFromBrokersSum), tone: 'destructive' },
    { label: 'مقبوض من الوسطاء', value: fmtMoney(totals.receivedSum), tone: 'emerald' },
    { label: 'الربح', value: fmtMoney(totals.profitSum), tone: 'success' },
  ];
}

const ISSUANCE_COLUMNS: ReportPayload['columns'] = [
  { key: 'idx', label: '#', align: 'center' },
  { key: 'document_number', label: 'رقم المعاملة', align: 'right' },
  { key: 'client_name', label: 'العميل', align: 'right' },
  { key: 'company_name', label: 'الشركة', align: 'right' },
  { key: 'policy_type', label: 'النوع', align: 'right' },
  { key: 'issue_date', label: 'تاريخ الإصدار', align: 'right' },
  { key: 'insurance_price', label: 'سعر التأمين', align: 'right' },
  { key: 'payed_for_company', label: 'المستحق للشركة', align: 'right' },
  { key: 'profit', label: 'الربح + العمولة', align: 'right' },
  { key: 'receipts_total', label: 'المدفوع', align: 'right' },
];

const BROKER_ISSUANCE_COLUMNS: ReportPayload['columns'] = [
  { key: 'idx', label: '#', align: 'center' },
  { key: 'document_number', label: 'رقم المعاملة', align: 'right' },
  { key: 'client_name', label: 'العميل', align: 'right' },
  { key: 'company_name', label: 'الوسيط/الشركة', align: 'right' },
  { key: 'policy_type', label: 'النوع', align: 'right' },
  { key: 'issue_date', label: 'تاريخ الإصدار', align: 'right' },
  { key: 'broker_buy_price', label: 'سعر الشراء', align: 'right' },
  { key: 'insurance_price', label: 'سعر البيع', align: 'right' },
  { key: 'profit', label: 'الربح', align: 'right' },
];

const SETTLEMENT_COLUMNS: ReportPayload['columns'] = [
  { key: 'idx', label: '#', align: 'center' },
  { key: 'date', label: 'التاريخ', align: 'right' },
  { key: 'entity', label: 'الجهة', align: 'right' },
  { key: 'payment_type', label: 'طريقة الدفع', align: 'right' },
  { key: 'cheque_number', label: 'رقم الشيك', align: 'right' },
  { key: 'status', label: 'الحالة', align: 'right' },
  { key: 'notes', label: 'ملاحظات', align: 'right' },
  { key: 'amount', label: 'المبلغ', align: 'right' },
];

function issuanceRows(rows: IssuanceRow[]): ReportPayload['rows'] {
  return rows.map((r, i) => {
    const main = r.main;
    return {
      idx: i + 1,
      document_number: r.document_number ?? '',
      client_name: r.client_name ?? '',
      company_name: main.company_name ?? '',
      policy_type: policyTypeLabel(main.policy_type_parent, main.policy_type_child),
      issue_date: fmtDate(main.issue_date ?? main.start_date),
      insurance_price: fmtMoney(r.insurance_price),
      payed_for_company: fmtMoney(r.payed_for_company),
      profit: fmtMoney((r.profit ?? 0) + (r.office_commission ?? 0)),
      receipts_total: fmtMoney(r.receipts_total),
    };
  });
}

function brokerIssuanceRows(rows: IssuanceRow[]): ReportPayload['rows'] {
  return rows.map((r, i) => {
    const main = r.main;
    return {
      idx: i + 1,
      document_number: r.document_number ?? '',
      client_name: r.client_name ?? '',
      company_name: main.company_name ?? '',
      policy_type: policyTypeLabel(main.policy_type_parent, main.policy_type_child),
      issue_date: fmtDate(main.issue_date ?? main.start_date),
      broker_buy_price: fmtMoney(r.broker_buy_price),
      insurance_price: fmtMoney(r.insurance_price),
      profit: fmtMoney(r.profit),
    };
  });
}

function settlementRows(rows: SettlementRow[]): ReportPayload['rows'] {
  return rows.map((r, i) => {
    const status = r.refused ? 'مرفوض' : (STATUS_LABEL[r.status] ?? r.status);
    return {
      idx: i + 1,
      date: fmtDate(r.settlement_date),
      entity: r.entity_name ?? '',
      payment_type: r.payment_type ? (PAYMENT_METHOD_LABELS[r.payment_type] ?? r.payment_type) : '',
      cheque_number: r.cheque_number ?? '',
      status,
      notes: r.notes ?? '',
      amount: fmtMoney(r.total_amount),
    };
  });
}

const TAB_LABEL: Record<ReportContext['tab'], string> = {
  all: 'كل المعاملات',
  issuances: 'الإصدارات',
  returns: 'المرتجعات',
  disbursements: 'سندات الصرف',
  receipts: 'سندات القبض',
};

function buildTitle(ctx: ReportContext): string {
  const sectionLabel = ctx.section === 'companies' ? 'شركات التأمين' : 'الوسطاء';
  return `${TAB_LABEL[ctx.tab]} — ${sectionLabel}`;
}

interface BuildArgs {
  ctx: ReportContext;
  stats: ReportPayload['stats'];
  issuances?: IssuanceRow[];
  settlements?: SettlementRow[];
}

/** Construct the report payload. The caller supplies whichever row set
 *  matches the active tab (issuances or settlements). */
export function buildAccountingReportPayload({ ctx, stats, issuances, settlements }: BuildArgs): ReportPayload {
  const subtitle = ctx.filterSummary || undefined;

  if (ctx.tab === 'disbursements' || ctx.tab === 'receipts') {
    const rows = settlementRows(settlements ?? []);
    return {
      title: buildTitle(ctx),
      subtitle,
      stats,
      columns: SETTLEMENT_COLUMNS,
      rows,
      total_key: 'amount',
      total_label: 'إجمالي السندات',
    };
  }

  // Issuance-style tabs: all / issuances / returns
  const list = issuances ?? [];
  const isBroker = ctx.section === 'brokers';
  return {
    title: buildTitle(ctx),
    subtitle,
    stats,
    columns: isBroker ? BROKER_ISSUANCE_COLUMNS : ISSUANCE_COLUMNS,
    rows: isBroker ? brokerIssuanceRows(list) : issuanceRows(list),
    total_key: 'insurance_price',
    total_label: 'إجمالي سعر التأمين',
  };
}

/** Calls the edge function and opens the returned URL in a new tab. */
export async function printAccountingReport(payload: ReportPayload): Promise<void> {
  if (payload.rows.length === 0) {
    toast.error('لا توجد سجلات لطباعتها');
    return;
  }
  try {
    const { data, error } = await supabase.functions.invoke('generate-accounting-report', {
      body: payload,
    });
    if (error) throw error;
    const url = data?.report_url;
    if (url) {
      window.open(url, '_blank');
    } else {
      toast.error('لم يتم العثور على رابط التقرير');
    }
  } catch (e) {
    console.error('Print accounting report error:', e);
    toast.error('فشل في توليد التقرير');
  }
}
