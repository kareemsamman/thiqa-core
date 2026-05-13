import { useMemo, useState } from 'react';
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
import { ArrowUpRight, Search, Wallet } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { AccountingFilters, AccountingFiltersValue } from './AccountingFilters';
import { PAYMENT_METHOD_LABELS } from './accountingTypes';
import {
  matchesClientReceiptSearch,
  useAccountingData,
  type ClientReceiptRow,
} from './useAccountingData';

interface ClientsSectionProps {
  /** Page-level branch filter (global admins only). null = no extra
   *  filter — caller's natural RLS scope still applies. */
  branchId?: string | null;
}

type SubTab = 'disbursement' | 'credit_note';

// Map our four "outflow" payment methods to the same display labels
// other accounting tables use. Receipt-table rows that aggregated
// multi-method disbursements come back with payment_method='multiple'.
const paymentLabel = (m: string | null): string => {
  if (!m) return '—';
  if (m === 'multiple') return 'متعدد';
  if (m === 'transfer') return 'تحويل';
  return PAYMENT_METHOD_LABELS[m]?.label ?? m;
};

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'dd/MM/yyyy');
  } catch {
    return iso;
  }
};

export function ClientsSection({ branchId }: ClientsSectionProps = {}) {
  const [tab, setTab] = useState<SubTab>('disbursement');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<AccountingFiltersValue>({
    dateFrom: '',
    dateTo: '',
    companies: [],
    types: [],
    paymentMethods: [],
  });

  const data = useAccountingData(filters, branchId);

  const disbursements = useMemo(
    () =>
      data.clientDisbursements.filter(
        (r) => !r.cancelled_at && matchesClientReceiptSearch(r, search),
      ),
    [data.clientDisbursements, search],
  );
  const creditNotes = useMemo(
    () =>
      data.clientCreditNotes.filter(
        (r) => !r.cancelled_at && matchesClientReceiptSearch(r, search),
      ),
    [data.clientCreditNotes, search],
  );

  const disbursementsTotal = useMemo(
    () => disbursements.reduce((s, r) => s + Number(r.amount || 0), 0),
    [disbursements],
  );
  const creditNotesTotal = useMemo(
    () => creditNotes.reduce((s, r) => s + Number(r.amount || 0), 0),
    [creditNotes],
  );
  const outflowTotal = disbursementsTotal + creditNotesTotal;

  const activeRows = tab === 'disbursement' ? disbursements : creditNotes;

  return (
    <div className="space-y-4">
      {/* Summary pills — disbursements (cash out) + credit notes
          (wallet credit, not cash but still an obligation). The
          third pill is the combined outflow so staff can see the
          one number that matters for net agency cash position. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
              <ArrowUpRight className="h-4 w-4 text-amber-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate">
                إجمالي سند الصرف
              </p>
              <p className="text-lg font-bold tabular-nums text-amber-700 whitespace-nowrap">
                ₪{disbursementsTotal.toLocaleString('en-US')}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {disbursements.length} سند — كاش طالع فعلياً
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
              <Wallet className="h-4 w-4 text-sky-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate">
                إجمالي إشعار دائن
              </p>
              <p className="text-lg font-bold tabular-nums text-sky-700 whitespace-nowrap">
                ₪{creditNotesTotal.toLocaleString('en-US')}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {creditNotes.length} إشعار — رصيد للعميل عندنا
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-destructive/30">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <ArrowUpRight className="h-4 w-4 text-destructive" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate">
                الإجمالي الخارج للعملاء
              </p>
              <p className="text-lg font-bold tabular-nums text-destructive whitespace-nowrap">
                ₪{outflowTotal.toLocaleString('en-US')}
              </p>
              <p className="text-[10px] text-muted-foreground">
                ما عاد عند المكتب أو موعود فيه
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search + filters */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم العميل، رقم السند، الشيك..."
            className="pr-9"
          />
        </div>
        <AccountingFilters
          value={filters}
          onChange={setFilters}
          companyOptions={[]}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="disbursement" className="gap-2">
            <ArrowUpRight className="h-3.5 w-3.5" />
            سند الصرف ({disbursements.length})
          </TabsTrigger>
          <TabsTrigger value="credit_note" className="gap-2">
            <Wallet className="h-3.5 w-3.5" />
            إشعار دائن ({creditNotes.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-3">
          <ReceiptsTable rows={activeRows} loading={data.loading} kind={tab} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReceiptsTable({
  rows,
  loading,
  kind,
}: {
  rows: ClientReceiptRow[];
  loading: boolean;
  kind: SubTab;
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
          ? 'لا توجد سندات صرف للعملاء في هذا النطاق'
          : 'لا توجد إشعارات دائنة للعملاء في هذا النطاق'}
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap text-right">
              {kind === 'disbursement' ? 'رقم السند' : 'رقم الإشعار'}
            </TableHead>
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
              <TableCell className="text-left ltr-nums font-semibold tabular-nums">
                ₪{r.amount.toLocaleString('en-US')}
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
