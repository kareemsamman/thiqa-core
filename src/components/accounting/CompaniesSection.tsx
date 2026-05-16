import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CalendarRange,
  Check,
  ChevronsUpDown,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Printer,
  RotateCcw,
  LayoutGrid,
  Search,
  TrendingUp,
  Wallet,
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
  COMPANY_SETTLEMENT_COLUMNS,
  COMPANY_SETTLEMENT_DEFAULT_OFF,
  ISSUANCE_DEFAULT_OFF,
} from './columnDefs';
import type { ClientReceiptRow } from './useAccountingData';
import { AccountingFilters, AccountingFiltersValue } from './AccountingFilters';
import { ManageColumnsDropdown } from './ManageColumnsDropdown';
import { useTableColumnVisibility } from '@/hooks/useTableColumnVisibility';
import {
  matchesClientReceiptSearch,
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

type SubTab =
  | 'all'
  | 'issuances'
  | 'returns'
  | 'disbursements'
  | 'receipts'
  | 'debit_notes'
  | 'credit_notes';

const TABS: { key: SubTab; label: string; Icon: LucideIcon }[] = [
  { key: 'all', label: 'الكل', Icon: LayoutGrid },
  { key: 'issuances', label: 'الإصدارات', Icon: FileText },
  { key: 'returns', label: 'الإصدارات الملغية', Icon: RotateCcw },
  { key: 'disbursements', label: 'سند الصرف', Icon: ArrowUpRight },
  { key: 'receipts', label: 'سند القبض', Icon: ArrowDownRight },
  { key: 'debit_notes', label: 'إشعار مدين', Icon: TrendingUp },
  { key: 'credit_notes', label: 'إشعار دائن', Icon: Wallet },
];

const ISSUANCE_KEYS = COMPANY_ISSUANCE_COLUMNS.map((c) => c.key);
const ISSUANCE_DEFAULT_VISIBLE = ISSUANCE_KEYS.filter((k) => !ISSUANCE_DEFAULT_OFF.has(k));
const SETTLEMENT_KEYS = COMPANY_SETTLEMENT_COLUMNS.map((c) => c.key);
const SETTLEMENT_DEFAULT_VISIBLE = SETTLEMENT_KEYS.filter((k) => !COMPANY_SETTLEMENT_DEFAULT_OFF.has(k));

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
  // Default OFF: standalone-ELZAMI rows are excluded from the
  // المستحق للشركات pills (matches /receipts which already hides
  // ELZAMI passthroughs). Mixed packages already exclude ELZAMI inside
  // useAccountingData, so this toggle only affects pure-ELZAMI rows.
  // Toggle ON to include them in the calculation.
  const [includeElzamiInDue, setIncludeElzamiInDue] = useState(false);
  // Voucher action picker (print / SMS / WhatsApp) when the user
  // clicks a settlement's voucher number — same dialog the customer
  // accounting page uses. Company settlements live in their own table
  // (`company_settlements`); the receipts mirror gives us the
  // `voucher_receipt_id` send-voucher / generate-voucher expects, so
  // we resolve it lazily on click.
  const [voucherActionRow, setVoucherActionRow] = useState<VoucherActionRow | null>(null);

  const openSettlementVoucher = (row: SettlementRow, kind: 'disbursement' | 'payment') => {
    // Mirror info is now hydrated eagerly by useAccountingData, so
    // this handler is purely synchronous — feed the cached id /
    // voucher_number / receipt_type straight into the dialog.
    // Legacy rows that never got a mirror (no `receipt_id`) surface
    // the same "السند غير متوفر" toast they used to.
    if (!row.receipt_id) {
      toast.error('السند غير متوفر للطباعة/الإرسال');
      return;
    }
    setVoucherActionRow({
      id: row.receipt_id,
      receipt_type: row.receipt_type || kind,
      voucher_number: row.voucher_number ?? row.cheque_number ?? null,
      payment_id: row.payment_id ?? null,
      client_name: row.entity_name ?? null,
      // Companies don't have a "to-customer" phone for SMS/WhatsApp
      // in the receipts mirror — send-voucher handles broker rows but
      // for company-counterparty vouchers we'd need agency-side
      // wiring. Pass null for now; the dialog disables SMS/WhatsApp
      // and the user can still print.
      client_phone: null,
    });
  };

  // Credit-note / debit-note rows are already receipts rows (no
  // mirror lookup needed) — pass them straight to the same action
  // dialog so the user gets print / SMS / WhatsApp on click. The
  // dialog dispatches by receipt_type internally.
  const openCreditNoteVoucher = (row: ClientReceiptRow) => {
    setVoucherActionRow({
      id: row.id,
      receipt_type: row.receipt_type,
      voucher_number: row.voucher_number,
      payment_id: row.payment_id ?? null,
      client_name: row.client_name,
      client_phone: row.client_phone,
    });
  };

  // Issuance row's "سندات القبض" cell — when receipts_count === 1
  // the cell shows the voucher number; clicking it opens the same
  // print/send dialog the receipts page uses. Multi-receipt rows
  // still fall through to the package drawer inside the table.
  const openPrimaryReceiptVoucher = (row: IssuanceRow) => {
    if (!row.primary_receipt) return;
    setVoucherActionRow({
      id: row.primary_receipt.receipt_id,
      receipt_type: row.primary_receipt.receipt_type,
      voucher_number: row.primary_receipt.voucher_number,
      payment_id: row.primary_receipt.payment_id,
      client_name: row.client_name,
      client_phone: row.primary_receipt.client_phone ?? row.client_phone ?? null,
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
  // v5 forces a clean reset of the persisted visibility set. v4
  // shipped briefly with the old broker-style key list still cached
  // on some users, which meant رقم السند never surfaced even though
  // COMPANY_SETTLEMENT_COLUMNS marks it required. Bumping the id
  // drops the stale entry; the new one is seeded from
  // SETTLEMENT_DEFAULT_VISIBLE which includes voucher_number.
  const settlementCols = useTableColumnVisibility(
    'accounting-companies-settlements-v5',
    SETTLEMENT_DEFAULT_VISIBLE,
    SETTLEMENT_KEYS,
  );

  // Settlement-style tabs share one column set (سند صرف / سند قبض /
  // إشعار مدين / إشعار دائن). The active column dropdown drives them
  // all when one of those tabs is open — per the user feedback that
  // column management wasn't reaching the voucher tables.
  const isSettlementTab =
    tab === 'disbursements' ||
    tab === 'receipts' ||
    tab === 'debit_notes' ||
    tab === 'credit_notes';
  const activeColumns = isSettlementTab ? COMPANY_SETTLEMENT_COLUMNS : COMPANY_ISSUANCE_COLUMNS;
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

  // Company-level credit/debit notes. The hook already split these
  // out by company_id so the bucket here only contains rows that
  // explicitly belong to a company. We split further by receipt_type:
  // credit_note → إشعار دائن tab; debit_note (or legacy credit_note
  // with negative amount) → إشعار مدين tab. Each list applies the
  // same client-side filters as the settlement tables — date already
  // pre-filtered in useAccountingData, then per-company picker +
  // free-text search + sort here.
  const compareClientReceiptDates = (a: ClientReceiptRow, b: ClientReceiptRow): number => {
    const av = a.receipt_date ? new Date(a.receipt_date).getTime() : 0;
    const bv = b.receipt_date ? new Date(b.receipt_date).getTime() : 0;
    return sortDirCo === 'newest' ? bv - av : av - bv;
  };
  // company_id isn't carried back to the row shape today, so the
  // selectedCompanyId picker can't narrow these. The user knows
  // (data is fine with 0); if/when these need company filtering
  // we'll add company_id to ClientReceiptRow.
  const companyCreditNotes = useMemo(
    () =>
      data.companyCreditNotes
        .filter(
          (r) =>
            r.receipt_type === 'credit_note' &&
            r.amount > 0 &&
            matchesClientReceiptSearch(r, search),
        )
        .slice()
        .sort(compareClientReceiptDates),
    [data.companyCreditNotes, search, sortDirCo],
  );
  const companyDebitNotes = useMemo(
    () =>
      data.companyCreditNotes
        .filter(
          (r) =>
            (r.receipt_type === 'debit_note' ||
              (r.receipt_type === 'credit_note' && r.amount < 0)) &&
            matchesClientReceiptSearch(r, search),
        )
        .slice()
        .sort(compareClientReceiptDates),
    [data.companyCreditNotes, search, sortDirCo],
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
    // Office-billable insurance — IssuanceRow.insurance_price already
    // excludes إلزامي in mixed packages (per useAccountingData's
    // moneySubs filter). Keeps every downstream pill (المستحق /
    // الأرباح / الصافي) on its existing basis.
    const insuranceSum = overlayed.reduce((s, r) => s + Number(r.insurance_price || 0), 0);
    // TRUE gross insurance — sums insurance_price across every sub-
    // policy in every package, including إلزامي in mixed packages.
    // This is what "إجمالي سعر التأمين" means to an accountant: gross
    // premium written, irrespective of who eventually collects it.
    // We show this on the headline pill and break it down (gross vs
    // office-billable) in the tooltip so the user can see both.
    const grossInsuranceSum = overlayed.reduce(
      (s, r) => s + r.sub_policies.reduce((ss, p) => ss + Number(p.insurance_price || 0), 0),
      0,
    );
    const elzamiPassthrough = grossInsuranceSum - insuranceSum;
    // Total owed to companies — sum across active policies. Standalone-
    // ELZAMI rows (every sub is ELZAMI) are excluded by default because
    // the customer pays the insurer directly for إلزامي — so the office
    // doesn't actually owe the company anything. Toggle includeElzamiInDue
    // re-adds them via the filter popover.
    const elzamiOnlyDue = overlayed
      .filter(
        (r) =>
          r.sub_policies.length > 0 &&
          r.sub_policies.every((s) => s.policy_type_parent === 'ELZAMI'),
      )
      .reduce((s, r) => s + Number(r.payed_for_company || 0), 0);
    const totalDueAll = overlayed.reduce((s, r) => s + Number(r.payed_for_company || 0), 0);
    const totalDue = includeElzamiInDue ? totalDueAll : totalDueAll - elzamiOnlyDue;
    const profitOnly = overlayed.reduce((s, r) => s + Number(r.profit || 0), 0);
    const commissionOnly = overlayed.reduce((s, r) => s + Number(r.office_commission || 0), 0);
    const profitSum = profitOnly + commissionOnly;
    // Returns adjustments are intentionally NOT folded into the pills.
    // Per the canonical RPC get_company_outstanding_summary, cancelled
    // policies are excluded from total_payable entirely — only active
    // policies count. The legacy "summer returns' payed_for_company"
    // logic inflated dueGrossSum by every cancelled policy's historical
    // obligation (e.g. ₪9,100 of returns showing up as extra debt when
    // the user filtered to الإصدارات tab), so the manual sum of the
    // active rows didn't equal the pill. Cancellation refunds should
    // be tracked via سند قبض (incoming) or إشعار مدين على الشركة, not
    // by sign-flipping payed_for_company on the cancelled row.
    const returnsDueDelta = 0;
    const returnsProfitDelta = 0;
    // Disbursed = money we actually paid the companies (outgoing
    // settlements only, refused excluded).
    const disbursedSum = companySettlements
      .filter((r) => !r.refused)
      .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    // Paper adjustments — both إشعار دائن and إشعار مدين on companies
    // SUBTRACT from the outstanding, per the canonical formula in
    // get_company_outstanding_summary (migration 20260515110000):
    //   outstanding = payable − paid_out − credit_notes − debit_notes
    // - إشعار دائن: company logging our payment "على الحساب" → pays
    //   down the debt like سند صرف but without cash moving.
    // - إشعار مدين: company owes us (commission claw-back, refund
    //   pending) → directly reduces what we owe them.
    const companyCreditNotesTotal = companyCreditNotes.reduce(
      (s, r) => s + Math.abs(Number(r.amount || 0)),
      0,
    );
    const companyDebitNotesTotal = companyDebitNotes.reduce(
      (s, r) => s + Math.abs(Number(r.amount || 0)),
      0,
    );
    // Gross "owed to companies" — lifetime obligation across active
    // policies, after netting in the returns delta and paper-note
    // adjustments, BEFORE subtracting what we've actually paid out.
    const dueGrossSum = Math.max(
      0,
      totalDue + returnsDueDelta - companyCreditNotesTotal - companyDebitNotesTotal,
    );
    // Net "still owe the companies" — also subtracts outgoing settlements.
    // Matches get_company_outstanding_summary one-for-one so this pill,
    // the in-app debt tile, and the AddCompanyDebitNoteDialog balance
    // line all read the same number.
    const dueSum = Math.max(
      0,
      totalDue + returnsDueDelta - disbursedSum - companyCreditNotesTotal - companyDebitNotesTotal,
    );
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
      grossInsuranceSum,
      elzamiPassthrough,
      dueSum,
      dueGrossSum,
      profitSum,
      disbursedSum,
      totalDue,
      elzamiOnlyDue,
      returnsDueDelta,
      returnsProfitDelta,
      profitOnly,
      commissionOnly,
      brokerProfit,
      netProfitSum,
      companyCreditNotesTotal,
      companyDebitNotesTotal,
      activeCount: overlayed.length,
    };
  }, [
    issuancesActive,
    returns,
    companySettlements,
    companyCreditNotes,
    companyDebitNotes,
    editLocal,
    data.expensesTotal,
    brokerProfit,
    includeElzamiInDue,
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
      : tab === 'receipts'
      ? companyReceipts.length
      : tab === 'debit_notes'
      ? companyDebitNotes.length
      : companyCreditNotes.length;
  const countLabel = tab === 'debit_notes' || tab === 'credit_notes'
    ? 'إشعار'
    : isSettlementTab
    ? 'سند'
    : 'معاملة';

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
      {/* Summary pills — six-card grid matching the customers tab
          design. Tooltips still carry the breakdown on hover so the
          power-user math stays accessible; the visual style aligns
          with ClientsSection so the two surfaces read as one. */}
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <CompanyPillCard
            icon={FileText}
            tone="slate"
            label="إجمالي سعر التأمين"
            value={fmt(totals.grossInsuranceSum)}
            hint={`${totals.activeCount} معاملة`}
            tooltip={
              <BreakdownLines
                title="إجمالي سعر التأمين"
                lines={[
                  { label: 'عدد المعاملات', value: `${totals.activeCount}` },
                  { label: 'إجمالي القسط المكتتب', value: fmt(totals.grossInsuranceSum), strong: true },
                  ...(totals.elzamiPassthrough > 0
                    ? [
                        {
                          label: 'إلزامي يدفعه العميل للشركة',
                          value: `− ${fmt(totals.elzamiPassthrough)}`,
                        },
                      ]
                    : []),
                  { label: 'يدخل دفاتر المكتب', value: fmt(totals.insuranceSum) },
                  {
                    label: 'ملاحظة',
                    value: 'الإلزامي ضمن الحزم المختلطة لا يدخل دفاتر المكتب — يدفعه العميل للشركة مباشرة',
                    muted: true,
                  },
                ]}
              />
            }
          />
          <CompanyPillCard
            icon={ArrowUpRight}
            tone="rose"
            label="المستحق للشركات (إجمالي)"
            value={fmt(totals.dueGrossSum)}
            hint="قبل المدفوعات"
            tooltip={
              <BreakdownLines
                title="المستحق للشركات (إجمالي)"
                lines={[
                  { label: 'إجمالي مستحق من البوالص النشطة', value: fmt(totals.totalDue) },
                  ...(!includeElzamiInDue && totals.elzamiOnlyDue > 0
                    ? [{ label: 'إلزامي مستثنى (الزبون يدفع الشركة مباشرة)', value: `− ${fmt(totals.elzamiOnlyDue)}` }]
                    : []),
                  ...(totals.companyCreditNotesTotal > 0
                    ? [{ label: 'إشعار دائن للشركة', value: `− ${fmt(totals.companyCreditNotesTotal)}` }]
                    : []),
                  ...(totals.companyDebitNotesTotal > 0
                    ? [{ label: 'إشعار مدين على الشركة', value: `− ${fmt(totals.companyDebitNotesTotal)}` }]
                    : []),
                  { label: 'الإجمالي قبل المدفوعات', value: fmt(totals.dueGrossSum), strong: true },
                  {
                    label: 'ملاحظة',
                    value: includeElzamiInDue
                      ? 'الإلزامي مُضمّن — أطفئ الفلتر لاستثنائه. الإصدارات الملغية لا تُحسب.'
                      : 'الإصدارات الملغية لا تُحسب — راجع سند قبض/إشعار مدين للاسترداد',
                    muted: true,
                  },
                ]}
              />
            }
          />
          <CompanyPillCard
            icon={ArrowDownLeft}
            tone="rose"
            label="المستحق للشركات (صافي)"
            value={fmt(totals.dueSum)}
            hint="بعد المدفوعات"
            tooltip={
              <BreakdownLines
                title="المستحق للشركات (صافي)"
                lines={[
                  { label: 'إجمالي مستحق من البوالص النشطة', value: fmt(totals.totalDue) },
                  ...(!includeElzamiInDue && totals.elzamiOnlyDue > 0
                    ? [{ label: 'إلزامي مستثنى (الزبون يدفع الشركة مباشرة)', value: `− ${fmt(totals.elzamiOnlyDue)}` }]
                    : []),
                  { label: 'مدفوع للشركات', value: `− ${fmt(totals.disbursedSum)}` },
                  ...(totals.companyCreditNotesTotal > 0
                    ? [{ label: 'إشعار دائن للشركة', value: `− ${fmt(totals.companyCreditNotesTotal)}` }]
                    : []),
                  ...(totals.companyDebitNotesTotal > 0
                    ? [{ label: 'إشعار مدين على الشركة', value: `− ${fmt(totals.companyDebitNotesTotal)}` }]
                    : []),
                  { label: 'المتبقي', value: fmt(totals.dueSum), strong: true },
                ]}
              />
            }
          />
          <CompanyPillCard
            icon={TrendingUp}
            tone="emerald"
            label="الأرباح + العمولات"
            value={fmt(totals.profitSum)}
            hint="أرباح + عمولة المكتب"
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
          <CompanyPillCard
            icon={ArrowUpRight}
            tone="amber"
            label="مدفوع للشركات"
            value={fmt(totals.disbursedSum)}
            hint={`${companySettlements.filter((r) => !r.refused).length} سند صرف`}
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
          <CompanyPillCard
            icon={CheckCircle2}
            tone={totals.netProfitSum >= 0 ? 'emerald' : 'rose'}
            label="الأرباح الصافية"
            value={fmt(totals.netProfitSum)}
            hint="بعد المصاريف"
            tooltip={
              <BreakdownLines
                title="الأرباح الصافية"
                lines={[
                  { label: 'ربح الشركات', value: fmt(totals.profitOnly) },
                  { label: 'عمولة المكتب', value: `+ ${fmt(totals.commissionOnly)}` },
                  { label: 'ربح الوسطاء', value: `+ ${fmt(totals.brokerProfit)}` },
                  { label: 'المصاريف', value: `− ${fmt(data.expensesTotal)}` },
                  { label: 'الصافي', value: fmt(totals.netProfitSum), strong: true },
                ]}
              />
            }
          />
        </div>
      </TooltipProvider>

      {/* Toolbar row — search pinned to the visual right (first DOM
          child + RTL flex), controls clustered on the left via
          justify-between. The user explicitly asked for this layout
          ("the search should be to right"); the previous mr-auto
          variant pushed the whole inner block leftward and buried
          the search in the middle of the row. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative w-full sm:w-80 md:w-96">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم، رقم المعاملة، الهوية…"
            className="w-full pr-9"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {data.loading ? '...' : `${activeRowCount} ${countLabel}`}
          </span>
          {/* Per user: company picker sits before column manager so it
              lands visually to the right of "إدارة الأعمدة" in RTL
              flow — pick the company first, then refine columns. */}
          <CompanyPicker
            value={selectedCompanyId}
            options={companyOptions}
            onChange={setSelectedCompanyId}
          />
          <ManageColumnsDropdown
            columns={activeColumns}
            visible={activeState.visible}
            onToggle={activeState.toggle}
            onReset={activeState.reset}
          />
          <AccountingFilters
            value={filters}
            onChange={setFilters}
            companyOptions={companyOptions}
            typeOptions={typeOptions}
            paymentMethodOptions={paymentOptions}
            includeElzamiInDue={includeElzamiInDue}
            onIncludeElzamiInDueChange={setIncludeElzamiInDue}
            show={{
              dateRange: true,
              // Company multi-select moves to the dedicated picker
              // above so only one source-of-truth narrows by company.
              companies: false,
              types: !isSettlementTab,
              paymentMethods: true,
              sort: true,
              includeElzamiInDue: true,
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
        <TabsList className="grid w-full grid-cols-4 lg:grid-cols-7">
          {TABS.map(({ key, label, Icon }) => {
            const count =
              key === 'all'
                ? issuancesAll.length
                : key === 'issuances'
                ? issuancesActive.length
                : key === 'returns'
                ? returns.length
                : key === 'disbursements'
                ? companySettlements.length
                : key === 'receipts'
                ? companyReceipts.length
                : key === 'debit_notes'
                ? companyDebitNotes.length
                : companyCreditNotes.length;
            return (
              <TabsTrigger key={key} value={key} className="gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
                <span className="text-xs opacity-70">({count})</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="all" className="mt-3 m-0">
          <CompanyIssuancesTable
            rows={issuancesAll}
            companies={data.companies}
            loading={data.loading}
            mode="company"
            visible={issuanceCols.visible}
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
            onPrimaryReceiptClick={openPrimaryReceiptVoucher}
          />
        </TabsContent>
        <TabsContent value="issuances" className="mt-3 m-0">
          <CompanyIssuancesTable
            rows={issuancesActive}
            companies={data.companies}
            loading={data.loading}
            mode="company"
            visible={issuanceCols.visible}
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
            onPrimaryReceiptClick={openPrimaryReceiptVoucher}
          />
        </TabsContent>
        <TabsContent value="returns" className="mt-3 m-0">
          <CompanyIssuancesTable
            rows={returns}
            companies={data.companies}
            loading={data.loading}
            mode="company"
            visible={issuanceCols.visible}
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
            onPrimaryReceiptClick={openPrimaryReceiptVoucher}
          />
        </TabsContent>
        <TabsContent value="disbursements" className="mt-3 m-0">
          <CompanySettlementsTable
            rows={companySettlements}
            loading={data.loading}
            kind="disbursement"
            visible={settlementCols.visible}
            onVoucherClick={(r) => openSettlementVoucher(r, 'disbursement')}
          />
        </TabsContent>
        <TabsContent value="receipts" className="mt-3 m-0">
          <CompanySettlementsTable
            rows={companyReceipts}
            loading={data.loading}
            kind="payment"
            visible={settlementCols.visible}
            onVoucherClick={(r) => openSettlementVoucher(r, 'payment')}
          />
        </TabsContent>
        <TabsContent value="debit_notes" className="mt-3 m-0">
          <CompanyCreditNotesTable
            rows={companyDebitNotes}
            loading={data.loading}
            kind="debit"
            visible={settlementCols.visible}
            onVoucherClick={openCreditNoteVoucher}
          />
        </TabsContent>
        <TabsContent value="credit_notes" className="mt-3 m-0">
          <CompanyCreditNotesTable
            rows={companyCreditNotes}
            loading={data.loading}
            kind="credit"
            visible={settlementCols.visible}
            onVoucherClick={openCreditNoteVoucher}
          />
        </TabsContent>
      </Tabs>

      {/* Sticky floating print bar — same visual as the kashf modal's
          floating actions. Pinned to the bottom of the viewport so
          it's always within reach regardless of scroll position.
          Prints whatever rowset the active tab is currently showing
          (so filters / sort / search are all honored). */}
      <div className="fixed bottom-5 inset-x-0 z-40 flex justify-center pointer-events-none">
        <div className="pointer-events-auto bg-foreground text-background rounded-full shadow-2xl px-4 py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handlePrint}
            disabled={printing || data.loading}
            className="gap-2 text-background hover:bg-background/10 hover:text-background rounded-full"
          >
            {printing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            <span>طباعة الإصدارات</span>
          </Button>
        </div>
      </div>

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

// CompanyPillCard — mirrors ClientsSection's PillCard so the two
// accounting surfaces share the same visual vocabulary. Adds a
// breakdown tooltip on hover so the power-user math stays accessible
// without making the card noisy.
const CO_TONE_CLASSES: Record<string, { bg: string; text: string }> = {
  slate: { bg: 'bg-slate-500/10', text: 'text-slate-700' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-700' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-700' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-700' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-700' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-700' },
};

function CompanyPillCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
  tooltip,
}: {
  icon: LucideIcon;
  tone: keyof typeof CO_TONE_CLASSES;
  label: string;
  value: string;
  hint?: string;
  tooltip?: ReactNode;
}) {
  const cls = CO_TONE_CLASSES[tone];
  const card = (
    <Card className={tooltip ? 'cursor-help' : undefined}>
      <CardContent className="py-3 px-4 flex items-center gap-3">
        <div className={`h-9 w-9 rounded-xl ${cls.bg} flex items-center justify-center shrink-0`}>
          <Icon className={`h-4 w-4 ${cls.text}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className={`text-lg font-bold tabular-nums ${cls.text} whitespace-nowrap`}>
            {value}
          </p>
          {hint ? (
            <p className="text-[10px] text-muted-foreground truncate">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
  if (!tooltip) return card;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
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
            'gap-2 min-w-[180px] justify-between',
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
  // Cascade: real mirror voucher number (e.g. R229/2026, D45/2026) →
  // cheque number (legacy rows mirror-less but with a cheque) → final
  // 'تسوية' fallback so the cell is never empty. Pre-trigger
  // settlements (created before 20260514170000) won't have a mirror,
  // hence the fallback chain.
  if (row.voucher_number) return row.voucher_number;
  if (row.cheque_number) return `شيك ${row.cheque_number}`;
  return 'تسوية';
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
  visible,
  onVoucherClick,
}: {
  rows: SettlementRow[];
  loading: boolean;
  kind: 'disbursement' | 'payment';
  /** Controlled column visibility — list of column keys to render. */
  visible: string[];
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
  const show = (key: string) => visible.includes(key);
  return (
    <div className="rounded-md border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {show('voucher_number') && (
              <TableHead className="whitespace-nowrap text-right">رقم السند</TableHead>
            )}
            {show('date') && (
              <TableHead className="whitespace-nowrap text-right">التاريخ</TableHead>
            )}
            {show('entity') && (
              <TableHead className="whitespace-nowrap text-right">الشركة</TableHead>
            )}
            {show('payment_method') && (
              <TableHead className="whitespace-nowrap text-right">طريقة الدفع</TableHead>
            )}
            {show('amount') && (
              <TableHead className="whitespace-nowrap text-left">المبلغ</TableHead>
            )}
            {show('notes') && (
              <TableHead className="whitespace-nowrap text-right">ملاحظات</TableHead>
            )}
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
                {show('voucher_number') && (
                  <TableCell className="font-mono ltr-nums whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onVoucherClick(r)}
                      className="text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
                    >
                      {voucherLabel}
                    </button>
                  </TableCell>
                )}
                {show('date') && (
                  <TableCell className="whitespace-nowrap ltr-nums">
                    {formatSettlementDate(r.settlement_date)}
                  </TableCell>
                )}
                {show('entity') && (
                  <TableCell className="whitespace-nowrap">
                    {r.entity_name ?? '—'}
                  </TableCell>
                )}
                {show('payment_method') && (
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {methodLabel}
                    </Badge>
                  </TableCell>
                )}
                {show('amount') && (
                  <TableCell
                    className={`text-left ltr-nums font-semibold tabular-nums whitespace-nowrap ${amountClass}`}
                  >
                    ₪{Math.round(r.total_amount).toLocaleString('en-US')}
                  </TableCell>
                )}
                {show('notes') && (
                  <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                    {r.notes ?? '—'}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// CompanyCreditNotesTable — إشعار دائن / إشعار مدين للشركات
// ──────────────────────────────────────────────────────────────
//
// Same lean voucher-list shape as CompanySettlementsTable but consumes
// ClientReceiptRow (the receipts-mirror shape). Sourced from receipts
// rows where company_id is set — written by AddCompanyDebitNoteDialog
// / AddCompanyCreditNoteDialog. The hook routes them into the dedicated
// `companyCreditNotes` bucket so they don't leak into the customer or
// broker tables.

function CompanyCreditNotesTable({
  rows,
  loading,
  kind,
  visible,
  onVoucherClick,
}: {
  rows: ClientReceiptRow[];
  loading: boolean;
  kind: 'credit' | 'debit';
  visible: string[];
  /** Click handler for the voucher cell — opens the shared print /
   *  SMS / WhatsApp picker (ReceiptActionsDialog). Required per user:
   *  every voucher row must be clickable, not just settlement rows. */
  onVoucherClick: (row: ClientReceiptRow) => void;
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
        {kind === 'debit'
          ? 'لا توجد إشعارات مدين للشركات في هذا النطاق'
          : 'لا توجد إشعارات دائن للشركات في هذا النطاق'}
      </div>
    );
  }
  // Color the amount column to match the رصيد direction the user
  // expects: debit-note = company-owes-us (emerald-positive),
  // credit-note = we-owe-the-company (rose-negative). The user
  // doesn't read the type label every time — color carries the
  // direction at a glance.
  const amountClass = kind === 'debit' ? 'text-emerald-700' : 'text-rose-700';
  const show = (key: string) => visible.includes(key);
  return (
    <div className="rounded-md border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {show('voucher_number') && (
              <TableHead className="whitespace-nowrap text-right">رقم الإشعار</TableHead>
            )}
            {show('date') && (
              <TableHead className="whitespace-nowrap text-right">التاريخ</TableHead>
            )}
            {show('entity') && (
              <TableHead className="whitespace-nowrap text-right">الشركة</TableHead>
            )}
            {show('payment_method') && (
              <TableHead className="whitespace-nowrap text-right">السبب</TableHead>
            )}
            {show('amount') && (
              <TableHead className="whitespace-nowrap text-left">المبلغ</TableHead>
            )}
            {show('notes') && (
              <TableHead className="whitespace-nowrap text-right">ملاحظات</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            // The dialog stores "<reason>\nملاحظات: <free notes>" in
            // a single notes column. Split for display so the user
            // sees the reason on its own line and any extra notes
            // separately. Most rows only have the reason.
            const noteText = r.notes ?? '';
            const noteParts = noteText.split('\nملاحظات: ');
            const reason = noteParts[0] || '—';
            const extra = noteParts[1] ?? '';
            return (
              <TableRow key={r.id} className="text-sm">
                {show('voucher_number') && (
                  <TableCell className="font-mono ltr-nums whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onVoucherClick(r)}
                      className="text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
                    >
                      {r.voucher_number ?? '—'}
                    </button>
                  </TableCell>
                )}
                {show('date') && (
                  <TableCell className="whitespace-nowrap ltr-nums">
                    {formatSettlementDate(r.receipt_date)}
                  </TableCell>
                )}
                {show('entity') && (
                  <TableCell className="whitespace-nowrap">
                    {r.client_name ?? '—'}
                  </TableCell>
                )}
                {show('payment_method') && (
                  <TableCell className="max-w-[240px] truncate text-xs">
                    {reason}
                  </TableCell>
                )}
                {show('amount') && (
                  <TableCell
                    className={`text-left ltr-nums font-semibold tabular-nums whitespace-nowrap ${amountClass}`}
                  >
                    ₪{Math.round(Math.abs(r.amount)).toLocaleString('en-US')}
                  </TableCell>
                )}
                {show('notes') && (
                  <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                    {extra || '—'}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
