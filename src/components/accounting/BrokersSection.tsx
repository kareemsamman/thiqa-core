import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Check,
  ChevronsUpDown,
  FileText,
  Loader2,
  Printer,
  RotateCcw,
  LayoutGrid,
  Search,
  TrendingUp,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AddSettlementDialog, SettlementKind } from './AddSettlementDialog';
import { EditSettlementDialog } from './EditSettlementDialog';
import { QuickIssuanceDialog, IssuanceMode } from './QuickIssuanceDialog';
import { SettlementRow } from './SettlementsTable';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CompanyIssuancesTable } from './CompanyIssuancesTable';
import { SettlementsTable } from './SettlementsTable';
import { ReceiptActionsDialog, type VoucherActionRow } from './ReceiptActionsDialog';
import {
  BROKER_ISSUANCE_COLUMNS,
  COMPANY_SETTLEMENT_COLUMNS,
  COMPANY_SETTLEMENT_DEFAULT_OFF,
  ISSUANCE_DEFAULT_OFF,
  SETTLEMENT_COLUMNS,
  SETTLEMENT_DEFAULT_OFF,
} from './columnDefs';
import { AccountingFilters, AccountingFiltersValue } from './AccountingFilters';
import { ManageColumnsDropdown } from './ManageColumnsDropdown';
import { useTableColumnVisibility } from '@/hooks/useTableColumnVisibility';
import {
  matchesClientReceiptSearch,
  matchesIssuanceSearch,
  matchesSettlementSearch,
  useAccountingData,
  type ClientReceiptRow,
} from './useAccountingData';
import {
  IssuanceEditOverlay,
  IssuanceEditPatch,
  IssuanceRow,
  POLICY_TYPE_DISPLAY,
  PAYMENT_METHOD_LABELS,
  applyOverlay,
} from './accountingTypes';
import { cn } from '@/lib/utils';
import {
  buildAccountingReportPayload,
  buildBrokerStats,
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

const ISSUANCE_KEYS = BROKER_ISSUANCE_COLUMNS.map((c) => c.key);
const ISSUANCE_DEFAULT_VISIBLE = ISSUANCE_KEYS.filter((k) => !ISSUANCE_DEFAULT_OFF.has(k));
// Settlement tabs (سند صرف / سند قبض) keep the rich SettlementsTable
// — cheque images, customer-cheque accordion, status badge — since
// broker payments often consist of forwarded customer cheques. The
// HEAVY SETTLEMENT_COLUMNS map to that table.
const SETTLEMENT_KEYS = SETTLEMENT_COLUMNS.map((c) => c.key);
const SETTLEMENT_DEFAULT_VISIBLE = SETTLEMENT_KEYS.filter((k) => !SETTLEMENT_DEFAULT_OFF.has(k));
// إشعار مدين / إشعار دائن tabs are simpler (paper adjustments, no
// cheque metadata) so they use the lean COMPANY_SETTLEMENT_COLUMNS
// set — same shape the companies section uses for its notes tabs.
const NOTE_KEYS = COMPANY_SETTLEMENT_COLUMNS.map((c) => c.key);
const NOTE_DEFAULT_VISIBLE = NOTE_KEYS.filter((k) => !COMPANY_SETTLEMENT_DEFAULT_OFF.has(k));

interface BrokersSectionProps {
  focusSettlementId?: string | null;
  /** Page-level branch filter (global admins only). null = no extra
   *  filter — caller's natural RLS scope still applies. */
  branchId?: string | null;
}

export function BrokersSection({ focusSettlementId, branchId }: BrokersSectionProps = {}) {
  const [tab, setTab] = useState<SubTab>('all');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<SettlementKind>('disbursement');
  const [editRow, setEditRow] = useState<SettlementRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [issuanceOpen, setIssuanceOpen] = useState(false);
  const [issuanceMode, setIssuanceMode] = useState<IssuanceMode>('issue');
  const [editLocal, setEditLocal] = useState<IssuanceEditOverlay>({});
  const onPatch = (rowId: string, patch: IssuanceEditPatch) =>
    setEditLocal((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] ?? {}), ...patch } }));
  // Default to current month — same as the companies / customer tabs.
  // Loading the broker view on the 18th shouldn't dump the whole year.
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
  // Single-broker narrowing — mirrors the companies tab's CompanyPicker.
  // When set, every list collapses to this broker's rows + the kashf-
  // style chip exposes a clear button.
  const [selectedBrokerId, setSelectedBrokerId] = useState<string | null>(null);
  // Voucher action dialog (print / SMS / WhatsApp) on voucher click —
  // wired to the same dialog the companies + customers sections use.
  const [voucherActionRow, setVoucherActionRow] = useState<VoucherActionRow | null>(null);

  const data = useAccountingData(filters, branchId);

  useEffect(() => {
    if (!focusSettlementId) return;
    const inDisbursements = data.brokerSettlements.some(
      (r) => r.id === focusSettlementId && r.direction === 'we_owe',
    );
    const inReceipts = data.brokerSettlements.some(
      (r) => r.id === focusSettlementId && r.direction === 'broker_owes',
    );
    if (inDisbursements) setTab('disbursements');
    else if (inReceipts) setTab('receipts');
  }, [focusSettlementId, data.brokerSettlements]);

  const handleDelete = async (row: SettlementRow) => {
    const { data: settlement, error: readError } = await supabase
      .from('broker_settlements')
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
    const { error } = await supabase.from('broker_settlements').delete().eq('id', row.id);
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

  const issuanceCols = useTableColumnVisibility(
    'accounting-brokers-issuances-v5',
    ISSUANCE_DEFAULT_VISIBLE,
    ISSUANCE_KEYS,
  );
  // v4 forces a clean reset so the newly-added voucher_number column
  // (required: true) is included for users who already had v3 cached
  // without it. Without the bump, those users would never see رقم
  // السند on سند الصرف / سند القبض.
  const settlementCols = useTableColumnVisibility(
    'accounting-brokers-settlements-v4',
    SETTLEMENT_DEFAULT_VISIBLE,
    SETTLEMENT_KEYS,
  );
  const noteCols = useTableColumnVisibility(
    'accounting-brokers-notes-v1',
    NOTE_DEFAULT_VISIBLE,
    NOTE_KEYS,
  );

  const isSettlementTab = tab === 'disbursements' || tab === 'receipts';
  const isNoteTab = tab === 'debit_notes' || tab === 'credit_notes';
  const activeColumns = isSettlementTab
    ? SETTLEMENT_COLUMNS
    : isNoteTab
    ? COMPANY_SETTLEMENT_COLUMNS
    : BROKER_ISSUANCE_COLUMNS;
  const activeState = isSettlementTab
    ? settlementCols
    : isNoteTab
    ? noteCols
    : issuanceCols;

  // Open ReceiptActionsDialog for a broker settlement row. Brokers
  // don't have a receipts-table mirror today (broker_settlements is
  // an app-layer mirror, not trigger-based), so we surface a clear
  // toast when no mirror exists rather than silently failing.
  const openSettlementVoucher = async (row: SettlementRow) => {
    const { data: mirror } = await supabase
      .from('receipts')
      .select('id, receipt_type, payment_id, voucher_number')
      .eq('broker_settlement_id', row.id)
      .maybeSingle();
    const m = mirror as {
      id: string;
      receipt_type: string;
      payment_id: string | null;
      voucher_number: string | null;
    } | null;
    if (!m) {
      toast.error('السند غير متوفر للطباعة/الإرسال');
      return;
    }
    setVoucherActionRow({
      id: m.id,
      receipt_type: m.receipt_type,
      voucher_number: m.voucher_number ?? row.cheque_number ?? null,
      payment_id: m.payment_id ?? null,
      client_name: row.entity_name ?? null,
      client_phone: null,
    });
  };

  // Credit/debit notes are already receipts rows — feed them straight
  // into the action dialog, no mirror lookup needed.
  const openNoteVoucher = (row: ClientReceiptRow) => {
    setVoucherActionRow({
      id: row.id,
      receipt_type: row.receipt_type,
      voucher_number: row.voucher_number,
      payment_id: row.payment_id ?? null,
      client_name: row.client_name,
      client_phone: row.client_phone,
    });
  };

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

  // Broker options for the picker — drawn from data.brokers (the
  // dedicated brokers table) so the dropdown includes every broker
  // the agent has access to, not just the ones with issuances.
  const brokerOptions = useMemo(
    () => data.brokers.map((b) => ({ value: b.id, label: b.name })),
    [data.brokers],
  );
  const selectedBrokerLabel = selectedBrokerId
    ? brokerOptions.find((b) => b.value === selectedBrokerId)?.label ?? ''
    : '';

  const matchesSelectedBroker = (r: IssuanceRow) =>
    !selectedBrokerId || r.main.broker_id === selectedBrokerId;
  const matchesSelectedBrokerOnSettlement = (r: SettlementRow) =>
    !selectedBrokerId || r.entity_id === selectedBrokerId;
  const matchesSelectedBrokerOnNote = (r: ClientReceiptRow & { broker_id?: string | null }) =>
    !selectedBrokerId || r.broker_id === selectedBrokerId;

  const brokerCompanyOptions = useMemo(
    () =>
      data.companies
        .filter((c) => !!c.broker_id)
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

  // Memoized — see CompaniesSection for the rationale. Every list
  // applies the same predicate chain (broker-relevant → selected-
  // broker → search) so all tabs honor the picker + free-text input
  // consistently.
  const issuancesAll = useMemo(
    () =>
      [...data.issuances, ...data.returns]
        .filter((r) => !!r.main.broker_id)
        .filter(matchesSelectedBroker)
        .filter((r) => matchesIssuanceSearch(r, search)),
    [data.issuances, data.returns, search, selectedBrokerId],
  );
  const issuancesActive = useMemo(
    () =>
      data.issuances
        .filter((r) => !!r.main.broker_id)
        .filter(matchesSelectedBroker)
        .filter((r) => matchesIssuanceSearch(r, search)),
    [data.issuances, search, selectedBrokerId],
  );
  const returns = useMemo(
    () =>
      data.returns
        .filter((r) => !!r.main.broker_id)
        .filter(matchesSelectedBroker)
        .filter((r) => matchesIssuanceSearch(r, search)),
    [data.returns, search, selectedBrokerId],
  );

  const disbursements = useMemo(
    () =>
      data.brokerSettlements
        .filter((s) => s.direction === 'we_owe')
        .filter(matchesSelectedBrokerOnSettlement)
        .filter((r) => matchesSettlementSearch(r, search)),
    [data.brokerSettlements, search, selectedBrokerId],
  );
  const receipts = useMemo(
    () =>
      data.brokerSettlements
        .filter((s) => s.direction === 'broker_owes')
        .filter(matchesSelectedBrokerOnSettlement)
        .filter((r) => matchesSettlementSearch(r, search)),
    [data.brokerSettlements, search, selectedBrokerId],
  );

  // Broker credit/debit notes — same split logic the companies section
  // uses. credit_note rows with positive amount = إشعار دائن (we owe
  // broker / unsettled). debit_note rows = إشعار مدين (broker owes us;
  // legacy negative-amount credit_notes also bucket here).
  const debitNotes = useMemo(
    () =>
      (data.brokerCreditNotes as Array<ClientReceiptRow & { broker_id?: string | null }>)
        .filter(
          (r) =>
            !r.cancelled_at &&
            (r.receipt_type === 'debit_note' ||
              (r.receipt_type === 'credit_note' && r.amount < 0)),
        )
        .filter(matchesSelectedBrokerOnNote)
        .filter((r) => matchesClientReceiptSearch(r, search)),
    [data.brokerCreditNotes, search, selectedBrokerId],
  );
  const creditNotes = useMemo(
    () =>
      (data.brokerCreditNotes as Array<ClientReceiptRow & { broker_id?: string | null }>)
        .filter(
          (r) => !r.cancelled_at && r.receipt_type === 'credit_note' && r.amount > 0,
        )
        .filter(matchesSelectedBrokerOnNote)
        .filter((r) => matchesClientReceiptSearch(r, search)),
    [data.brokerCreditNotes, search, selectedBrokerId],
  );

  const totals = useMemo(() => {
    // Live overlay mirrors typed cell values into the pills before the
    // debounced save flushes back. For broker rows, profit lives on
    // each row's `profit` aggregate (which the recalc job sets to
    // `insurance_price - broker_buy_price` for from_broker rows and to
    // `insurance_price - payed_for_company` for to_broker rows), so
    // summing it works for either direction.
    const overlayed = issuancesActive.map((r) => applyOverlay(r, editLocal));
    const sellSum = overlayed.reduce((s, r) => s + Number(r.insurance_price || 0), 0);
    const profitSum = overlayed.reduce((s, r) => {
      if (r.main.broker_direction === 'to_broker') {
        return s + Number(r.profit || 0);
      }
      return s + Math.max(0, Number(r.insurance_price || 0) - Number(r.broker_buy_price || 0));
    }, 0);
    const receivedSum = receipts
      .filter((r) => !r.refused)
      .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    // Split broker notes by receipt_type — they point in opposite
    // directions and CANNOT be combined into one number:
    //   • debit_note  → broker owes us  (paper credit toward what's
    //                   already on the broker → REDUCES remaining)
    //   • credit_note → we owe broker   (paper liability TO the broker
    //                   → does NOT affect "remaining ON brokers")
    // The previous code summed both into brokerCreditNotesSum and
    // subtracted from remainingFromBrokersSum, which incorrectly
    // pulled in credit_notes (the wrong direction) and dropped المتبقي
    // by the full credit-note amount.
    const brokerDebitNotesSum = data.brokerCreditNotes
      .filter((r) => !r.cancelled_at && r.receipt_type === 'debit_note')
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const brokerCreditNotesSum = data.brokerCreditNotes
      .filter((r) => !r.cancelled_at && r.receipt_type === 'credit_note')
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    // المتبقي على الوسطاء — gross broker debt from to_broker policies
    // (broker sold our policy, owes us insurance_price), less سند قبض
    // already collected, less إشعار مدين paper credits. Capped at 0
    // so an over-collection / over-credit reads as settled, not as
    // the broker owing us a negative amount. credit_notes belong to
    // the OTHER ledger direction (what we owe the broker) and are
    // tracked separately so they don't double-count here.
    const grossDueFromBrokers = overlayed.reduce((s, r) => {
      if (r.main.broker_direction !== 'to_broker') return s;
      return s + Number(r.insurance_price || 0);
    }, 0);
    const remainingFromBrokersSum = Math.max(
      0,
      grossDueFromBrokers - receivedSum - brokerDebitNotesSum,
    );
    // What WE owe the brokers — separate ledger. Sums broker_buy_price
    // across from_broker policies (we bought from broker, owe them),
    // PLUS credit_notes (paper liability we acknowledged), MINUS
    // disbursements (سند صرف we already paid out).
    const grossDueToBrokers = overlayed.reduce((s, r) => {
      if (r.main.broker_direction !== 'from_broker') return s;
      return s + Number(r.broker_buy_price || 0);
    }, 0);
    const disbursedToBrokersSum = disbursements
      .filter((r) => !r.refused)
      .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const remainingToBrokersSum = Math.max(
      0,
      grossDueToBrokers + brokerCreditNotesSum - disbursedToBrokersSum,
    );
    return {
      sellSum,
      profitSum,
      receivedSum,
      remainingFromBrokersSum,
      grossDueFromBrokers,
      brokerDebitNotesSum,
      brokerCreditNotesSum,
      grossDueToBrokers,
      disbursedToBrokersSum,
      remainingToBrokersSum,
      activeCount: overlayed.length,
    };
  }, [issuancesActive, receipts, disbursements, editLocal, data.brokerCreditNotes]);

  const fmt = (n: number) => `₪${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  const activeRowCount =
    tab === 'all'
      ? issuancesAll.length
      : tab === 'issuances'
      ? issuancesActive.length
      : tab === 'returns'
      ? returns.length
      : tab === 'disbursements'
      ? disbursements.length
      : tab === 'receipts'
      ? receipts.length
      : tab === 'debit_notes'
      ? debitNotes.length
      : creditNotes.length;
  const countLabel = isNoteTab ? 'إشعار' : isSettlementTab ? 'سند' : 'معاملة';

  const [printing, setPrinting] = useState(false);
  const handlePrint = async () => {
    setPrinting(true);
    try {
      const issuanceList =
        tab === 'all' ? issuancesAll : tab === 'issuances' ? issuancesActive : tab === 'returns' ? returns : undefined;
      const settlementList =
        tab === 'disbursements' ? disbursements : tab === 'receipts' ? receipts : undefined;

      const filterBits: string[] = [];
      if (filters.dateFrom || filters.dateTo) {
        filterBits.push(`التاريخ: ${filters.dateFrom || '—'} → ${filters.dateTo || '—'}`);
      }
      if (search) filterBits.push(`بحث: "${search}"`);

      const payload = buildAccountingReportPayload({
        ctx: {
          section: 'brokers',
          tab,
          filterSummary: filterBits.length > 0 ? filterBits.join(' · ') : undefined,
        },
        stats: buildBrokerStats(totals),
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
      {/* Summary card grid — same visual as the companies + customers
          sections. Six pills covering both ledger directions:
            • What brokers owe US (sell / remaining-from / received-from)
            • What WE owe brokers (remaining-to / paid-to)
            • Bottom-line profit
          The two directions are separate ledgers — debit_notes belong
          to "brokers owe us", credit_notes to "we owe brokers". */}
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <BrokerPillCard
            icon={FileText}
            tone="slate"
            label="سعر البيع للعميل"
            value={fmt(totals.sellSum)}
            hint={`${totals.activeCount} معاملة`}
            tooltip={
              <BreakdownLines
                title="سعر البيع للعميل"
                lines={[
                  { label: 'عدد المعاملات', value: `${totals.activeCount}` },
                  { label: 'الإجمالي', value: fmt(totals.sellSum), strong: true },
                ]}
              />
            }
          />
          <BrokerPillCard
            icon={ArrowUpRight}
            tone="rose"
            label="المتبقي على الوسطاء"
            value={fmt(totals.remainingFromBrokersSum)}
            hint="بعد المقبوض والإشعارات"
            tooltip={
              <BreakdownLines
                title="المتبقي على الوسطاء (الصافي)"
                lines={[
                  { label: 'إجمالي مستحق من الوسطاء', value: fmt(totals.grossDueFromBrokers) },
                  { label: 'مقبوض من الوسطاء', value: `− ${fmt(totals.receivedSum)}` },
                  ...(totals.brokerDebitNotesSum > 0
                    ? [{ label: 'إشعار مدين (الوسيط مدين لنا)', value: `− ${fmt(totals.brokerDebitNotesSum)}` }]
                    : []),
                  { label: 'المتبقي', value: fmt(totals.remainingFromBrokersSum), strong: true },
                  {
                    label: 'ملاحظة',
                    value: 'إشعار دائن (ما نحن مدينين به للوسيط) محسوب على pill منفصل',
                    muted: true,
                  },
                ]}
              />
            }
          />
          <BrokerPillCard
            icon={ArrowDownLeft}
            tone="emerald"
            label="مقبوض من الوسطاء"
            value={fmt(totals.receivedSum)}
            hint={`${receipts.filter((r) => !r.refused).length} سند قبض`}
            tooltip={
              <BreakdownLines
                title="مقبوض من الوسطاء"
                lines={[
                  {
                    label: 'سندات القبض غير المرفوضة',
                    value: `${receipts.filter((r) => !r.refused).length}`,
                  },
                  { label: 'الإجمالي', value: fmt(totals.receivedSum), strong: true },
                ]}
              />
            }
          />
          <BrokerPillCard
            icon={ArrowUpRight}
            tone="amber"
            label="المستحق للوسطاء"
            value={fmt(totals.remainingToBrokersSum)}
            hint="ما نحن مدينين به للوسيط"
            tooltip={
              <BreakdownLines
                title="المستحق للوسطاء (نحن المدينين)"
                lines={[
                  { label: 'إجمالي مستحق (من from_broker)', value: fmt(totals.grossDueToBrokers) },
                  ...(totals.brokerCreditNotesSum > 0
                    ? [{ label: 'إشعار دائن (الوسيط دائن عندنا)', value: `+ ${fmt(totals.brokerCreditNotesSum)}` }]
                    : []),
                  { label: 'مدفوع للوسطاء', value: `− ${fmt(totals.disbursedToBrokersSum)}` },
                  { label: 'المتبقي علينا', value: fmt(totals.remainingToBrokersSum), strong: true },
                ]}
              />
            }
          />
          <BrokerPillCard
            icon={ArrowDownLeft}
            tone="amber"
            label="مدفوع للوسطاء"
            value={fmt(totals.disbursedToBrokersSum)}
            hint={`${disbursements.filter((r) => !r.refused).length} سند صرف`}
            tooltip={
              <BreakdownLines
                title="مدفوع للوسطاء"
                lines={[
                  {
                    label: 'سندات الصرف غير المرفوضة',
                    value: `${disbursements.filter((r) => !r.refused).length}`,
                  },
                  { label: 'الإجمالي', value: fmt(totals.disbursedToBrokersSum), strong: true },
                ]}
              />
            }
          />
          <BrokerPillCard
            icon={TrendingUp}
            tone="emerald"
            label="الربح"
            value={fmt(totals.profitSum)}
            hint="من إصدارات الوسطاء"
            tooltip={
              <BreakdownLines
                title="الربح من الوسطاء"
                lines={[
                  { label: 'مجموع الأرباح', value: fmt(totals.profitSum), strong: true },
                ]}
              />
            }
          />
        </div>
      </TooltipProvider>

      {/* Toolbar — same layout as the companies section: search pinned
          to the visual right via justify-between (RTL flex puts the
          first DOM child at the right edge); controls clustered on
          the left. Tabs render below alongside the filter chip strip. */}
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
          <BrokerPicker
            value={selectedBrokerId}
            options={brokerOptions}
            onChange={setSelectedBrokerId}
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
            companyOptions={brokerCompanyOptions}
            typeOptions={typeOptions}
            paymentMethodOptions={paymentOptions}
            show={{
              dateRange: true,
              companies: !isSettlementTab && !isNoteTab,
              types: !isSettlementTab && !isNoteTab,
              paymentMethods: true,
              sort: true,
            }}
          />
        </div>
      </div>

      {/* Active-filter strip — date scope chip + locked-broker chip. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary" className="gap-1.5 font-medium">
          <CalendarRange className="h-3.5 w-3.5" />
          {describeBrokerRange(filters.dateFrom, filters.dateTo)}
        </Badge>
        {selectedBrokerId ? (
          <Badge variant="secondary" className="gap-1.5 font-medium">
            <Users className="h-3.5 w-3.5" />
            {selectedBrokerLabel || '—'}
            <button
              type="button"
              onClick={() => setSelectedBrokerId(null)}
              className="ml-1 -mr-0.5 rounded-full hover:bg-foreground/10"
              aria-label="مسح فلتر الوسيط"
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
                ? disbursements.length
                : key === 'receipts'
                ? receipts.length
                : key === 'debit_notes'
                ? debitNotes.length
                : creditNotes.length;
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
            mode="broker"
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
            mode="broker"
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
            mode="broker"
            visible={issuanceCols.visible}
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
            onPrimaryReceiptClick={openPrimaryReceiptVoucher}
          />
        </TabsContent>
        <TabsContent value="disbursements" className="mt-3 m-0">
          <SettlementsTable
            rows={disbursements}
            loading={data.loading}
            voucherKind="disbursement"
            showDirection
            visible={settlementCols.visible}
            entityLabel="الوسيط"
            onEdit={handleEdit}
            onDelete={handleDelete}
            onVoucherClick={openSettlementVoucher}
            focusSettlementId={focusSettlementId}
            onSettlementChanged={() => data.refresh()}
          />
        </TabsContent>
        <TabsContent value="receipts" className="mt-3 m-0">
          <SettlementsTable
            rows={receipts}
            loading={data.loading}
            voucherKind="receipt"
            showDirection
            visible={settlementCols.visible}
            entityLabel="الوسيط"
            onEdit={handleEdit}
            onDelete={handleDelete}
            onVoucherClick={openSettlementVoucher}
            focusSettlementId={focusSettlementId}
            onSettlementChanged={() => data.refresh()}
          />
        </TabsContent>
        <TabsContent value="debit_notes" className="mt-3 m-0">
          <BrokerNotesTable
            rows={debitNotes}
            loading={data.loading}
            kind="debit"
            visible={noteCols.visible}
            onVoucherClick={openNoteVoucher}
          />
        </TabsContent>
        <TabsContent value="credit_notes" className="mt-3 m-0">
          <BrokerNotesTable
            rows={creditNotes}
            loading={data.loading}
            kind="credit"
            visible={noteCols.visible}
            onVoucherClick={openNoteVoucher}
          />
        </TabsContent>
      </Tabs>

      {/* Sticky floating print bar — matches the companies section. */}
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
        mode="broker"
        kind={addKind}
        entities={data.brokers.map((b) => ({ id: b.id, name: b.name }))}
        onSaved={() => data.refresh()}
      />

      <EditSettlementDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        table="broker_settlements"
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

// BrokerPillCard — mirrors CompanyPillCard from the companies section
// so both surfaces share the same visual vocabulary. Icon bubble in a
// tinted colour + label + tabular value + optional hint subtitle;
// breakdown tooltip on hover when supplied.
const BR_TONE_CLASSES: Record<string, { bg: string; text: string }> = {
  slate: { bg: 'bg-slate-500/10', text: 'text-slate-700' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-700' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-700' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-700' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-700' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-700' },
};

function BrokerPillCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
  tooltip,
}: {
  icon: LucideIcon;
  tone: keyof typeof BR_TONE_CLASSES;
  label: string;
  value: string;
  hint?: string;
  tooltip?: ReactNode;
}) {
  const cls = BR_TONE_CLASSES[tone];
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
// Helpers — date range chip + broker picker + notes table
// ──────────────────────────────────────────────────────────────

const AR_MONTH_NAMES_BR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function formatBrokerDate(iso: string): string {
  if (!iso) return '—';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function describeBrokerRange(from: string, to: string): string {
  if (!from && !to) return 'كل التواريخ';
  if (!from || !to) return `${from || '...'} → ${to || '...'}`;
  const f = from.split('-');
  const t = to.split('-');
  if (f.length === 3 && t.length === 3 && f[0] === t[0] && f[1] === t[1]) {
    const y = Number(f[0]);
    const mIdx = Number(f[1]) - 1;
    const lastDay = new Date(y, mIdx + 1, 0).getDate();
    if (Number(f[2]) === 1 && Number(t[2]) === lastDay) {
      return `شهر ${AR_MONTH_NAMES_BR[mIdx] ?? f[1]} ${y}`;
    }
  }
  return `${formatBrokerDate(from)} → ${formatBrokerDate(to)}`;
}

function BrokerPicker({
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
          <Users className="h-3.5 w-3.5" />
          <span className="truncate flex-1 text-right">
            {value ? selectedLabel : 'اختر وسيط...'}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="end" dir="rtl">
        <Command>
          <CommandInput
            placeholder="ابحث باسم الوسيط..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {filtered.length === 0 ? (
              <CommandEmpty>لا يوجد وسطاء</CommandEmpty>
            ) : (
              filtered.map((b) => (
                <CommandItem
                  key={b.value}
                  value={b.value}
                  onSelect={() => {
                    onChange(b.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex items-center gap-2 data-[selected=true]:bg-muted data-[selected=true]:text-foreground aria-selected:bg-muted aria-selected:text-foreground"
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5',
                      value === b.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{b.label}</span>
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
                مسح اختيار الوسيط
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ──────────────────────────────────────────────────────────────
// BrokerNotesTable — إشعار دائن / إشعار مدين للوسطاء
// ──────────────────────────────────────────────────────────────
//
// Mirrors the companies-section CompanyCreditNotesTable visually but
// labeled for broker counterparties. Each row is a receipts row
// (broker_id set) so the voucher click feeds ReceiptActionsDialog
// directly without an async lookup.

function formatNoteDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'dd/MM/yyyy');
  } catch {
    return iso;
  }
}

function BrokerNotesTable({
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
          ? 'لا توجد إشعارات مدين للوسطاء في هذا النطاق'
          : 'لا توجد إشعارات دائن للوسطاء في هذا النطاق'}
      </div>
    );
  }
  // debit_note on a broker = broker owes the office → emerald (positive
  // for the office). credit_note = office owes the broker → rose.
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
              <TableHead className="whitespace-nowrap text-right">الوسيط</TableHead>
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
            // a single notes column. Split so the reason shows on its
            // own line; most rows only carry the reason.
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
                    {formatNoteDate(r.receipt_date)}
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
