import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Banknote, Building, CreditCard, FileText, Plus, Receipt as ReceiptIcon } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useTableColumnVisibility } from '@/hooks/useTableColumnVisibility';
import { ManageColumnsDropdown, ColumnOption } from './ManageColumnsDropdown';
import { AccountingFilters, AccountingFiltersValue } from './AccountingFilters';
import { PAYMENT_METHOD_LABELS } from './accountingTypes';
import { CustomerChequeSelector, SelectableCheque } from '@/components/shared/CustomerChequeSelector';
import { BankPicker } from '@/components/shared/BankPicker';
import { CompactImagePicker } from '@/components/shared/CompactImagePicker';
import { sanitizeChequeNumber, validateChequeNumber } from '@/lib/chequeUtils';
import { cn } from '@/lib/utils';

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

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'office', label: 'مكتب' },
  { value: 'garage', label: 'كراج' },
  { value: 'utilities', label: 'فواتير ومرافق' },
  { value: 'salary', label: 'رواتب' },
  { value: 'marketing', label: 'تسويق' },
  { value: 'transport', label: 'مواصلات' },
  { value: 'other', label: 'أخرى' },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map(({ value, label }) => [value, label]),
);

// Mirrors the settlement dialog so the same payment vocabulary is
// available everywhere a voucher gets created. Visa is intentionally
// excluded — companies/brokers/expenses are paid through cash, cheque,
// transfer, or by handing over a customer's cheque.
const EXPENSE_PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cash', label: 'نقداً' },
  { value: 'cheque', label: 'شيك جديد' },
  { value: 'customer_cheque', label: 'شيك عميل' },
  { value: 'bank_transfer', label: 'تحويل بنكي' },
];

export function ExpensesSection() {
  const { agentId } = useAgentContext();
  const { profile } = useAuth();

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
  const [saving, setSaving] = useState(false);
  const [chequeDuplicate, setChequeDuplicate] = useState<string | null>(null);
  const initialForm = {
    expense_date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    category: 'office',
    description: '',
    contact_name: '',
    payment_method: 'cash',
    notes: '',
    cheque_number: '',
    bank_code: '',
    branch_code: '',
    bank_reference: '',
    cheque_image_url: '',
    customer_cheques: [] as SelectableCheque[],
  };
  const formId = useMemo(() => crypto.randomUUID(), []);
  const [form, setForm] = useState(initialForm);

  // Cross-surface duplicate detection — same logic as the settlement
  // dialog. Fires whenever cheque_number + bank_code change.
  useEffect(() => {
    if (form.payment_method !== 'cheque' || !form.cheque_number || !form.bank_code) {
      setChequeDuplicate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const found = await findExistingChequeForExpense(form.cheque_number, form.bank_code);
      if (!cancelled) setChequeDuplicate(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [form.payment_method, form.cheque_number, form.bank_code]);

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

  const submit = async () => {
    if (!form.expense_date) {
      toast.error('التاريخ مطلوب');
      return;
    }
    // For customer_cheque the amount auto-derives from selected cheques;
    // for everything else it has to be a positive number.
    const isCustomerCheque = form.payment_method === 'customer_cheque';
    const amount = isCustomerCheque
      ? form.customer_cheques.reduce((s, c) => s + Number(c.amount || 0), 0)
      : parseFloat(form.amount);
    if (!isCustomerCheque && (!form.amount || amount <= 0)) {
      toast.error('المبلغ مطلوب');
      return;
    }
    if (form.payment_method === 'cheque') {
      const v = validateChequeNumber(form.cheque_number);
      if (!v.isValid) {
        toast.error(v.error ?? 'رقم الشيك غير صحيح');
        return;
      }
    }
    if (isCustomerCheque && form.customer_cheques.length === 0) {
      toast.error('اختر شيك عميل واحد على الأقل');
      return;
    }
    setSaving(true);
    try {
      const customerChequeIds = isCustomerCheque ? form.customer_cheques.map((c) => c.id) : [];
      const { data: inserted, error } = await supabase
        .from('expenses')
        .insert({
          amount,
          expense_date: form.expense_date,
          category: form.category,
          description: form.description || null,
          contact_name: form.contact_name || null,
          payment_method: form.payment_method,
          notes: form.notes || null,
          voucher_type: 'payment',
          created_by_admin_id: profile?.id,
          cheque_number: form.payment_method === 'cheque' ? form.cheque_number : null,
          bank_code: form.payment_method === 'cheque' ? form.bank_code || null : null,
          branch_code: form.payment_method === 'cheque' ? form.branch_code || null : null,
          bank_reference: form.payment_method === 'bank_transfer' ? form.bank_reference || null : null,
          customer_cheque_ids: isCustomerCheque ? customerChequeIds : null,
          cheque_image_url: form.payment_method === 'cheque' ? form.cheque_image_url || null : null,
        } as never)
        .select('id')
        .single();
      if (error) throw error;
      // Mark customer cheques as transferred-out so they leave the
      // available pool — same flow as the settlement dialog.
      if (isCustomerCheque && customerChequeIds.length > 0 && inserted) {
        const { error: updateError } = await supabase
          .from('policy_payments')
          .update({
            cheque_status: 'transferred_out',
            transferred_to_type: 'expense',
            transferred_payment_id: (inserted as { id: string }).id,
            transferred_at: new Date().toISOString(),
          })
          .in('id', customerChequeIds);
        if (updateError) throw updateError;
      }
      toast.success('تم إضافة المصروف');
      setDialogOpen(false);
      setForm(initialForm);
      fetchExpenses();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل الحفظ';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const paymentOptions = useMemo(
    () => Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
    [],
  );

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
              <p className="text-xs text-muted-foreground">سند صرف جديد</p>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: visible.length }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visible.length} className="text-center py-12 text-muted-foreground">
                  <ReceiptIcon className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">لا توجد مصاريف</p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إضافة مصروف</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">المبلغ *</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <Label className="text-xs">التاريخ *</Label>
                <Input
                  type="date"
                  value={form.expense_date}
                  onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">الفئة</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">طريقة الدفع</Label>
                <Select
                  value={form.payment_method}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      payment_method: v,
                      // Reset type-specific fields so stale state from
                      // a previous selection doesn't leak into the save.
                      cheque_number: v === 'cheque' ? form.cheque_number : '',
                      bank_code: v === 'cheque' ? form.bank_code : '',
                      branch_code: v === 'cheque' ? form.branch_code : '',
                      bank_reference: v === 'bank_transfer' ? form.bank_reference : '',
                      customer_cheques: v === 'customer_cheque' ? form.customer_cheques : [],
                      amount: v === 'customer_cheque' ? '' : form.amount,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_PAYMENT_METHODS.map(({ value, label }) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Cheque-specific fields — three equal-width columns
                matching the settlement dialog. */}
            {form.payment_method === 'cheque' && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5 min-w-0">
                    <Label className="text-[11px]">البنك</Label>
                    <BankPicker
                      value={form.bank_code}
                      onChange={(c) => setForm({ ...form, bank_code: c ?? '' })}
                    />
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <Label className="text-[11px]">الفرع</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="مثال: 305"
                      value={form.branch_code}
                      onChange={(e) =>
                        setForm({ ...form, branch_code: e.target.value.replace(/\D/g, '') })
                      }
                      className="h-10 tabular-nums font-mono"
                    />
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <Label className="text-[11px]">رقم الشيك</Label>
                    <Input
                      value={form.cheque_number}
                      onChange={(e) =>
                        setForm({ ...form, cheque_number: sanitizeChequeNumber(e.target.value) })
                      }
                      placeholder="12345678"
                      inputMode="numeric"
                      dir="ltr"
                      className={cn(
                        'h-10 tabular-nums',
                        chequeDuplicate && 'border-amber-500 ring-1 ring-amber-200',
                      )}
                    />
                  </div>
                </div>
                {chequeDuplicate && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
                    ⚠ هذا الشيك مسجل مسبقاً في النظام: {chequeDuplicate}
                  </p>
                )}
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <CompactImagePicker
                    value={form.cheque_image_url || null}
                    onChange={(url) => setForm((f) => ({ ...f, cheque_image_url: url ?? '' }))}
                    entityType="expense_cheque"
                    entityId={formId}
                    label="صورة الشيك"
                  />
                  <span>{form.cheque_image_url ? 'صورة الشيك مرفقة' : 'صورة الشيك (اختياري)'}</span>
                </div>
              </div>
            )}

            {form.payment_method === 'bank_transfer' && (
              <div>
                <Label className="text-xs">رقم المرجع البنكي</Label>
                <Input
                  value={form.bank_reference}
                  onChange={(e) => setForm({ ...form, bank_reference: e.target.value })}
                  placeholder="رقم الحوالة"
                  dir="ltr"
                />
              </div>
            )}

            {form.payment_method === 'customer_cheque' && (
              <div className="space-y-1.5">
                <Label className="text-xs">اختر شيكات العميل</Label>
                <CustomerChequeSelector
                  selectedCheques={form.customer_cheques}
                  onSelectionChange={(cheques) => setForm({ ...form, customer_cheques: cheques })}
                />
              </div>
            )}

            <div>
              <Label className="text-xs">الوصف</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="مثلاً: إصلاح طابعة"
              />
            </div>

            <div>
              <Label className="text-xs">الجهة</Label>
              <Input
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                placeholder="اسم الجهة (اختياري)"
              />
            </div>

            <div>
              <Label className="text-xs">ملاحظات</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                placeholder="ملاحظات إضافية"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentBadge({ type }: { type: string }) {
  const Icon =
    type === 'cash' ? Banknote : type === 'cheque' ? FileText : type === 'transfer' ? Building : CreditCard;
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

/**
 * Cross-surface cheque-duplicate lookup keyed on `(cheque_number,
 * bank_code)` — same set of tables the settlement dialog checks.
 * Returns a short Arabic description of the first match or null.
 */
async function findExistingChequeForExpense(
  chequeNumber: string,
  bankCode: string,
): Promise<string | null> {
  if (!chequeNumber || chequeNumber.length < 4 || !bankCode) return null;
  const [{ data: cs }, { data: bs }, { data: ex }, { data: pp }] = await Promise.all([
    supabase
      .from('company_settlements')
      .select('id, settlement_date')
      .eq('cheque_number', chequeNumber)
      .eq('bank_code', bankCode)
      .limit(1),
    supabase
      .from('broker_settlements')
      .select('id, settlement_date')
      .eq('cheque_number', chequeNumber)
      .eq('bank_code', bankCode)
      .limit(1),
    supabase
      .from('expenses')
      .select('id, expense_date')
      .eq('cheque_number', chequeNumber)
      .eq('bank_code', bankCode)
      .limit(1),
    supabase
      .from('policy_payments')
      .select('id, payment_date')
      .eq('cheque_number', chequeNumber)
      .eq('bank_code', bankCode)
      .limit(1),
  ]);
  if (cs && cs.length) return `سند صرف شركة بتاريخ ${cs[0].settlement_date}`;
  if (bs && bs.length) return `سند وسيط بتاريخ ${bs[0].settlement_date}`;
  if (ex && ex.length) return `مصروف بتاريخ ${ex[0].expense_date}`;
  if (pp && pp.length) return `دفعة عميل بتاريخ ${pp[0].payment_date}`;
  return null;
}
