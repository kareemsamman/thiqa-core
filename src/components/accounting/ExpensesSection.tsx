import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Banknote, Building, CreditCard, FileText, Plus, Receipt as ReceiptIcon, Wallet } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { toast } from 'sonner';
import { useTableColumnVisibility } from '@/hooks/useTableColumnVisibility';
import { ManageColumnsDropdown, ColumnOption } from './ManageColumnsDropdown';
import { AccountingFilters, AccountingFiltersValue } from './AccountingFilters';
import { PAYMENT_METHOD_LABELS } from './accountingTypes';
import { AddExpenseDialog } from './AddExpenseDialog';

interface ExpenseRow {
  id: string;
  expense_date: string;
  amount: number;
  category: string;
  description: string | null;
  contact_name: string | null;
  payment_method: string;
  notes: string | null;
}

const COLUMNS: ColumnOption[] = [
  { key: 'date', label: 'التاريخ', required: true },
  { key: 'category', label: 'الفئة', required: true },
  { key: 'description', label: 'الوصف' },
  { key: 'contact', label: 'الجهة' },
  { key: 'payment_method', label: 'طريقة الدفع' },
  { key: 'amount', label: 'المبلغ', required: true },
  { key: 'notes', label: 'ملاحظات' },
];

const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.key !== 'notes').map((c) => c.key);

const CATEGORY_LABEL: Record<string, string> = {
  office: 'مكتب',
  garage: 'كراج',
  utilities: 'فواتير ومرافق',
  salary: 'رواتب',
  marketing: 'تسويق',
  transport: 'مواصلات',
  other: 'أخرى',
};

interface ExpensesSectionProps {
  /** Deep-link target — when matched, the matching row scrolls into
   *  view and gets a brief highlight. */
  focusSettlementId?: string | null;
}

export function ExpensesSection({ focusSettlementId }: ExpensesSectionProps = {}) {
  const { agentId } = useAgentContext();

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AccountingFiltersValue>({
    dateFrom: '',
    dateTo: '',
    companies: [],
    types: [],
    paymentMethods: [],
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  const { visible, toggle, reset } = useTableColumnVisibility(
    'accounting-expenses',
    DEFAULT_VISIBLE,
  );

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('expenses')
      .select('id, expense_date, amount, category, description, contact_name, payment_method, notes')
      .order('expense_date', { ascending: false });
    if (agentId) q = q.eq('agent_id', agentId);
    const { data } = await q;
    // Drop the [مبيعات]-prefixed rows — those belong to the legacy
    // sales tab, not "office expenses".
    const filtered = ((data ?? []) as ExpenseRow[]).filter(
      (e) => !(e.description ?? '').startsWith('[مبيعات]'),
    );
    setRows(filtered);
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  const filtered = useMemo(() => {
    let out = rows;
    if (filters.dateFrom) {
      const f = new Date(filters.dateFrom).getTime();
      out = out.filter((r) => new Date(r.expense_date).getTime() >= f);
    }
    if (filters.dateTo) {
      const t = new Date(filters.dateTo);
      t.setHours(23, 59, 59, 999);
      const tMs = t.getTime();
      out = out.filter((r) => new Date(r.expense_date).getTime() <= tMs);
    }
    if (filters.paymentMethods.length > 0) {
      const set = new Set(filters.paymentMethods);
      out = out.filter((r) => set.has(r.payment_method));
    }
    return out;
  }, [rows, filters]);

  const total = filtered.reduce((s, r) => s + Number(r.amount || 0), 0);

  const showCol = (key: string) => visible.includes(key);

  const paymentOptions = useMemo(
    () => Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
    [],
  );

  const handleDelete = async (row: ExpenseRow) => {
    if (!confirm('حذف هذا المصروف؟')) return;
    // Release any consumed customer cheques, same flow as settlements.
    const { data: full } = await supabase
      .from('expenses')
      .select('customer_cheque_ids')
      .eq('id', row.id)
      .maybeSingle();
    const ids = (full as { customer_cheque_ids?: string[] | null } | null)?.customer_cheque_ids;
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
    const { error } = await supabase.from('expenses').delete().eq('id', row.id);
    if (error) {
      toast.error(`فشل الحذف: ${error.message}`);
      return;
    }
    toast.success('تم حذف المصروف');
    fetchExpenses();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">إجمالي المصاريف</p>
            <p className="text-lg font-bold tabular-nums text-amber-600">
              ₪{total.toLocaleString('en-US')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">عدد القيود</p>
            <p className="text-lg font-bold tabular-nums">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground mb-1">إضافة سريعة</p>
              <p className="text-xs text-muted-foreground">سند صرف / مصروف جديد</p>
            </div>
            <Button onClick={() => setDialogOpen(true)} size="sm" className="gap-1">
              <Plus className="h-4 w-4" />
              إضافة
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-2">
        <ManageColumnsDropdown
          columns={COLUMNS}
          visible={visible}
          onToggle={toggle}
          onReset={reset}
        />
        <AccountingFilters
          value={filters}
          onChange={setFilters}
          companyOptions={[]}
          typeOptions={[]}
          paymentMethodOptions={paymentOptions}
          show={{ dateRange: true, companies: false, types: false, paymentMethods: true }}
        />
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {showCol('date') && <TableHead className="whitespace-nowrap min-w-[120px]">التاريخ</TableHead>}
              {showCol('category') && <TableHead className="whitespace-nowrap min-w-[120px]">الفئة</TableHead>}
              {showCol('description') && <TableHead className="whitespace-nowrap min-w-[200px]">الوصف</TableHead>}
              {showCol('contact') && <TableHead className="whitespace-nowrap min-w-[150px]">الجهة</TableHead>}
              {showCol('payment_method') && <TableHead className="whitespace-nowrap min-w-[120px]">طريقة الدفع</TableHead>}
              {showCol('amount') && <TableHead className="whitespace-nowrap min-w-[120px]">المبلغ</TableHead>}
              {showCol('notes') && <TableHead className="whitespace-nowrap min-w-[180px]">ملاحظات</TableHead>}
              <TableHead className="whitespace-nowrap text-center w-20">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: visible.length + 1 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visible.length + 1} className="text-center py-12 text-muted-foreground">
                  <ReceiptIcon className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">لا توجد مصاريف</p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow
                  key={r.id}
                  ref={(el) => {
                    // Deep-link target: scroll the matched row into view
                    // once + flash a quick highlight so the user can
                    // spot what they were sent to.
                    if (el && focusSettlementId === r.id) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.classList.add('ring-2', 'ring-amber-400');
                      setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 2400);
                    }
                  }}
                >
                  {showCol('date') && (
                    <TableCell className="text-sm whitespace-nowrap">
                      {fmtDate(r.expense_date)}
                    </TableCell>
                  )}
                  {showCol('category') && (
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {CATEGORY_LABEL[r.category] ?? r.category}
                      </Badge>
                    </TableCell>
                  )}
                  {showCol('description') && (
                    <TableCell className="text-sm max-w-[240px] truncate" title={r.description ?? ''}>
                      {r.description || '-'}
                    </TableCell>
                  )}
                  {showCol('contact') && (
                    <TableCell className="text-sm">{r.contact_name || '-'}</TableCell>
                  )}
                  {showCol('payment_method') && (
                    <TableCell>
                      <PaymentBadge type={r.payment_method} />
                    </TableCell>
                  )}
                  {showCol('amount') && (
                    <TableCell className="font-semibold tabular-nums text-amber-700">
                      ₪{Number(r.amount).toLocaleString('en-US')}
                    </TableCell>
                  )}
                  {showCol('notes') && (
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {r.notes || '-'}
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(r)}
                    >
                      حذف
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AddExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => fetchExpenses()}
      />
    </div>
  );
}

function PaymentBadge({ type }: { type: string }) {
  const Icon =
    type === 'cash'
      ? Banknote
      : type === 'cheque'
      ? FileText
      : type === 'bank_transfer' || type === 'transfer'
      ? Building
      : type === 'customer_cheque'
      ? Wallet
      : CreditCard;
  return (
    <Badge variant="outline" className="text-xs gap-1">
      <Icon className="h-3 w-3" />
      {PAYMENT_METHOD_LABELS[type] ?? type}
    </Badge>
  );
}

function fmtDate(d: string) {
  try {
    return format(parseISO(d), 'dd/MM/yyyy');
  } catch {
    return d;
  }
}
