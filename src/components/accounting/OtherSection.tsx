// ─── /accounting → آخر ──────────────────────────────────────────
//
// External-party accounting surface. Lists every voucher the office
// has issued or received against a recipient that isn't a client /
// broker / insurance company in the system (utility, lawyer, garage,
// salary, rent, taxes…). All four kinds live on the same receipts
// row shape (the AddOtherVoucherDialog writes them) — we just split
// client-side into 4 sub-tabs.
//
// Replaces the old "المصاريف" tab on the Accounting page. The
// `expenses` table itself stays untouched (Cheques page still writes
// to it via AddExpenseDialog) — this surface is purely about the
// voucher-bound external-party flow.

import { ReactNode, useMemo, useState } from 'react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CalendarRange,
  Check,
  ChevronsUpDown,
  Plus,
  Receipt,
  Search,
  TrendingUp,
  Users,
  Wallet,
  WalletMinimal,
  X,
  type LucideIcon,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AccountingFilters, AccountingFiltersValue } from './AccountingFilters';
import { ManageColumnsDropdown } from './ManageColumnsDropdown';
import { useTableColumnVisibility } from '@/hooks/useTableColumnVisibility';
import {
  COMPANY_SETTLEMENT_COLUMNS,
  COMPANY_SETTLEMENT_DEFAULT_OFF,
} from './columnDefs';
import {
  matchesClientReceiptSearch,
  useAccountingData,
  type ClientReceiptRow,
} from './useAccountingData';
import { PAYMENT_METHOD_LABELS } from './accountingTypes';
import { cn } from '@/lib/utils';
import { ReceiptActionsDialog, type VoucherActionRow } from './ReceiptActionsDialog';
import { AddOtherVoucherDialog } from '../receipts/AddOtherVoucherDialog';
import type { VoucherKind } from '../receipts/AddVoucherDialog';
import { formatOtherCategory } from './otherCategoryLabel';

// 4 sub-tabs. No "all/issuances/returns" — external parties have no
// policy concept; every row is a voucher in one of four flavours.
type SubTab = 'disbursements' | 'receipts' | 'debit_notes' | 'credit_notes';

const TABS: { key: SubTab; label: string; Icon: LucideIcon }[] = [
  { key: 'disbursements', label: 'سند الصرف', Icon: ArrowUpRight },
  { key: 'receipts', label: 'سند القبض', Icon: ArrowDownRight },
  { key: 'debit_notes', label: 'إشعار مدين', Icon: TrendingUp },
  { key: 'credit_notes', label: 'إشعار دائن', Icon: Wallet },
];

// Same compact column set the broker / company notes tables use, plus
// a category column we drop in below the header. Default columns hide
// the category by default — most agents already see it in the table
// row context, so leave it out of the visible-by-default set.
const COL_KEYS = COMPANY_SETTLEMENT_COLUMNS.map((c) => c.key);
const COL_DEFAULT_VISIBLE = COL_KEYS.filter(
  (k) => !COMPANY_SETTLEMENT_DEFAULT_OFF.has(k),
);

interface OtherSectionProps {
  /** Page-level branch filter (global admins only). null = no extra
   *  filter — caller's natural RLS scope still applies. */
  branchId?: string | null;
}

export function OtherSection({ branchId }: OtherSectionProps = {}) {
  const [tab, setTab] = useState<SubTab>('disbursements');
  const [search, setSearch] = useState('');
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
  const [voucherActionRow, setVoucherActionRow] = useState<VoucherActionRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<VoucherKind>('payment');
  // Same month-defaulting as the other accounting tabs — loading this
  // section on day 18 should NOT dump the whole year by default.
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

  const data = useAccountingData(filters, branchId);

  const cols = useTableColumnVisibility(
    'accounting-other-vouchers-v1',
    COL_DEFAULT_VISIBLE,
    COL_KEYS,
  );

  // Distinct recipient names from loaded rows feed the picker. Using
  // the data we already have avoids a second round-trip and keeps the
  // picker scoped to whatever the date filter exposes.
  const recipientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of data.otherReceipts) {
      if (r.recipient_name) set.add(r.recipient_name);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, 'ar'))
      .map((name) => ({ value: name, label: name }));
  }, [data.otherReceipts]);

  const matchesPicker = (r: ClientReceiptRow) =>
    !selectedRecipient || r.recipient_name === selectedRecipient;

  // Split the bucket once, reuse for tab counts + table rows. Cancelled
  // rows (refused / voided) are kept in the lists for visibility but
  // excluded from the KPI totals further down.
  const disbursementsAll = useMemo(
    () =>
      data.otherReceipts
        .filter((r) => r.receipt_type === 'disbursement')
        .filter(matchesPicker)
        .filter((r) => matchesClientReceiptSearch(r, search)),
    [data.otherReceipts, search, selectedRecipient],
  );
  const receiptsAll = useMemo(
    () =>
      data.otherReceipts
        .filter((r) => r.receipt_type === 'payment')
        .filter(matchesPicker)
        .filter((r) => matchesClientReceiptSearch(r, search)),
    [data.otherReceipts, search, selectedRecipient],
  );
  const debitNotesAll = useMemo(
    () =>
      data.otherReceipts
        .filter((r) => r.receipt_type === 'debit_note')
        .filter(matchesPicker)
        .filter((r) => matchesClientReceiptSearch(r, search)),
    [data.otherReceipts, search, selectedRecipient],
  );
  const creditNotesAll = useMemo(
    () =>
      data.otherReceipts
        .filter((r) => r.receipt_type === 'credit_note')
        .filter(matchesPicker)
        .filter((r) => matchesClientReceiptSearch(r, search)),
    [data.otherReceipts, search, selectedRecipient],
  );

  // KPI totals exclude cancelled vouchers — they don't represent real
  // cash movement (the office voided them). Counts include cancelled
  // rows so the agent can spot voids without an extra tab.
  const totals = useMemo(() => {
    const disbursedSum = disbursementsAll
      .filter((r) => !r.cancelled_at)
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const receivedSum = receiptsAll
      .filter((r) => !r.cancelled_at)
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const debitSum = debitNotesAll
      .filter((r) => !r.cancelled_at)
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const creditSum = creditNotesAll
      .filter((r) => !r.cancelled_at)
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    // صافي التدفق = حقيقي مستلم − حقيقي مدفوع. الإشعارات بتأثر على
    // الذمم بس مش بتغير الكاش الفعلي، فبقوا برة المعادلة هون. الـ pill
    // الخاص فيهم بتحت بظهر الذمم منفصلة.
    const netSum = receivedSum - disbursedSum;
    return { disbursedSum, receivedSum, debitSum, creditSum, netSum };
  }, [disbursementsAll, receiptsAll, debitNotesAll, creditNotesAll]);

  const activeRows =
    tab === 'disbursements'
      ? disbursementsAll
      : tab === 'receipts'
      ? receiptsAll
      : tab === 'debit_notes'
      ? debitNotesAll
      : creditNotesAll;

  const countLabel = tab === 'debit_notes' || tab === 'credit_notes' ? 'إشعار' : 'سند';

  const fmt = (n: number) => `₪${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  const openVoucher = (row: ClientReceiptRow) => {
    setVoucherActionRow({
      id: row.id,
      receipt_type: row.receipt_type,
      voucher_number: row.voucher_number,
      payment_id: row.payment_id ?? null,
      client_name: row.recipient_name ?? row.client_name,
      client_phone: row.client_phone,
    });
  };

  const paymentOptions = useMemo(
    () => Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
    [],
  );

  // Trigger the AddOtherVoucherDialog with the chosen voucher kind.
  // Same dialog the /receipts page uses — single source of truth.
  const openAdd = (kind: VoucherKind) => {
    setAddKind(kind);
    setAddOpen(true);
  };

  return (
    <div className="space-y-2.5">
      {/* KPI grid — 5 pills covering cash flow + the two paper ledgers. */}
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <OtherPillCard
            icon={ArrowUpRight}
            tone="rose"
            label="المدفوع للجهات الخارجية"
            value={fmt(totals.disbursedSum)}
            hint={`${disbursementsAll.filter((r) => !r.cancelled_at).length} سند صرف`}
            tooltip={
              <BreakdownLines
                title="المدفوع للجهات الخارجية"
                lines={[
                  {
                    label: 'عدد السندات (غير الملغية)',
                    value: `${disbursementsAll.filter((r) => !r.cancelled_at).length}`,
                  },
                  { label: 'الإجمالي', value: fmt(totals.disbursedSum), strong: true },
                ]}
              />
            }
          />
          <OtherPillCard
            icon={ArrowDownRight}
            tone="emerald"
            label="المستلم من الجهات الخارجية"
            value={fmt(totals.receivedSum)}
            hint={`${receiptsAll.filter((r) => !r.cancelled_at).length} سند قبض`}
            tooltip={
              <BreakdownLines
                title="المستلم من الجهات الخارجية"
                lines={[
                  {
                    label: 'عدد السندات (غير الملغية)',
                    value: `${receiptsAll.filter((r) => !r.cancelled_at).length}`,
                  },
                  { label: 'الإجمالي', value: fmt(totals.receivedSum), strong: true },
                ]}
              />
            }
          />
          <OtherPillCard
            icon={TrendingUp}
            tone="sky"
            label="مستحق لنا على الجهات"
            value={fmt(totals.debitSum)}
            hint="إشعار مدين"
            tooltip={
              <BreakdownLines
                title="إشعارات مدين (الجهة مدينة لنا)"
                lines={[
                  {
                    label: 'عدد الإشعارات',
                    value: `${debitNotesAll.filter((r) => !r.cancelled_at).length}`,
                  },
                  { label: 'الإجمالي', value: fmt(totals.debitSum), strong: true },
                ]}
              />
            }
          />
          <OtherPillCard
            icon={Wallet}
            tone="amber"
            label="مستحق علينا للجهات"
            value={fmt(totals.creditSum)}
            hint="إشعار دائن"
            tooltip={
              <BreakdownLines
                title="إشعارات دائن (نحن مدينون للجهة)"
                lines={[
                  {
                    label: 'عدد الإشعارات',
                    value: `${creditNotesAll.filter((r) => !r.cancelled_at).length}`,
                  },
                  { label: 'الإجمالي', value: fmt(totals.creditSum), strong: true },
                ]}
              />
            }
          />
          <OtherPillCard
            icon={Banknote}
            tone={totals.netSum >= 0 ? 'emerald' : 'rose'}
            label="صافي التدفق النقدي"
            value={fmt(totals.netSum)}
            hint="مستلم − مدفوع"
            tooltip={
              <BreakdownLines
                title="صافي التدفق النقدي"
                lines={[
                  { label: 'مستلم', value: `+ ${fmt(totals.receivedSum)}` },
                  { label: 'مدفوع', value: `− ${fmt(totals.disbursedSum)}` },
                  { label: 'الصافي', value: fmt(totals.netSum), strong: true },
                  {
                    label: 'ملاحظة',
                    value: 'الإشعارات (مدين/دائن) لا تدخل في صافي الكاش — تظهر منفصلة فوق',
                    muted: true,
                  },
                ]}
              />
            }
          />
        </div>
      </TooltipProvider>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative w-full sm:w-80 md:w-96">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالجهة، رقم السند، الملاحظات…"
            className="w-full pr-9"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {data.loading ? '...' : `${activeRows.length} ${countLabel}`}
          </span>
          <RecipientPicker
            value={selectedRecipient}
            options={recipientOptions}
            onChange={setSelectedRecipient}
          />
          <ManageColumnsDropdown
            columns={COMPANY_SETTLEMENT_COLUMNS}
            visible={cols.visible}
            onToggle={cols.toggle}
            onReset={cols.reset}
          />
          <AccountingFilters
            value={filters}
            onChange={setFilters}
            companyOptions={[]}
            typeOptions={[]}
            paymentMethodOptions={paymentOptions}
            show={{
              dateRange: true,
              companies: false,
              types: false,
              paymentMethods: true,
              sort: true,
            }}
          />
          {/* "إضافة سند آخر" — splits into 4 voucher kinds, opens
              AddOtherVoucherDialog with the chosen kind. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                إضافة سند
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openAdd('payment')}>
                <Receipt className="h-4 w-4 ml-2 text-emerald-600" />
                سند قبض من جهة خارجية
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAdd('disbursement')}>
                <Banknote className="h-4 w-4 ml-2 text-rose-600" />
                سند صرف لجهة خارجية
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAdd('credit_note')}>
                <Wallet className="h-4 w-4 ml-2 text-amber-600" />
                إشعار دائن
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAdd('debit_note')}>
                <WalletMinimal className="h-4 w-4 ml-2 text-sky-600" />
                إشعار مدين
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Active-filter strip — date scope chip + locked-recipient chip. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary" className="gap-1.5 font-medium">
          <CalendarRange className="h-3.5 w-3.5" />
          {describeRange(filters.dateFrom, filters.dateTo)}
        </Badge>
        {selectedRecipient ? (
          <Badge variant="secondary" className="gap-1.5 font-medium">
            <Users className="h-3.5 w-3.5" />
            {selectedRecipient}
            <button
              type="button"
              onClick={() => setSelectedRecipient(null)}
              className="ml-1 -mr-0.5 rounded-full hover:bg-foreground/10"
              aria-label="مسح فلتر الجهة"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
        <TabsList className="grid w-full grid-cols-4">
          {TABS.map(({ key, label, Icon }) => {
            const count =
              key === 'disbursements'
                ? disbursementsAll.length
                : key === 'receipts'
                ? receiptsAll.length
                : key === 'debit_notes'
                ? debitNotesAll.length
                : creditNotesAll.length;
            return (
              <TabsTrigger key={key} value={key} className="gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
                <span className="text-xs opacity-70">({count})</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {TABS.map(({ key }) => (
          <TabsContent key={key} value={key} className="mt-3 m-0">
            <OtherVouchersTable
              rows={
                key === 'disbursements'
                  ? disbursementsAll
                  : key === 'receipts'
                  ? receiptsAll
                  : key === 'debit_notes'
                  ? debitNotesAll
                  : creditNotesAll
              }
              loading={data.loading}
              kind={key}
              visible={cols.visible}
              onVoucherClick={openVoucher}
            />
          </TabsContent>
        ))}
      </Tabs>

      <ReceiptActionsDialog
        row={voucherActionRow}
        onClose={() => setVoucherActionRow(null)}
      />

      <AddOtherVoucherDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        kind={addKind}
        onSaved={() => data.refresh()}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Pill card (same visual vocab as BrokerPillCard / CompanyPillCard)
// ──────────────────────────────────────────────────────────────

const PILL_TONE_CLASSES: Record<string, { bg: string; text: string }> = {
  slate: { bg: 'bg-slate-500/10', text: 'text-slate-700' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-700' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-700' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-700' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-700' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-700' },
};

function OtherPillCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
  tooltip,
}: {
  icon: LucideIcon;
  tone: keyof typeof PILL_TONE_CLASSES;
  label: string;
  value: string;
  hint?: string;
  tooltip?: ReactNode;
}) {
  const cls = PILL_TONE_CLASSES[tone];
  const card = (
    <Card className={tooltip ? 'cursor-help' : undefined}>
      <CardContent className="py-3 px-4 flex items-center gap-3">
        <div
          className={`h-9 w-9 rounded-xl ${cls.bg} flex items-center justify-center shrink-0`}
        >
          <Icon className={`h-4 w-4 ${cls.text}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p
            className={`text-lg font-bold tabular-nums ${cls.text} whitespace-nowrap`}
          >
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
// Date range chip helper (kept in this file so OtherSection stays
// self-contained — the brokers/companies sections each have their
// own copy, same shape).
// ──────────────────────────────────────────────────────────────

const AR_MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function formatDateLocal(iso: string): string {
  if (!iso) return '—';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function describeRange(from: string, to: string): string {
  if (!from && !to) return 'كل التواريخ';
  if (!from || !to) return `${from || '...'} → ${to || '...'}`;
  const f = from.split('-');
  const t = to.split('-');
  if (f.length === 3 && t.length === 3 && f[0] === t[0] && f[1] === t[1]) {
    const y = Number(f[0]);
    const mIdx = Number(f[1]) - 1;
    const lastDay = new Date(y, mIdx + 1, 0).getDate();
    if (Number(f[2]) === 1 && Number(t[2]) === lastDay) {
      return `شهر ${AR_MONTH_NAMES[mIdx] ?? f[1]} ${y}`;
    }
  }
  return `${formatDateLocal(from)} → ${formatDateLocal(to)}`;
}

// ──────────────────────────────────────────────────────────────
// Recipient picker — distinct recipient_name values from loaded rows.
// Mirrors BrokerPicker UX so the kashf-style chip + clear button feel
// consistent across the three sections.
// ──────────────────────────────────────────────────────────────

function RecipientPicker({
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
  const selectedLabel = value
    ? options.find((o) => o.value === value)?.label ?? value
    : '';

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
            {value ? selectedLabel : 'اختر جهة...'}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="end" dir="rtl">
        <Command>
          <CommandInput
            placeholder="ابحث باسم الجهة..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {filtered.length === 0 ? (
              <CommandEmpty>لا توجد جهات</CommandEmpty>
            ) : (
              filtered.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex items-center gap-2 data-[selected=true]:bg-muted data-[selected=true]:text-foreground aria-selected:bg-muted aria-selected:text-foreground"
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5',
                      value === o.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{o.label}</span>
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
                مسح اختيار الجهة
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ──────────────────────────────────────────────────────────────
// OtherVouchersTable — single table reused for all 4 sub-tabs.
// ──────────────────────────────────────────────────────────────

function formatVoucherDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'dd/MM/yyyy');
  } catch {
    return iso;
  }
}

function OtherVouchersTable({
  rows,
  loading,
  kind,
  visible,
  onVoucherClick,
}: {
  rows: ClientReceiptRow[];
  loading: boolean;
  kind: SubTab;
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
    const empty: Record<SubTab, string> = {
      disbursements: 'لا توجد سندات صرف لجهات خارجية في هذا النطاق',
      receipts: 'لا توجد سندات قبض من جهات خارجية في هذا النطاق',
      debit_notes: 'لا توجد إشعارات مدين على جهات خارجية في هذا النطاق',
      credit_notes: 'لا توجد إشعارات دائن للجهات الخارجية في هذا النطاق',
    };
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        {empty[kind]}
      </div>
    );
  }
  // Outflow → rose, inflow / amount-owed-to-us → emerald. Mirrors the
  // sign convention agents already see on the brokers / companies tabs.
  const amountClass =
    kind === 'disbursements' || kind === 'credit_notes'
      ? 'text-rose-700'
      : 'text-emerald-700';
  const show = (key: string) => visible.includes(key);
  const voucherLabel =
    kind === 'debit_notes' || kind === 'credit_notes' ? 'رقم الإشعار' : 'رقم السند';

  return (
    <div className="rounded-md border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {show('voucher_number') && (
              <TableHead className="whitespace-nowrap text-right">{voucherLabel}</TableHead>
            )}
            {show('date') && (
              <TableHead className="whitespace-nowrap text-right">التاريخ</TableHead>
            )}
            {show('entity') && (
              <TableHead className="whitespace-nowrap text-right">الجهة</TableHead>
            )}
            <TableHead className="whitespace-nowrap text-right">التصنيف</TableHead>
            {show('payment_method') && (
              <TableHead className="whitespace-nowrap text-right">
                {kind === 'debit_notes' || kind === 'credit_notes' ? 'السبب' : 'طريقة الدفع'}
              </TableHead>
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
            const isCancelled = !!r.cancelled_at;
            // Notes from the dialog can be "<reason>\nملاحظات: <free>"
            // for note rows; for cash rows it's typically just freeform
            // notes — handle both shapes.
            const noteParts = (r.notes ?? '').split('\nملاحظات: ');
            const primary = noteParts[0] || '';
            const extra = noteParts[1] ?? '';
            const methodCell =
              kind === 'debit_notes' || kind === 'credit_notes'
                ? primary || '—'
                : (r.payment_method && PAYMENT_METHOD_LABELS[r.payment_method]) ||
                  r.payment_method ||
                  '—';
            return (
              <TableRow
                key={r.id}
                className={cn(
                  'text-sm',
                  isCancelled && 'bg-muted/40 text-muted-foreground line-through',
                )}
              >
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
                    {formatVoucherDate(r.receipt_date)}
                  </TableCell>
                )}
                {show('entity') && (
                  <TableCell className="whitespace-nowrap font-medium">
                    {r.recipient_name ?? r.client_name ?? '—'}
                  </TableCell>
                )}
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatOtherCategory(r.recipient_category) ?? '—'}
                </TableCell>
                {show('payment_method') && (
                  <TableCell className="max-w-[200px] truncate text-xs">
                    {methodCell}
                  </TableCell>
                )}
                {show('amount') && (
                  <TableCell
                    className={cn(
                      'text-left ltr-nums font-semibold tabular-nums whitespace-nowrap',
                      !isCancelled && amountClass,
                    )}
                  >
                    ₪{Math.round(Math.abs(Number(r.amount || 0))).toLocaleString('en-US')}
                  </TableCell>
                )}
                {show('notes') && (
                  <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                    {extra || (kind === 'debit_notes' || kind === 'credit_notes' ? '—' : primary || '—')}
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

