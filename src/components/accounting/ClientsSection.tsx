import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
  ArrowDownLeft,
  ArrowUpRight,
  CalendarRange,
  Check,
  ChevronsUpDown,
  FileText,
  LayoutGrid,
  Loader2,
  RotateCcw,
  Search,
  TrendingUp,
  User as UserIcon,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AccountingFilters, AccountingFiltersValue } from './AccountingFilters';
import { PAYMENT_METHOD_LABELS, POLICY_TYPE_DISPLAY, type IssuanceRow } from './accountingTypes';
import {
  matchesClientReceiptSearch,
  matchesIssuanceSearch,
  useAccountingData,
  type ClientReceiptRow,
} from './useAccountingData';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { cn } from '@/lib/utils';
import { CustomerStatementModal } from '@/components/clients/CustomerStatementModal';

interface ClientLite {
  id: string;
  full_name: string;
  phone_number: string | null;
  id_number: string | null;
}

interface ClientsSectionProps {
  /** Page-level branch filter (global admins only). null = no extra
   *  filter — caller's natural RLS scope still applies. */
  branchId?: string | null;
}

type SubTab =
  | 'all'
  | 'issuances'
  | 'payments'
  | 'disbursements'
  | 'cancellations'
  | 'debit_notes'
  | 'credit_notes';

const SUB_TABS: { key: SubTab; label: string; Icon: LucideIcon }[] = [
  { key: 'all', label: 'الكل', Icon: LayoutGrid },
  { key: 'issuances', label: 'الإصدارات', Icon: FileText },
  { key: 'payments', label: 'سند قبض', Icon: ArrowDownLeft },
  { key: 'disbursements', label: 'سند صرف', Icon: ArrowUpRight },
  { key: 'cancellations', label: 'سند إلغاء', Icon: RotateCcw },
  { key: 'debit_notes', label: 'إشعار مدين', Icon: TrendingUp },
  { key: 'credit_notes', label: 'إشعار دائن', Icon: Wallet },
];

// Map our payment methods to display labels — reused by every
// receipt-flavored sub-tab table.
const paymentLabel = (m: string | null): string => {
  if (!m) return '—';
  if (m === 'multiple') return 'متعدد';
  return PAYMENT_METHOD_LABELS[m] ?? m;
};

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'dd/MM/yyyy');
  } catch {
    return iso;
  }
};

const formatMoney = (n: number): string =>
  `₪${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

// Compute the current-month range as ISO date strings. Used as the
// default for the customer accounting filter — the user's instruction:
// "الفلترة دايما لازم تكون على سبط هادا الشهر فقط". A user can widen
// or change the range from the Filter popover, but the view loads
// scoped so opening the tab on the 18th doesn't dump the whole year
// onto the screen.
const currentMonthRange = (): { from: string; to: string } => {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(y, m + 1, 0).getDate();
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(lastDay)}`,
  };
};

// Pretty-print an ISO date range as the active-filter chip text. A
// full-calendar-month range collapses to its Arabic month name; any
// other range renders as "dd/MM/yyyy → dd/MM/yyyy" so the user can
// tell at a glance whether they're on a single month or a custom
// window.
const AR_MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
const describeRange = (from: string, to: string): string => {
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
  return `${formatDate(from)} → ${formatDate(to)}`;
};

// "Office billable" for a single policy — what enters the office's
// books from the customer side. Matches the kashf rule: إلزامي base
// price is paid directly to the insurance company (not on the
// office's كشف), so only its commission counts. Everything else
// counts insurance_price + office_commission.
const policyOfficeAmount = (p: {
  insurance_price: number;
  office_commission: number | null;
  policy_type_parent: string;
}): number => {
  const commission = Number(p.office_commission || 0);
  if (p.policy_type_parent === 'ELZAMI') return commission;
  return Number(p.insurance_price || 0) + commission;
};

export function ClientsSection({ branchId }: ClientsSectionProps = {}) {
  const [tab, setTab] = useState<SubTab>('all');
  const [search, setSearch] = useState('');
  // Default to the current calendar month so the customer view loads
  // pre-scoped — the user explicitly asked the customer tab not to
  // dump the entire history every time it opens.
  const [filters, setFilters] = useState<AccountingFiltersValue>(() => {
    const r = currentMonthRange();
    return {
      dateFrom: r.from,
      dateTo: r.to,
      companies: [],
      types: [],
      paymentMethods: [],
    };
  });
  // When set, every list filters down to this single customer and the
  // "كشف حساب" action appears so the user can open the per-year
  // statement modal without leaving the accounting page.
  const [selectedClient, setSelectedClient] = useState<ClientLite | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);

  const data = useAccountingData(filters, branchId);

  // ── Combine issuances + returns into ONE customer-perspective
  //    package list. Each row is a معاملة (group_id-keyed); cancelled
  //    packages stay in the list with a status badge so the customer
  //    view shows the full history, not just active policies.
  const allPackages = useMemo<IssuanceRow[]>(
    () => [...data.issuances, ...data.returns],
    [data.issuances, data.returns],
  );

  // Single source of truth for the customer narrowing: when a client
  // is picked from the dropdown, every list collapses to their rows.
  // Free-text search still applies on top of that. Per the user:
  // "في حال بحثت على اسم عميل او فلترت على اسم عميل التنتين لازم
  // تشتغل نفس بعض" — both paths funnel through the same predicate.
  const clientId = selectedClient?.id ?? null;
  const filteredPackages = useMemo(
    () =>
      allPackages.filter(
        (r) =>
          (!clientId || r.client_id === clientId) &&
          matchesIssuanceSearch(r, search),
      ),
    [allPackages, search, clientId],
  );

  // ── Receipt sub-tabs (live rows after free-text search) ───────
  const payments = useMemo(
    () =>
      data.clientPayments.filter(
        (r) =>
          !r.cancelled_at &&
          (!clientId || r.client_id === clientId) &&
          matchesClientReceiptSearch(r, search),
      ),
    [data.clientPayments, search, clientId],
  );
  const cancellations = useMemo(
    () =>
      data.clientCancellations.filter(
        (r) =>
          (!clientId || r.client_id === clientId) &&
          matchesClientReceiptSearch(r, search),
      ),
    [data.clientCancellations, search, clientId],
  );
  const disbursements = useMemo(
    () =>
      data.clientDisbursements.filter(
        (r) =>
          !r.cancelled_at &&
          (!clientId || r.client_id === clientId) &&
          matchesClientReceiptSearch(r, search),
      ),
    [data.clientDisbursements, search, clientId],
  );
  // Two كinds of إشعار live in the same bucket here:
  //   • receipt_type='credit_note', amount > 0  → إشعار دائن
  //     (legacy: amount < 0 → إشعار مدين, kept for back-compat)
  //   • receipt_type='debit_note', amount > 0   → إشعار مدين
  //     (the new first-class type from AddDebitNoteDialog)
  // Filtering primarily on receipt_type so the new debit notes land
  // in the right bucket regardless of sign convention.
  const creditNotes = useMemo(
    () =>
      data.clientCreditNotes.filter(
        (r) =>
          !r.cancelled_at &&
          r.receipt_type === 'credit_note' &&
          r.amount > 0 &&
          (!clientId || r.client_id === clientId) &&
          matchesClientReceiptSearch(r, search),
      ),
    [data.clientCreditNotes, search, clientId],
  );
  const debitNotes = useMemo(
    () =>
      data.clientCreditNotes.filter(
        (r) =>
          !r.cancelled_at &&
          (r.receipt_type === 'debit_note' || (r.receipt_type === 'credit_note' && r.amount < 0)) &&
          (!clientId || r.client_id === clientId) &&
          matchesClientReceiptSearch(r, search),
      ),
    [data.clientCreditNotes, search, clientId],
  );

  // ── Summary pills ────────────────────────────────────────────
  // "إجمالي المعاملات" sums the office-billable amount across every
  // package the customer has (active + cancelled, since the kashf
  // shows cancelled rows as notation and zeroes their balance via
  // the matching refund — not by removing the bill).
  const totalBilled = useMemo(
    () =>
      filteredPackages.reduce(
        (s, pkg) =>
          s +
          pkg.sub_policies.reduce(
            (ss, p) =>
              ss +
              policyOfficeAmount({
                insurance_price: p.insurance_price,
                office_commission: p.office_commission,
                policy_type_parent: p.policy_type_parent,
              }),
            0,
          ),
        0,
      ),
    [filteredPackages],
  );
  const totalReceived = useMemo(
    () => payments.reduce((s, r) => s + r.amount, 0),
    [payments],
  );
  const totalDisbursed = useMemo(
    () => disbursements.reduce((s, r) => s + r.amount, 0),
    [disbursements],
  );
  const totalCreditNotes = useMemo(
    () => creditNotes.reduce((s, r) => s + r.amount, 0),
    [creditNotes],
  );
  const totalDebitNotes = useMemo(
    () => debitNotes.reduce((s, r) => s + Math.abs(r.amount), 0),
    [debitNotes],
  );
  const totalOutflow = totalDisbursed + totalCreditNotes;

  return (
    <div className="space-y-4">
      {/* Summary pills — five-card row mirrors the شركات tab layout
          so the customer view reads at a glance: what was billed,
          what came in, what went back out, what's still outstanding. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <PillCard
          icon={FileText}
          tone="slate"
          label="إجمالي المعاملات"
          value={formatMoney(totalBilled)}
          hint={`${filteredPackages.length} معاملة`}
        />
        <PillCard
          icon={ArrowDownLeft}
          tone="emerald"
          label="المقبوض (سند قبض)"
          value={formatMoney(totalReceived)}
          hint={`${payments.length} سند`}
        />
        <PillCard
          icon={ArrowUpRight}
          tone="amber"
          label="الخارج للعملاء"
          value={formatMoney(totalOutflow)}
          hint="سند صرف + إشعار دائن"
        />
        <PillCard
          icon={TrendingUp}
          tone="indigo"
          label="إشعار مدين"
          value={formatMoney(totalDebitNotes)}
          hint={`${debitNotes.length} إشعار — مستحق على العميل`}
        />
        <PillCard
          icon={Wallet}
          tone="sky"
          label="إشعار دائن"
          value={formatMoney(totalCreditNotes)}
          hint={`${creditNotes.length} إشعار — رصيد للعميل عندنا`}
        />
      </div>

      {/* Search + customer picker + filters. The customer picker is
          separate from the AccountingFilters popover so we can keep
          AccountingFilters shape-compatible with companies/brokers
          while still offering the "lock to one customer" UX the user
          asked for ("لما اكبس ع الفلترة بدو يخليني ابحث عن اسم عمل"). */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم العميل، رقم السند، رقم المعاملة..."
            className="pr-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <ClientPicker
            value={selectedClient}
            onChange={setSelectedClient}
          />
          {selectedClient ? (
            <Button
              variant="default"
              size="sm"
              className="gap-2"
              onClick={() => setStatementOpen(true)}
            >
              <FileText className="h-4 w-4" />
              كشف حساب
            </Button>
          ) : null}
          <AccountingFilters
            value={filters}
            onChange={setFilters}
            companyOptions={[]}
            typeOptions={[]}
            paymentMethodOptions={[]}
            show={{ dateRange: true, companies: false, types: false, paymentMethods: false }}
          />
        </div>
      </div>

      {/* Active-filter strip — surfaces the date scope (and any locked
          customer) above the tabs so the user always knows what subset
          they're looking at. The user explicitly asked for this: "وفوق
          لازم يكون مكتوب اشي غير بالفلترة عشان افهم انوا بفلتر ع شهر
          معين". */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary" className="gap-1.5 font-medium">
          <CalendarRange className="h-3.5 w-3.5" />
          {describeRange(filters.dateFrom, filters.dateTo)}
        </Badge>
        {selectedClient ? (
          <Badge variant="secondary" className="gap-1.5 font-medium">
            <UserIcon className="h-3.5 w-3.5" />
            {selectedClient.full_name}
            <button
              type="button"
              onClick={() => setSelectedClient(null)}
              className="ml-1 -mr-0.5 rounded-full hover:bg-foreground/10"
              aria-label="مسح فلتر العميل"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
        <TabsList className="grid w-full grid-cols-4 lg:grid-cols-7">
          {SUB_TABS.map(({ key, label, Icon }) => {
            const count =
              key === 'all'
                ? filteredPackages.length +
                  payments.length +
                  disbursements.length +
                  cancellations.length +
                  debitNotes.length +
                  creditNotes.length
                : key === 'issuances'
                ? filteredPackages.length
                : key === 'payments'
                ? payments.length
                : key === 'disbursements'
                ? disbursements.length
                : key === 'cancellations'
                ? cancellations.length
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

        <TabsContent value="all" className="mt-3 space-y-4">
          {/* Compact stacked view — the user wants ONE screen with
              everything visible, grouped by section. Each block uses
              the same table as its dedicated tab. */}
          <AllTabSection title="الإصدارات" count={filteredPackages.length}>
            <IssuancesTable rows={filteredPackages} loading={data.loading} />
          </AllTabSection>
          <AllTabSection title="سند قبض" count={payments.length}>
            <ReceiptsTable rows={payments} loading={data.loading} kind="payments" />
          </AllTabSection>
          <AllTabSection title="سند صرف" count={disbursements.length}>
            <ReceiptsTable rows={disbursements} loading={data.loading} kind="disbursements" />
          </AllTabSection>
          <AllTabSection title="سند إلغاء" count={cancellations.length}>
            <ReceiptsTable rows={cancellations} loading={data.loading} kind="cancellations" />
          </AllTabSection>
          <AllTabSection title="إشعار مدين" count={debitNotes.length}>
            <ReceiptsTable rows={debitNotes} loading={data.loading} kind="debit_notes" />
          </AllTabSection>
          <AllTabSection title="إشعار دائن" count={creditNotes.length}>
            <ReceiptsTable rows={creditNotes} loading={data.loading} kind="credit_notes" />
          </AllTabSection>
        </TabsContent>

        <TabsContent value="issuances" className="mt-3">
          <IssuancesTable rows={filteredPackages} loading={data.loading} />
        </TabsContent>
        <TabsContent value="payments" className="mt-3">
          <ReceiptsTable rows={payments} loading={data.loading} kind="payments" />
        </TabsContent>
        <TabsContent value="disbursements" className="mt-3">
          <ReceiptsTable rows={disbursements} loading={data.loading} kind="disbursements" />
        </TabsContent>
        <TabsContent value="cancellations" className="mt-3">
          <ReceiptsTable rows={cancellations} loading={data.loading} kind="cancellations" />
        </TabsContent>
        <TabsContent value="debit_notes" className="mt-3">
          <ReceiptsTable rows={debitNotes} loading={data.loading} kind="debit_notes" />
        </TabsContent>
        <TabsContent value="credit_notes" className="mt-3">
          <ReceiptsTable rows={creditNotes} loading={data.loading} kind="credit_notes" />
        </TabsContent>
      </Tabs>

      {selectedClient ? (
        <CustomerStatementModal
          open={statementOpen}
          onOpenChange={setStatementOpen}
          clientId={selectedClient.id}
          clientName={selectedClient.full_name}
          clientPhone={selectedClient.phone_number}
          // The modal derives available years from start_date. We feed
          // it every policy we already loaded for this client — both
          // active and cancelled — so the year picker covers their
          // whole history, not just the rows visible after date filter.
          policies={allPackages
            .filter((pkg) => pkg.client_id === selectedClient.id)
            .flatMap((pkg) =>
              pkg.sub_policies.map((s) => ({ start_date: s.start_date })),
            )}
        />
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ClientPicker — combobox for the customer-name filter
// ──────────────────────────────────────────────────────────────
//
// Mirrors the AddVoucherDialog picker so the customer experience is
// consistent: debounced search across name / phone / id, RLS-scoped
// by agent, max 25 results per query. Returns the full ClientLite
// object so the parent can pass id + name + phone straight into the
// statement modal without an extra round trip.

function ClientPicker({
  value,
  onChange,
}: {
  value: ClientLite | null;
  onChange: (next: ClientLite | null) => void;
}) {
  const { agentId } = useAgentContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClientLite[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced fetch — only fires once typing has paused. A 2-char
  // minimum keeps the dropdown from hammering the table on every
  // first keystroke (and matches how the receipts dialog throttles).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const term = query.trim();
    if (!open || term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      let q = supabase
        .from('clients')
        .select('id, full_name, phone_number, id_number')
        .or(
          `full_name.ilike.%${term}%,phone_number.ilike.%${term}%,id_number.ilike.%${term}%`,
        )
        .limit(25);
      if (agentId) q = q.eq('agent_id', agentId);
      const { data } = await q;
      setResults((data ?? []) as ClientLite[]);
      setLoading(false);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, agentId]);

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
          <UserIcon className="h-4 w-4" />
          <span className="truncate flex-1 text-right">
            {value ? value.full_name : 'اختر عميل...'}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="end" dir="rtl">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ابحث باسم العميل، هاتف، أو رقم هوية..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                جاري البحث...
              </div>
            ) : query.trim().length < 2 ? (
              <CommandEmpty>اكتب حرفين على الأقل للبحث</CommandEmpty>
            ) : results.length === 0 ? (
              <CommandEmpty>لا توجد نتائج</CommandEmpty>
            ) : (
              results.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange(c);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5',
                      value?.id === c.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.full_name}</div>
                    <div className="text-[11px] text-muted-foreground truncate ltr-nums">
                      {c.phone_number ?? '—'}
                      {c.id_number ? ` · ${c.id_number}` : ''}
                    </div>
                  </div>
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
                مسح اختيار العميل
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ──────────────────────────────────────────────────────────────
// Summary pill
// ──────────────────────────────────────────────────────────────

const TONE_CLASSES: Record<string, { bg: string; text: string }> = {
  slate: { bg: 'bg-slate-500/10', text: 'text-slate-700' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-700' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-700' },
  indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-700' },
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-700' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-700' },
};

function PillCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE_CLASSES;
  label: string;
  value: string;
  hint?: string;
}) {
  const cls = TONE_CLASSES[tone];
  return (
    <Card>
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
}

// ──────────────────────────────────────────────────────────────
// "All" tab — section wrapper
// ──────────────────────────────────────────────────────────────

function AllTabSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-sm font-bold">{title}</h3>
        <Badge variant="secondary" className="text-xs">
          {count}
        </Badge>
      </div>
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Issuances table — one row per معاملة (group_id-keyed)
// ──────────────────────────────────────────────────────────────

function IssuancesTable({
  rows,
  loading,
}: {
  rows: IssuanceRow[];
  loading: boolean;
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
        لا توجد معاملات للعملاء في هذا النطاق
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap text-right">رقم المعاملة</TableHead>
            <TableHead className="whitespace-nowrap text-right">التاريخ</TableHead>
            <TableHead className="whitespace-nowrap text-right">العميل</TableHead>
            <TableHead className="whitespace-nowrap text-right">السيارة</TableHead>
            <TableHead className="whitespace-nowrap text-right">الأنواع</TableHead>
            <TableHead className="whitespace-nowrap text-left">المبلغ المستحق</TableHead>
            <TableHead className="whitespace-nowrap text-left">المدفوع</TableHead>
            <TableHead className="whitespace-nowrap text-right">الحالة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((pkg) => {
            const billed = pkg.sub_policies.reduce(
              (s, p) =>
                s +
                policyOfficeAmount({
                  insurance_price: p.insurance_price,
                  office_commission: p.office_commission,
                  policy_type_parent: p.policy_type_parent,
                }),
              0,
            );
            const paid = Number(pkg.receipts_total || 0);
            const isCancelled = !!pkg.main.cancelled;
            // Per the user's package-display rule: ONE row even when
            // the معاملة has multiple sub-policies (ثالث + إلزامي +
            // خدمات الطريق). We show each sub as a chip in the
            // "الأنواع" column so the staff sees what the customer
            // bought without expanding anything.
            return (
              <TableRow
                key={pkg.id}
                className={`text-sm ${isCancelled ? 'opacity-70' : ''}`}
              >
                <TableCell className="font-mono ltr-nums whitespace-nowrap">
                  {pkg.document_number ?? '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap ltr-nums">
                  {formatDate(pkg.main.issue_date ?? pkg.main.start_date)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {pkg.client_name ?? '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono ltr-nums text-xs">
                  {pkg.main.car_number ?? '—'}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {pkg.sub_policies.map((s) => (
                      <Badge
                        key={s.id}
                        variant="outline"
                        className="text-[10px] font-normal"
                      >
                        {POLICY_TYPE_DISPLAY[
                          (s.policy_type_child as string | null) ?? s.policy_type_parent
                        ] ??
                          POLICY_TYPE_DISPLAY[s.policy_type_parent] ??
                          s.policy_type_parent}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-left ltr-nums font-semibold tabular-nums whitespace-nowrap">
                  {formatMoney(billed)}
                </TableCell>
                <TableCell className="text-left ltr-nums tabular-nums whitespace-nowrap">
                  {paid > 0 ? (
                    <span className="text-emerald-700">{formatMoney(paid)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {isCancelled ? (
                    <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-xs">
                      ملغاة
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                      سارية
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Generic receipts table — handles all 5 receipt-flavored tabs
// ──────────────────────────────────────────────────────────────

type ReceiptKind =
  | 'payments'
  | 'disbursements'
  | 'cancellations'
  | 'debit_notes'
  | 'credit_notes';

const RECEIPT_LABELS: Record<ReceiptKind, { number: string; empty: string; amountColor: string }> = {
  payments: {
    number: 'رقم السند',
    empty: 'لا توجد سندات قبض في هذا النطاق',
    amountColor: 'text-emerald-700',
  },
  disbursements: {
    number: 'رقم السند',
    empty: 'لا توجد سندات صرف في هذا النطاق',
    amountColor: 'text-amber-700',
  },
  cancellations: {
    number: 'رقم سند الإلغاء',
    empty: 'لا توجد سندات إلغاء في هذا النطاق',
    amountColor: 'text-rose-700',
  },
  debit_notes: {
    number: 'رقم الإشعار',
    empty: 'لا توجد إشعارات مدين في هذا النطاق',
    amountColor: 'text-indigo-700',
  },
  credit_notes: {
    number: 'رقم الإشعار',
    empty: 'لا توجد إشعارات دائنة في هذا النطاق',
    amountColor: 'text-sky-700',
  },
};

function ReceiptsTable({
  rows,
  loading,
  kind,
}: {
  rows: ClientReceiptRow[];
  loading: boolean;
  kind: ReceiptKind;
}) {
  const labels = RECEIPT_LABELS[kind];
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
        {labels.empty}
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap text-right">{labels.number}</TableHead>
            <TableHead className="whitespace-nowrap text-right">التاريخ</TableHead>
            <TableHead className="whitespace-nowrap text-right">العميل</TableHead>
            <TableHead className="whitespace-nowrap text-right">المعاملة</TableHead>
            <TableHead className="whitespace-nowrap text-right">طريقة الدفع</TableHead>
            <TableHead className="whitespace-nowrap text-left">المبلغ</TableHead>
            <TableHead className="whitespace-nowrap text-right">ملاحظات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="text-sm">
              <TableCell className="font-mono ltr-nums whitespace-nowrap">
                {r.voucher_number ?? '—'}
              </TableCell>
              <TableCell className="whitespace-nowrap ltr-nums">
                {formatDate(r.receipt_date)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {r.client_name ?? '—'}
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono ltr-nums text-xs text-muted-foreground">
                {r.policy_document_number ?? r.policy_number ?? '—'}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {paymentLabel(r.payment_method)}
                </Badge>
              </TableCell>
              <TableCell
                className={`text-left ltr-nums font-semibold tabular-nums whitespace-nowrap ${labels.amountColor}`}
              >
                {formatMoney(r.amount)}
              </TableCell>
              <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                {r.notes ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
