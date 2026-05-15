import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ReceiptActionsDialog, type VoucherActionRow } from './ReceiptActionsDialog';
import { format, parseISO } from 'date-fns';
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarRange,
  Check,
  ChevronsUpDown,
  FileText,
  Loader2,
  Plus,
  Printer,
  RotateCcw,
  LayoutGrid,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { AddSettlementDialog, SettlementKind } from './AddSettlementDialog';
import { EditSettlementDialog } from './EditSettlementDialog';
import { QuickIssuanceDialog, IssuanceMode } from './QuickIssuanceDialog';
import { SettlementRow } from './SettlementsTable';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CompanyIssuancesTable } from './CompanyIssuancesTable';
import { SettlementsTable } from './SettlementsTable';
import {
  COMPANY_ISSUANCE_COLUMNS,
  ISSUANCE_DEFAULT_OFF,
  SETTLEMENT_COLUMNS,
  SETTLEMENT_DEFAULT_OFF,
} from './columnDefs';
import { AccountingFilters, AccountingFiltersValue } from './AccountingFilters';
import { ManageColumnsDropdown } from './ManageColumnsDropdown';
import { useTableColumnVisibility } from '@/hooks/useTableColumnVisibility';
import {
  matchesIssuanceSearch,
  matchesSettlementSearch,
  useAccountingData,
} from './useAccountingData';
import {
  IssuanceEditOverlay,
  IssuanceEditPatch,
  IssuanceRow,
  POLICY_TYPE_DISPLAY,
  PAYMENT_METHOD_LABELS,
  applyOverlay,
} from './accountingTypes';
import {
  buildAccountingReportPayload,
  buildCompanyStats,
  printAccountingReport,
} from './printAccountingReport';

type SubTab = 'all' | 'issuances' | 'returns' | 'disbursements' | 'receipts';

const TABS: { key: SubTab; label: string; Icon: LucideIcon }[] = [
  { key: 'all', label: 'الكل', Icon: LayoutGrid },
  { key: 'issuances', label: 'الإصدارات', Icon: FileText },
  { key: 'returns', label: 'الإصدارات الملغية', Icon: RotateCcw },
  { key: 'disbursements', label: 'سند الصرف', Icon: ArrowUpRight },
  { key: 'receipts', label: 'سند القبض', Icon: ArrowDownRight },
];

const ISSUANCE_KEYS = COMPANY_ISSUANCE_COLUMNS.map((c) => c.key);
const ISSUANCE_DEFAULT_VISIBLE = ISSUANCE_KEYS.filter((k) => !ISSUANCE_DEFAULT_OFF.has(k));
const SETTLEMENT_KEYS = SETTLEMENT_COLUMNS.map((c) => c.key);
const SETTLEMENT_DEFAULT_VISIBLE = SETTLEMENT_KEYS.filter((k) => !SETTLEMENT_DEFAULT_OFF.has(k));

interface CompaniesSectionProps {
  /** When set (typically from a deep link), the section finds the
   *  matching settlement, switches to the right sub-tab, and the
   *  table scrolls + highlights the row. */
  focusSettlementId?: string | null;
  /** Page-level branch filter (global admins only). null = no extra
   *  filter — caller's natural RLS scope still applies. */
  branchId?: string | null;
}

export function CompaniesSection({ focusSettlementId, branchId }: CompaniesSectionProps = {}) {
  const [tab, setTab] = useState<SubTab>('all');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<SettlementKind>('disbursement');
  const [editRow, setEditRow] = useState<SettlementRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [issuanceOpen, setIssuanceOpen] = useState(false);
  const [issuanceMode, setIssuanceMode] = useState<IssuanceMode>('issue');
  // Live overlay of inline edits across the issuances table — owned
  // here so the summary pills + calculation modal can mirror the cell
  // values before the debounced save flushes back. Keyed by row.id.
  const [editLocal, setEditLocal] = useState<IssuanceEditOverlay>({});
  const onPatch = (rowId: string, patch: IssuanceEditPatch) =>
    setEditLocal((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] ?? {}), ...patch } }));
  // Default to the current calendar month to match the customer
  // accounting tab — the page loads pre-scoped so opening it on the
  // 18th doesn't dump the whole year onto the screen.
  const [filters, setFilters] = useState<AccountingFiltersValue>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const pad = (n: number) => String(n).padStart(2, '0');
    const lastDay = new Date(y, m + 1, 0).getDate();
    return {
      dateFrom: `${y}-${pad(m + 1)}-01`,
      dateTo: `${y}-${pad(m + 1)}-${pad(lastDay)}`,
      companies: [],
      types: [],
      paymentMethods: [],
    };
  });
  // Single-company picker outside the Filter popover — mirrors the
  // customer picker on ClientsSection. When set, every list collapses
  // to that company's rows.
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  // Voucher action picker (print / SMS / WhatsApp) when the user
  // clicks a settlement's voucher number — same dialog the customer
  // accounting page uses. Company settlements live in their own table
  // (`company_settlements`); the receipts mirror gives us the
  // `voucher_receipt_id` send-voucher / generate-voucher expects, so
  // we resolve it lazily on click.
  const [voucherActionRow, setVoucherActionRow] = useState<VoucherActionRow | null>(null);

  const openSettlementVoucher = async (row: SettlementRow, kind: 'disbursement' | 'payment') => {
    // company_settlements rows are mirrored into the receipts table
    // via `company_settlement_id`. Look up the mirror so the action
    // dialog has a real receipts.id to feed generate-voucher /
    // send-voucher. Old settlement rows without a mirror fall back
    // to a print-only message.
    const { data: mirror, error } = await supabase
      .from('receipts')
      .select('id, receipt_type, payment_id, voucher_number, client_id, broker_id')
      .eq('company_settlement_id', row.id)
      .maybeSingle();
    if (error || !mirror) {
      toast.error('السند غير متوفر للطباعة/الإرسال');
      return;
    }
    const r = mirror as {
      id: string;
      receipt_type: string;
      payment_id: string | null;
      voucher_number: string | null;
    };
    setVoucherActionRow({
      id: r.id,
      receipt_type: r.receipt_type || kind,
      voucher_number: r.voucher_number ?? row.cheque_number ?? null,
      payment_id: r.payment_id ?? null,
      client_name: row.entity_name ?? null,
      // Companies don't have a "to-customer" phone for SMS/WhatsApp
      // in the receipts mirror — send-voucher handles broker rows but
      // for company-counterparty vouchers we'd need agency-side
      // wiring. Pass null for now; the dialog disables SMS/WhatsApp
      // and the user can still print.
      client_phone: null,
    });
  };

  const data = useAccountingData(filters, branchId);

  // Auto-switch sub-tab when a deep-link points at a specific settlement
  // — disbursement rows live under the disbursements tab, receipts under
  // receipts. The match runs against the loaded data; if the settlement
  // hasn't been fetched yet, the effect re-runs once the data lands.
  useEffect(() => {
    if (!focusSettlementId) return;
    if (data.companySettlements.some((r) => r.id === focusSettlementId)) {
      setTab('disbursements');
    } else if (data.companyReceipts.some((r) => r.id === focusSettlementId)) {
      setTab('receipts');
    }
  }, [focusSettlementId, data.companySettlements, data.companyReceipts]);

  const handleDelete = async (row: SettlementRow) => {
    // If the voucher consumed customer cheques, release them back to
    // the available pool so they can be re-used for another settlement.
    const { data: settlement, error: readError } = await supabase
      .from('company_settlements')
      .select('customer_cheque_ids')
      .eq('id', row.id)
      .maybeSingle();
    if (!readError && settlement) {
      const ids = (settlement as { customer_cheque_ids?: string[] | null }).customer_cheque_ids;
      if (Array.isArray(ids) && ids.length > 0) {
        await supabase
          .from('policy_payments')
          .update({
            cheque_status: 'pending',
            transferred_to_type: null,
            transferred_to_id: null,
            transferred_payment_id: null,
            transferred_at: null,
          })
          .in('id', ids);
      }
    }
    const { error } = await supabase.from('company_settlements').delete().eq('id', row.id);
    if (error) {
      toast.error(`فشل الحذف: ${error.message}`);
      return;
    }
    toast.success('تم حذف السند');
    data.refresh();
  };

  const handleEdit = (row: SettlementRow) => {
    setEditRow(row);
    setEditOpen(true);
  };

  // One visibility state per logical table type. Issuance tabs (all /
  // issuances / returns) all show the same column set, so they share
  // a single store. Disbursements + receipts share another. v3 forces
  // a clean slate after the layout refactor.
  const issuanceCols = useTableColumnVisibility(
    'accounting-companies-issuances-v4',
    ISSUANCE_DEFAULT_VISIBLE,
    ISSUANCE_KEYS,
  );
  const settlementCols = useTableColumnVisibility(
    'accounting-companies-settlements-v3',
    SETTLEMENT_DEFAULT_VISIBLE,
    SETTLEMENT_KEYS,
  );

  const isSettlementTab = tab === 'disbursements' || tab === 'receipts';
  const activeColumns = isSettlementTab ? SETTLEMENT_COLUMNS : COMPANY_ISSUANCE_COLUMNS;
  const activeState = isSettlementTab ? settlementCols : issuanceCols;

  const companyOptions = useMemo(
    () =>
      data.companies
        .filter((c) => !c.broker_id)
        .map((c) => ({ value: c.id, label: c.name_ar || c.name })),
    [data.companies],
  );
  const typeOptions = useMemo(
    () => Object.entries(POLICY_TYPE_DISPLAY).map(([value, label]) => ({ value, label })),
    [],
  );
  const paymentOptions = useMemo(
    () => Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
    [],
  );

  // Companies tab includes:
  //   - direct policies (no broker)
  //   - to_broker policies — broker resells, but we still issued via
  //     the company so we owe payed_for_company
  // Excludes from_broker — there the broker is the principal and we
  // owe the broker (broker_buy_price), tracked under the brokers tab.
  const isCompanyRelevant = (r: IssuanceRow) =>
    r.main.broker_direction !== 'from_broker';
  // Sort + per-company filter pulled from the same source-of-truth so
  // every list reflects the picker / sort selection consistently.
  const sortDirCo: 'newest' | 'oldest' = filters.sort ?? 'newest';
  const compareIssuanceDates = (a: IssuanceRow, b: IssuanceRow): number => {
    const at = a.main.issue_date ?? a.main.start_date;
    const bt = b.main.issue_date ?? b.main.start_date;
    const av = at ? new Date(at).getTime() : 0;
    const bv = bt ? new Date(bt).getTime() : 0;
    return sortDirCo === 'newest' ? bv - av : av - bv;
  };
  const compareSettlementDates = (a: SettlementRow, b: SettlementRow): number => {
    const av = a.settlement_date ? new Date(a.settlement_date).getTime() : 0;
    const bv = b.settlement_date ? new Date(b.settlement_date).getTime() : 0;
    return sortDirCo === 'newest' ? bv - av : av - bv;
  };
  const matchesSelectedCompany = (r: IssuanceRow) =>
    !selectedCompanyId || r.main.company_id === selectedCompanyId;
  const matchesSelectedCompanyOnSettlement = (r: SettlementRow) =>
    !selectedCompanyId || r.entity_id === selectedCompanyId;
  const issuancesAll = useMemo(
    () =>
      [...data.issuances, ...data.returns]
        .filter(isCompanyRelevant)
        .filter(matchesSelectedCompany)
        .filter((r) => matchesIssuanceSearch(r, search))
        .slice()
        .sort(compareIssuanceDates),
    [data.issuances, data.returns, search, selectedCompanyId, sortDirCo],
  );
  const issuancesActive = useMemo(
    () =>
      data.issuances
        .filter(isCompanyRelevant)
        .filter(matchesSelectedCompany)
        .filter((r) => matchesIssuanceSearch(r, search))
        .slice()
        .sort(compareIssuanceDates),
    [data.issuances, search, selectedCompanyId, sortDirCo],
  );
  const returns = useMemo(
    () =>
      data.returns
        .filter(isCompanyRelevant)
        .filter(matchesSelectedCompany)
        .filter((r) => matchesIssuanceSearch(r, search))
        .slice()
        .sort(compareIssuanceDates),
    [data.returns, search, selectedCompanyId, sortDirCo],
  );
  const companySettlements = useMemo(
    () =>
      data.companySettlements
        .filter(matchesSelectedCompanyOnSettlement)
        .filter((r) => matchesSettlementSearch(r, search))
        .slice()
        .sort(compareSettlementDates),
    [data.companySettlements, search, selectedCompanyId, sortDirCo],
  );
  const companyReceipts = useMemo(
    () =>
      data.companyReceipts
        .filter(matchesSelectedCompanyOnSettlement)
        .filter((r) => matchesSettlementSearch(r, search))
        .slice()
        .sort(compareSettlementDates),
    [data.companyReceipts, search, selectedCompanyId, sortDirCo],
  );

  // from_broker policies don't appear in issuancesActive (they belong
  // to the brokers tab), but their profit still feeds الأرباح الصافية
  // since the office earned that margin. to_broker profits are already
  // captured in profitOnly via issuancesActive — including them here
  // would double-count.
  const brokerProfit = useMemo(() => {
    const fromBrokerRows = data.issuances.filter(
      (r) => r.main.broker_direction === 'from_broker',
    );
    return fromBrokerRows.reduce(
      (s, r) =>
        s + Math.max(0, Number(r.insurance_price || 0) - Number(r.broker_buy_price || 0)),
      0,
    );
  }, [data.issuances]);

  const totals = useMemo(() => {
    // Apply the live edit overlay so the pills move in lock-step with
    // the table cells the user is typing into.
    const overlayed = issuancesActive.map((r) => applyOverlay(r, editLocal));
    const insuranceSum = overlayed.reduce((s, r) => s + Number(r.insurance_price || 0), 0);
    // Total owed to companies — sum across active policies.
    const totalDue = overlayed.reduce((s, r) => s + Number(r.payed_for_company || 0), 0);
    const profitOnly = overlayed.reduce((s, r) => s + Number(r.profit || 0), 0);
    const commissionOnly = overlayed.reduce((s, r) => s + Number(r.office_commission || 0), 0);
    const profitSum = profitOnly + commissionOnly;
    // Returns adjustments — a cancelled policy with payed_for_company
    // entered as a negative number represents money the company refunds
    // to us (per the QuickIssuanceDialog convention). Summing returns'
    // payed_for_company directly into totalDue therefore reduces the
    // net debt naturally. Same idea for profit/commission on returns —
    // they fold into الأرباح الصافية so the user sees their effect.
    const returnsDueDelta = returns.reduce(
      (s, r) => s + Number(r.payed_for_company || 0),
      0,
    );
    const returnsProfitDelta = returns.reduce(
      (s, r) => s + Number(r.profit || 0) + Number(r.office_commission || 0),
      0,
    );
    // Disbursed = money we actually paid the companies (outgoing
    // settlements only, refused excluded).
    const disbursedSum = companySettlements
      .filter((r) => !r.refused)
      .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    // Gross "owed to companies" — lifetime obligation across active
    // policies, after netting in the returns delta but BEFORE we
    // subtract what we've already paid them.
    const dueGrossSum = Math.max(0, totalDue + returnsDueDelta);
    // Net "still owe the companies" — today's debt, after also
    // subtracting outgoing settlements.
    const dueSum = Math.max(0, totalDue + returnsDueDelta - disbursedSum);
    // Net profit = (companies profit + commission + brokers profit +
    // returns adjustments) − expenses. issuancesActive already excludes
    // cancelled policies, so the cancellation rule ("no profit on
    // cancelled") still holds for active rows; returnsProfitDelta then
    // re-adds whatever ربح/خسارة the user explicitly logged on the
    // مرتجع row. brokerProfit derives from data.issuances which is
    // post-cancelled-filter.
    const netProfitSum =
      profitSum + brokerProfit + returnsProfitDelta - data.expensesTotal;
    return {
      insuranceSum,
      dueSum,
      dueGrossSum,
      profitSum,
      disbursedSum,
      totalDue,
      returnsDueDelta,
      returnsProfitDelta,
      profitOnly,
      commissionOnly,
      brokerProfit,
      netProfitSum,
      activeCount: overlayed.length,
    };
  }, [
    issuancesActive,
    returns,
    companySettlements,
    editLocal,
    data.expensesTotal,
    brokerProfit,
  ]);

  const fmt = (n: number) => `₪${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  const activeRowCount =
    tab === 'all'
      ? issuancesAll.length
      : tab === 'issuances'
      ? issuancesActive.length
      : tab === 'returns'
      ? returns.length
      : tab === 'disbursements'
      ? companySettlements.length
      : companyReceipts.length;
  const countLabel = isSettlementTab ? 'سند' : 'معاملة';

  const [printing, setPrinting] = useState(false);
  const handlePrint = async () => {
    setPrinting(true);
    try {
      // Pick the row set the user is currently looking at — same arrays
      // that feed the active TabsContent below.
      const issuanceList =
        tab === 'all' ? issuancesAll : tab === 'issuances' ? issuancesActive : tab === 'returns' ? returns : undefined;
      const settlementList =
        tab === 'disbursements' ? companySettlements : tab === 'receipts' ? companyReceipts : undefined;

      const filterBits: string[] = [];
      if (filters.dateFrom || filters.dateTo) {
        filterBits.push(`التاريخ: ${filters.dateFrom || '—'} → ${filters.dateTo || '—'}`);
      }
      if (search) filterBits.push(`بحث: "${search}"`);

      const payload = buildAccountingReportPayload({
        ctx: {
          section: 'companies',
          tab,
          filterSummary: filterBits.length > 0 ? filterBits.join(' · ') : undefined,
        },
        stats: buildCompanyStats(totals),
        issuances: issuanceList,
        settlements: settlementList,
      });
      await printAccountingReport(payload);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Compact summary strip — single horizontal row of pills.
          المستحق shows TODAY's net debt (gross owed minus what we've
          already paid) so adding a سند صرف visibly reduces the pill.
          Hover any pill for a breakdown of how the number was computed
          (respects the active filter set). */}
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 rounded-lg border bg-card p-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:p-0 sm:px-3 sm:py-2">
          <SummaryPill
            label="إجمالي سعر التأمين"
            value={fmt(totals.insuranceSum)}
            tone="primary"
            tooltip={
              <BreakdownLines
                title="إجمالي سعر التأمين"
                lines={[
                  { label: 'عدد المعاملات', value: `${totals.activeCount}` },
                  { label: 'مجموع سعر التأمين', value: fmt(totals.insuranceSum) },
                ]}
              />
            }
          />
          <Sep />
          <SummaryPill
            label="المستحق للشركات (إجمالي)"
            value={fmt(totals.dueGrossSum)}
            tone="destructive"
            tooltip={
              <BreakdownLines
                title="المستحق للشركات (إجمالي)"
                lines={[
                  { label: 'إجمالي مستحق من البوالص النشطة', value: fmt(totals.totalDue) },
                  {
                    label: 'تعديل المرتجعات',
                    value:
                      totals.returnsDueDelta >= 0
                        ? `+ ${fmt(totals.returnsDueDelta)}`
                        : `− ${fmt(Math.abs(totals.returnsDueDelta))}`,
                  },
                  { label: 'الإجمالي قبل المدفوعات', value: fmt(totals.dueGrossSum), strong: true },
                  {
                    label: 'ملاحظة',
                    value: 'لا يطرح ما تم دفعه — راجع pill "صافي"',
                    muted: true,
                  },
                ]}
              />
            }
          />
          <Sep />
          <SummaryPill
            label="المستحق للشركات (صافي)"
            value={fmt(totals.dueSum)}
            tone="destructive"
            tooltip={
              <BreakdownLines
                title="المستحق للشركات (صافي)"
                lines={[
                  { label: 'إجمالي مستحق من البوالص النشطة', value: fmt(totals.totalDue) },
                  {
                    label: 'تعديل المرتجعات',
                    value:
                      totals.returnsDueDelta >= 0
                        ? `+ ${fmt(totals.returnsDueDelta)}`
                        : `− ${fmt(Math.abs(totals.returnsDueDelta))}`,
                  },
                  { label: 'مدفوع للشركات', value: `− ${fmt(totals.disbursedSum)}` },
                  { label: 'المتبقي', value: fmt(totals.dueSum), strong: true },
                ]}
              />
            }
          />
          <Sep />
          <SummaryPill
            label="الأرباح + العمولات"
            value={fmt(totals.profitSum)}
            tone="success"
            tooltip={
              <BreakdownLines
                title="الأرباح + العمولات"
                lines={[
                  { label: 'الأرباح', value: fmt(totals.profitOnly) },
                  { label: 'عمولة المكتب', value: `+ ${fmt(totals.commissionOnly)}` },
                  { label: 'الإجمالي', value: fmt(totals.profitSum), strong: true },
                ]}
              />
            }
          />
          <Sep />
          <SummaryPill
            label="مدفوع للشركات"
            value={fmt(totals.disbursedSum)}
            tone="amber"
            tooltip={
              <BreakdownLines
                title="مدفوع للشركات"
                lines={[
                  {
                    label: 'سندات الصرف غير المرفوضة',
                    value: `${companySettlements.filter((r) => !r.refused).length}`,
                  },
                  { label: 'الإجمالي', value: fmt(totals.disbursedSum), strong: true },
                ]}
              />
            }
          />
          <Sep />
          <SummaryPill
            label="الأرباح الصافية"
            value={fmt(totals.netProfitSum)}
            tone={totals.netProfitSum >= 0 ? 'emerald' : 'destructive'}
            tooltip={
              <BreakdownLines
                title="الأرباح الصافية"
                lines={[
                  { label: 'ربح الشركات', value: fmt(totals.profitOnly) },
                  { label: 'عمولة المكتب', value: `+ ${fmt(totals.commissionOnly)}` },
                  { label: 'ربح الوسطاء', value: `+ ${fmt(totals.brokerProfit)}` },
                  {
                    label: 'المرتجع من الشركات',
                    value:
                      totals.returnsProfitDelta >= 0
                        ? `+ ${fmt(totals.returnsProfitDelta)}`
                        : `− ${fmt(Math.abs(totals.returnsProfitDelta))}`,
                  },
                  { label: 'المصاريف', value: `− ${fmt(data.expensesTotal)}` },
                  { label: 'الصافي', value: fmt(totals.netProfitSum), strong: true },
                ]}
              />
            }
          />
        </div>
      </TooltipProvider>

      {/* Single toolbar row: sub-tabs + count + manage columns + filter. */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
          <TabsList className="h-9">
            {TABS.map(({ key, label, Icon }) => (
              <TabsTrigger key={key} value={key} className="gap-1.5 h-7 px-2.5">
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:mr-auto">
          <div className="relative w-full sm:w-80 md:w-96">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم، رقم المعاملة، الهوية…"
              className="h-8 w-full pr-8 text-sm"
            />
          </div>
          {/* Per the user: remove every action button from the
              accounting toolbar — print, "إضافة إصدار يدوي",
              "إضافة سند صرف/قبض" — "كل الزرار شيلهم بعدين منشتغل
              عليهم". The QuickIssuanceDialog + AddSettlementDialog
              state/render stays mounted below so we can re-wire
              triggers later without losing the dialog plumbing. */}
          <span className="text-xs text-muted-foreground">
            {data.loading ? '...' : `${activeRowCount} ${countLabel}`}
          </span>
          <ManageColumnsDropdown
            columns={activeColumns}
            visible={activeState.visible}
            onToggle={activeState.toggle}
            onReset={activeState.reset}
          />
          <CompanyPicker
            value={selectedCompanyId}
            options={companyOptions}
            onChange={setSelectedCompanyId}
          />
          <AccountingFilters
            value={filters}
            onChange={setFilters}
            companyOptions={companyOptions}
            typeOptions={typeOptions}
            paymentMethodOptions={paymentOptions}
            show={{
              dateRange: true,
              // Company multi-select moves to the dedicated picker
              // above so only one source-of-truth narrows by company.
              companies: false,
              types: !isSettlementTab,
              paymentMethods: true,
              sort: true,
            }}
          />
        </div>
      </div>

      {/* Active-filter strip — same pattern as the customers tab so the
          two surfaces feel like one product. Shows the date scope
          (Arabic month name when it's a clean first-to-last range,
          raw range otherwise) and a chip for the locked company that
          can be cleared with an X. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary" className="gap-1.5 font-medium">
          <CalendarRange className="h-3.5 w-3.5" />
          {describeAccountingRange(filters.dateFrom, filters.dateTo)}
        </Badge>
        {selectedCompanyId ? (
          <Badge variant="secondary" className="gap-1.5 font-medium">
            <Building2 className="h-3.5 w-3.5" />
            {companyOptions.find((c) => c.value === selectedCompanyId)?.label ?? '—'}
            <button
              type="button"
              onClick={() => setSelectedCompanyId(null)}
              className="ml-1 -mr-0.5 rounded-full hover:bg-foreground/10"
              aria-label="مسح فلتر الشركة"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
        <TabsContent value="all" className="m-0">
          <CompanyIssuancesTable
            rows={issuancesAll}
            companies={data.companies}
            loading={data.loading}
            mode="company"
            visible={issuanceCols.visible}
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
          />
        </TabsContent>
        <TabsContent value="issuances" className="m-0">
          <CompanyIssuancesTable
            rows={issuancesActive}
            companies={data.companies}
            loading={data.loading}
            mode="company"
            visible={issuanceCols.visible}
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
          />
        </TabsContent>
        <TabsContent value="returns" className="m-0">
          <CompanyIssuancesTable
            rows={returns}
            companies={data.companies}
            loading={data.loading}
            mode="company"
            visible={issuanceCols.visible}
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
          />
        </TabsContent>
        <TabsContent value="disbursements" className="m-0">
          <CompanySettlementsTable
            rows={companySettlements}
            loading={data.loading}
            kind="disbursement"
            onVoucherClick={(r) => openSettlementVoucher(r, 'disbursement')}
          />
        </TabsContent>
        <TabsContent value="receipts" className="m-0">
          <CompanySettlementsTable
            rows={companyReceipts}
            loading={data.loading}
            kind="payment"
            onVoucherClick={(r) => openSettlementVoucher(r, 'payment')}
          />
        </TabsContent>
      </Tabs>

      <ReceiptActionsDialog
        row={voucherActionRow}
        onClose={() => setVoucherActionRow(null)}
      />

      <AddSettlementDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="company"
        kind={addKind}
        entities={companyOptions.map((c) => ({ id: c.value, name: c.label }))}
        onSaved={() => data.refresh()}
      />

      <EditSettlementDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        table="company_settlements"
        row={editRow}
        onSaved={() => data.refresh()}
      />

      <QuickIssuanceDialog
        open={issuanceOpen}
        onOpenChange={setIssuanceOpen}
        defaultMode={issuanceMode}
        companies={data.companies}
        brokers={data.brokers}
        onSaved={() => data.refresh()}
      />
    </div>
  );
}

function Sep() {
  return <span className="h-5 w-px bg-border hidden sm:inline-block" />;
}

function SummaryPill({
  label,
  value,
  tone,
  tooltip,
}: {
  label: string;
  value: string;
  tone: 'primary' | 'destructive' | 'success' | 'amber' | 'emerald';
  tooltip?: ReactNode;
}) {
  const cls =
    tone === 'primary'
      ? 'text-primary'
      : tone === 'destructive'
      ? 'text-destructive'
      : tone === 'success' || tone === 'emerald'
      ? 'text-emerald-600'
      : 'text-amber-600';
  const pill = (
    <div className="inline-flex items-center gap-1.5 px-1 cursor-help">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${cls}`}>{value}</span>
    </div>
  );
  if (!tooltip) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent side="bottom" className="p-2.5 max-w-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

interface BreakdownLine {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}

function BreakdownLines({ title, lines }: { title: string; lines: BreakdownLine[] }) {
  return (
    <div dir="rtl" className="space-y-1.5 text-xs">
      <div className="font-semibold text-foreground">{title}</div>
      <div className="flex flex-col gap-0.5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`flex items-center justify-between gap-4 ${
              l.strong ? 'border-t pt-1 mt-0.5 font-bold' : ''
            } ${l.muted ? 'text-muted-foreground italic text-[11px]' : ''}`}
          >
            <span>{l.label}</span>
            <span className="tabular-nums">{l.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Helpers — date range chip + company picker
// ──────────────────────────────────────────────────────────────
// Mirrors ClientsSection's identically-named helpers so the two
// surfaces format the same way. Kept inline (small + tight scope);
// if a third surface ever needs them we can lift to a shared file.

const AR_MONTH_NAMES_CO = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function formatAccountingDate(iso: string): string {
  if (!iso) return '—';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function describeAccountingRange(from: string, to: string): string {
  if (!from && !to) return 'كل التواريخ';
  if (!from || !to) return `${from || '...'} → ${to || '...'}`;
  const f = from.split('-');
  const t = to.split('-');
  if (f.length === 3 && t.length === 3 && f[0] === t[0] && f[1] === t[1]) {
    const y = Number(f[0]);
    const mIdx = Number(f[1]) - 1;
    const lastDay = new Date(y, mIdx + 1, 0).getDate();
    if (Number(f[2]) === 1 && Number(t[2]) === lastDay) {
      return `شهر ${AR_MONTH_NAMES_CO[mIdx] ?? f[1]} ${y}`;
    }
  }
  return `${formatAccountingDate(from)} → ${formatAccountingDate(to)}`;
}

function CompanyPicker({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => o.label.toLowerCase().includes(term));
  }, [options, query]);
  const selectedLabel = value ? options.find((o) => o.value === value)?.label ?? '' : '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'h-8 gap-2 min-w-[180px] justify-between',
            value && 'border-primary/40',
          )}
        >
          <Building2 className="h-3.5 w-3.5" />
          <span className="truncate flex-1 text-right">
            {value ? selectedLabel : 'اختر شركة...'}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="end" dir="rtl">
        <Command>
          <CommandInput
            placeholder="ابحث باسم الشركة..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {filtered.length === 0 ? (
              <CommandEmpty>لا توجد شركات</CommandEmpty>
            ) : (
              filtered.map((c) => (
                <CommandItem
                  key={c.value}
                  value={c.value}
                  onSelect={() => {
                    onChange(c.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex items-center gap-2 data-[selected=true]:bg-muted data-[selected=true]:text-foreground aria-selected:bg-muted aria-selected:text-foreground"
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5',
                      value === c.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{c.label}</span>
                </CommandItem>
              ))
            )}
          </CommandList>
          {value ? (
            <div className="border-t p-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-destructive hover:text-destructive"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <X className="h-3.5 w-3.5" />
                مسح اختيار الشركة
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ──────────────────────────────────────────────────────────────
// CompanySettlementsTable — simple voucher list, customer-style
// ──────────────────────────────────────────────────────────────
//
// Used by the سند الصرف / سند القبض sub-tabs. Mirrors the customer
// receipts table: blue clickable voucher number on the right,
// minimal columns (date, شركة, طريقة الدفع, مبلغ, ملاحظات), no
// inline editing. Heavy lifting (cheque image, status badges,
// edit/delete actions) lives on the /receipts page where it
// belongs — the accounting page is read-only on the receipt rows.

function formatSettlementVoucher(row: SettlementRow): string {
  if (row.cheque_number) return `شيك ${row.cheque_number}`;
  if (row.settlement_date) {
    const parts = row.settlement_date.split('-');
    if (parts.length === 3) return `تسوية ${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return `تسوية ${row.id.slice(0, 6)}`;
}

function formatSettlementDate(iso: string): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'dd/MM/yyyy');
  } catch {
    return iso;
  }
}

const SETTLEMENT_PAYMENT_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  customer_cheque: 'شيك عميل',
  transfer: 'تحويل بنكي',
  bank_transfer: 'تحويل بنكي',
  visa: 'فيزا',
  multiple: 'متعدد',
};

function CompanySettlementsTable({
  rows,
  loading,
  kind,
  onVoucherClick,
}: {
  rows: SettlementRow[];
  loading: boolean;
  kind: 'disbursement' | 'payment';
  onVoucherClick: (row: SettlementRow) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        {kind === 'disbursement'
          ? 'لا توجد سندات صرف في هذا النطاق'
          : 'لا توجد سندات قبض في هذا النطاق'}
      </div>
    );
  }
  const amountClass =
    kind === 'disbursement' ? 'text-amber-700' : 'text-emerald-700';
  return (
    <div className="rounded-md border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap text-right">رقم السند</TableHead>
            <TableHead className="whitespace-nowrap text-right">التاريخ</TableHead>
            <TableHead className="whitespace-nowrap text-right">الشركة</TableHead>
            <TableHead className="whitespace-nowrap text-right">طريقة الدفع</TableHead>
            <TableHead className="whitespace-nowrap text-left">المبلغ</TableHead>
            <TableHead className="whitespace-nowrap text-right">ملاحظات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const voucherLabel = formatSettlementVoucher(r);
            const methodLabel = r.payment_type
              ? SETTLEMENT_PAYMENT_LABELS[r.payment_type] ?? r.payment_type
              : '—';
            return (
              <TableRow key={r.id} className="text-sm">
                <TableCell className="font-mono ltr-nums whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onVoucherClick(r)}
                    className="text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
                  >
                    {voucherLabel}
                  </button>
                </TableCell>
                <TableCell className="whitespace-nowrap ltr-nums">
                  {formatSettlementDate(r.settlement_date)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.entity_name ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {methodLabel}
                  </Badge>
                </TableCell>
                <TableCell
                  className={`text-left ltr-nums font-semibold tabular-nums whitespace-nowrap ${amountClass}`}
                >
                  ₪{Math.round(r.total_amount).toLocaleString('en-US')}
                </TableCell>
                <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                  {r.notes ?? '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
