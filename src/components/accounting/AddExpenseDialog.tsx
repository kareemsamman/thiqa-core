import { useEffect, useMemo, useState } from 'react';
import { addMonths, format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { Banknote, FileText, Loader2, Plus, Receipt, Scan, Split, Trash2, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { toast } from 'sonner';
import { CustomerChequeSelector, SelectableCheque } from '@/components/shared/CustomerChequeSelector';
import { BankPicker } from '@/components/shared/BankPicker';
import { CompactImagePicker } from '@/components/shared/CompactImagePicker';
import { sanitizeChequeNumber, validateChequeNumber } from '@/lib/chequeUtils';
import { cn } from '@/lib/utils';

export type PaymentLineType = 'cash' | 'cheque' | 'customer_cheque' | 'bank_transfer';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

interface PaymentLine {
  id: string;
  payment_type: PaymentLineType;
  amount: number;
  payment_date: string;
  cheque_number?: string;
  bank_code?: string | null;
  branch_code?: string | null;
  cheque_due_date?: string;
  cheque_issue_date?: string;
  cheque_image_url?: string;
  bank_reference?: string;
  selected_cheques?: SelectableCheque[];
}

const PAYMENT_TYPE_LABEL: Record<PaymentLineType, string> = {
  cash: 'نقداً',
  cheque: 'شيك جديد',
  customer_cheque: 'شيك عميل',
  bank_transfer: 'تحويل بنكي',
};

const PAYMENT_TYPE_ICON: Record<PaymentLineType, typeof Banknote> = {
  cash: Banknote,
  cheque: FileText,
  customer_cheque: Wallet,
  bank_transfer: Receipt,
};

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'office', label: 'مكتب' },
  { value: 'garage', label: 'كراج' },
  { value: 'utilities', label: 'فواتير ومرافق' },
  { value: 'salary', label: 'رواتب' },
  { value: 'marketing', label: 'تسويق' },
  { value: 'transport', label: 'مواصلات' },
  { value: 'other', label: 'أخرى' },
];

const today = () => format(new Date(), 'yyyy-MM-dd');

function makeLine(type: PaymentLineType): PaymentLine {
  const base: PaymentLine = {
    id: crypto.randomUUID(),
    payment_type: type,
    amount: 0,
    payment_date: today(),
  };
  if (type === 'cheque') {
    base.cheque_due_date = today();
    base.cheque_issue_date = today();
    base.bank_code = null;
    base.branch_code = null;
  }
  return base;
}

/**
 * Multi-line expense voucher. Mirrors AddSettlementDialog's payments
 * UX exactly — same quick-add buttons, تقسيط, مسح شيكات, cheque
 * editor — but the "what" (description / category / contact) lives at
 * the top of the dialog instead of a company/broker picker. Each
 * effective payment line becomes its own row in the `expenses` table,
 * sharing the description/category/contact_name across them so a
 * "rent paid via 3000 cash + 2000 cheque" breakdown stays grouped in
 * the table by description.
 */
export function AddExpenseDialog({ open, onOpenChange, onSaved }: Props) {
  const { user } = useAuth();
  const { agentId } = useAgentContext();
  const [category, setCategory] = useState('office');
  const [description, setDescription] = useState('');
  const [contactName, setContactName] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PaymentLine[]>([makeLine('cash')]);
  const [saving, setSaving] = useState(false);
  const [splitAmount, setSplitAmount] = useState('');
  const [splitCount, setSplitCount] = useState(2);
  const [splitOpen, setSplitOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [ScannerComp, setScannerComp] = useState<React.ComponentType<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (cheques: ScannedCheque[]) => void;
    title?: string;
  }> | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategory('office');
    setDescription('');
    setContactName('');
    setNotes('');
    setLines([makeLine('cash')]);
    setSplitAmount('');
    setSplitCount(2);
  }, [open]);

  const total = useMemo(
    () =>
      lines.reduce((s, l) => {
        if (l.payment_type === 'customer_cheque' && l.selected_cheques) {
          return s + l.selected_cheques.reduce((a, c) => a + Number(c.amount || 0), 0);
        }
        return s + Number(l.amount || 0);
      }, 0),
    [lines],
  );

  const updateLine = (id: string, patch: Partial<PaymentLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLine = (id: string) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.id !== id)));

  const addLineOfType = (t: PaymentLineType) => setLines((prev) => [...prev, makeLine(t)]);

  const handleSplit = () => {
    const amount = parseFloat(splitAmount);
    const count = Math.max(2, Math.min(24, Math.floor(splitCount)));
    if (!amount || amount <= 0) {
      toast.error('أدخل مبلغ التقسيط');
      return;
    }
    const per = Math.round((amount / count) * 100) / 100;
    const issued = today();
    const next = Array.from({ length: count }).map((_, i) => {
      const due = format(addMonths(new Date(), i + 1), 'yyyy-MM-dd');
      return {
        ...makeLine('cheque'),
        amount: per,
        cheque_issue_date: issued,
        cheque_due_date: due,
      };
    });
    setLines((prev) => [...prev, ...next]);
    setSplitAmount('');
    setSplitCount(2);
    setSplitOpen(false);
    toast.success(`أُضيفت ${count} دفعات شيكات`);
  };

  const openScanner = async () => {
    if (!ScannerComp) {
      const mod = await import('@/components/payments/ChequeScannerDialog');
      setScannerComp(() => mod.ChequeScannerDialog);
    }
    setScannerOpen(true);
  };

  const handleScannedCheques = (scanned: ScannedCheque[]) => {
    if (!scanned.length) return;
    const issued = today();
    const next = scanned.map((c) => ({
      ...makeLine('cheque'),
      amount: Number(c.amount || 0),
      cheque_number: c.cheque_number ? sanitizeChequeNumber(c.cheque_number) : undefined,
      cheque_due_date: c.payment_date || today(),
      cheque_issue_date: issued,
      cheque_image_url: c.image_url || undefined,
      branch_code: c.branch_number || null,
    }));
    setLines((prev) => [...prev, ...next]);
    toast.success(`أُضيفت ${scanned.length} شيكات من الماسح`);
  };

  const handleSave = async () => {
    // Same empty-line drop pattern as AddSettlementDialog.
    const effective = lines.filter((line) => {
      if (line.payment_type === 'customer_cheque') {
        return (line.selected_cheques?.length ?? 0) > 0;
      }
      if (line.payment_type === 'cheque') {
        return (
          (line.amount ?? 0) > 0 ||
          !!(line.cheque_number && line.cheque_number.length > 0) ||
          !!line.bank_code
        );
      }
      return Number(line.amount || 0) > 0;
    });
    if (effective.length === 0) {
      toast.error('أضف دفعة واحدة على الأقل');
      return;
    }
    for (const line of effective) {
      if (line.payment_type === 'cheque') {
        const v = validateChequeNumber(line.cheque_number ?? '');
        if (!v.isValid) {
          toast.error(v.error ?? 'رقم الشيك غير صحيح');
          return;
        }
        if (!line.bank_code) {
          toast.error('اختر البنك للشيك');
          return;
        }
        if (!(line.amount > 0)) {
          toast.error('أدخل مبلغ الشيك');
          return;
        }
      }
      if (line.payment_type !== 'customer_cheque' && !(line.amount > 0)) {
        toast.error('المبلغ يجب أن يكون أكبر من صفر');
        return;
      }
    }

    setSaving(true);
    try {
      for (const line of effective) {
        const isCustomerCheque = line.payment_type === 'customer_cheque';
        const customerChequeIds: string[] = isCustomerCheque
          ? (line.selected_cheques ?? []).map((c) => c.id)
          : [];
        const amount = isCustomerCheque
          ? (line.selected_cheques ?? []).reduce((s, c) => s + Number(c.amount || 0), 0)
          : Number(line.amount || 0);
        const expenseDate =
          line.payment_type === 'cheque'
            ? line.cheque_issue_date ?? line.payment_date
            : line.payment_date;

        const { data: inserted, error } = await supabase
          .from('expenses')
          .insert({
            amount,
            expense_date: expenseDate,
            category,
            description: description || null,
            contact_name: contactName || null,
            payment_method: line.payment_type,
            notes: notes || null,
            voucher_type: 'payment',
            created_by_admin_id: user?.id ?? null,
            agent_id: agentId ?? null,
            cheque_number: line.payment_type === 'cheque' ? line.cheque_number ?? null : null,
            bank_code: line.payment_type === 'cheque' ? line.bank_code ?? null : null,
            branch_code: line.payment_type === 'cheque' ? line.branch_code ?? null : null,
            cheque_image_url:
              line.payment_type === 'cheque' ? line.cheque_image_url ?? null : null,
            bank_reference:
              line.payment_type === 'bank_transfer' ? line.bank_reference ?? null : null,
            customer_cheque_ids: isCustomerCheque ? customerChequeIds : null,
          } as never)
          .select('id')
          .single();
        if (error) throw error;

        if (isCustomerCheque && customerChequeIds.length > 0 && inserted) {
          const expenseId = (inserted as { id: string }).id;
          const { error: updateError } = await supabase
            .from('policy_payments')
            .update({
              cheque_status: 'transferred_out',
              transferred_to_type: 'expense',
              transferred_payment_id: expenseId,
              transferred_at: new Date().toISOString(),
            })
            .in('id', customerChequeIds);
          if (updateError) throw updateError;
        }
      }
      toast.success('تم حفظ المصروف');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل الحفظ';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
        <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>إضافة مصروف</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* "What" — category + contact + description. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">الفئة</Label>
                <Select value={category} onValueChange={setCategory}>
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
              <div className="space-y-1.5">
                <Label className="text-xs">الجهة (اختياري)</Label>
                <Input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="اسم الجهة"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">الوصف</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="مثلاً: إيجار المكتب"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">ملاحظات</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات إضافية..."
              />
            </div>

            {/* Toolbar — same quick-adds as the settlement dialog. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-semibold">الدفعات</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <QuickAddButton type="cash" onClick={() => addLineOfType('cash')} />
                  <QuickAddButton type="cheque" onClick={() => addLineOfType('cheque')} />
                  <QuickAddButton
                    type="customer_cheque"
                    onClick={() => addLineOfType('customer_cheque')}
                  />
                  <QuickAddButton type="bank_transfer" onClick={() => addLineOfType('bank_transfer')} />
                  <Popover open={splitOpen} onOpenChange={setSplitOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="gap-1.5">
                        <Split className="h-3.5 w-3.5" />
                        تقسيط
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent dir="rtl" className="w-72 space-y-3" align="end">
                      <div className="space-y-1.5">
                        <Label className="text-xs">المبلغ الإجمالي</Label>
                        <Input
                          type="number"
                          value={splitAmount}
                          onChange={(e) => setSplitAmount(e.target.value)}
                          placeholder="0"
                          dir="ltr"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">عدد الدفعات</Label>
                        <Input
                          type="number"
                          min={2}
                          max={24}
                          value={splitCount}
                          onChange={(e) => setSplitCount(parseInt(e.target.value) || 2)}
                          dir="ltr"
                        />
                      </div>
                      <Button onClick={handleSplit} className="w-full" size="sm">
                        إنشاء {Math.max(2, Math.min(24, Math.floor(splitCount)))} شيكات
                      </Button>
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openScanner}
                    className="gap-1.5"
                  >
                    <Scan className="h-3.5 w-3.5" />
                    مسح شيكات
                  </Button>
                </div>
              </div>

              {lines
                .map((line, idx) => ({ line, idx }))
                .reverse()
                .map(({ line, idx }) => (
                  <PaymentLineCard
                    key={line.id}
                    index={idx}
                    line={line}
                    onChange={(patch) => updateLine(line.id, patch)}
                    onRemove={lines.length > 1 ? () => removeLine(line.id) : undefined}
                  />
                ))}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-2.5">
              <span className="text-sm font-semibold">إجمالي المصروف:</span>
              <span className="text-lg font-bold tabular-nums">
                ₪{total.toLocaleString('en-US')}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {`حفظ (${lines.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ScannerComp && (
        <ScannerComp
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          onConfirm={(scanned) => {
            handleScannedCheques(scanned);
            setScannerOpen(false);
          }}
          title="مسح شيكات للمصروف"
        />
      )}
    </>
  );
}

function QuickAddButton({
  type,
  onClick,
}: {
  type: PaymentLineType;
  onClick: () => void;
}) {
  const Icon = PAYMENT_TYPE_ICON[type];
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className="gap-1.5">
      <Plus className="h-3.5 w-3.5" />
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{PAYMENT_TYPE_LABEL[type]}</span>
    </Button>
  );
}

function PaymentLineCard({
  index,
  line,
  onChange,
  onRemove,
}: {
  index: number;
  line: PaymentLine;
  onChange: (patch: Partial<PaymentLine>) => void;
  onRemove?: () => void;
}) {
  const Icon = PAYMENT_TYPE_ICON[line.payment_type];
  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground">
            دفعة {index + 1} · {PAYMENT_TYPE_LABEL[line.payment_type]}
          </span>
        </div>
        {onRemove && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </div>

      {(line.payment_type === 'cash' || line.payment_type === 'bank_transfer') && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[11px]">طريقة الدفع</Label>
            <Select
              value={line.payment_type}
              onValueChange={(v) => onChange({ payment_type: v as PaymentLineType })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PAYMENT_TYPE_LABEL) as PaymentLineType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {PAYMENT_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px]">التاريخ</Label>
            <ArabicDatePicker
              value={line.payment_date}
              onChange={(v) => onChange({ payment_date: v ?? '' })}
              compact
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px]">المبلغ</Label>
            <Input
              type="number"
              value={line.amount || ''}
              onChange={(e) => onChange({ amount: parseFloat(e.target.value) || 0 })}
              placeholder="0"
              dir="ltr"
              className="h-9 tabular-nums"
            />
          </div>
          {line.payment_type === 'bank_transfer' && (
            <div className="md:col-span-3 space-y-1.5">
              <Label className="text-[11px]">رقم المرجع البنكي</Label>
              <Input
                value={line.bank_reference ?? ''}
                onChange={(e) => onChange({ bank_reference: e.target.value })}
                placeholder="رقم الحوالة"
                className="h-9"
                dir="ltr"
              />
            </div>
          )}
        </div>
      )}

      {line.payment_type === 'cheque' && <ChequeLineEditor line={line} onChange={onChange} />}

      {line.payment_type === 'customer_cheque' && (
        <div className="space-y-2 border-t pt-3">
          <Label className="text-xs">اختر شيكات العميل</Label>
          <CustomerChequeSelector
            selectedCheques={line.selected_cheques ?? []}
            onSelectionChange={(cheques) => {
              const sum = cheques.reduce((s, c) => s + Number(c.amount || 0), 0);
              onChange({ selected_cheques: cheques, amount: sum });
            }}
          />
        </div>
      )}
    </Card>
  );
}

function ChequeLineEditor({
  line,
  onChange,
}: {
  line: PaymentLine;
  onChange: (patch: Partial<PaymentLine>) => void;
}) {
  const [duplicate, setDuplicate] = useState<string | null>(null);
  useEffect(() => {
    if (!line.cheque_number || !line.bank_code) {
      setDuplicate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const found = await findExistingCheque(line.cheque_number ?? '', line.bank_code ?? null);
      if (!cancelled) setDuplicate(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [line.cheque_number, line.bank_code]);

  const gridCls = 'grid grid-cols-1 md:grid-cols-3 gap-3';

  return (
    <div className="space-y-3 border-t pt-3">
      <div className={gridCls}>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">البنك</Label>
          <BankPicker
            value={line.bank_code}
            onChange={(c) => onChange({ bank_code: c })}
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">الفرع</Label>
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            className="h-10 tabular-nums font-mono"
            placeholder="مثال: 305"
            value={line.branch_code ?? ''}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '');
              onChange({ branch_code: v || null });
            }}
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">رقم الشيك</Label>
          <Input
            value={line.cheque_number ?? ''}
            onChange={(e) => onChange({ cheque_number: sanitizeChequeNumber(e.target.value) })}
            placeholder="12345678"
            inputMode="numeric"
            dir="ltr"
            className={cn(
              'h-10 tabular-nums',
              duplicate && 'border-amber-500 ring-1 ring-amber-200',
            )}
          />
        </div>
      </div>

      {duplicate && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
          ⚠ هذا الشيك مسجل مسبقاً في النظام: {duplicate}
        </p>
      )}

      <div className={gridCls}>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">المبلغ</Label>
          <Input
            type="number"
            value={line.amount || ''}
            onChange={(e) => onChange({ amount: parseFloat(e.target.value) || 0 })}
            placeholder="0"
            dir="ltr"
            className="h-10 tabular-nums"
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">تاريخ الاستحقاق</Label>
          <ArabicDatePicker
            value={line.cheque_due_date ?? ''}
            onChange={(v) => onChange({ cheque_due_date: v ?? '' })}
            compact
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">تاريخ الإصدار</Label>
          <ArabicDatePicker
            value={line.cheque_issue_date ?? ''}
            onChange={(v) => onChange({ cheque_issue_date: v ?? '' })}
            compact
          />
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <CompactImagePicker
          value={line.cheque_image_url}
          onChange={(url) => onChange({ cheque_image_url: url ?? undefined })}
          entityType="expense_cheque"
          entityId={line.id}
          label="صورة الشيك"
        />
        <span>{line.cheque_image_url ? 'صورة الشيك مرفقة' : 'صورة الشيك (اختياري)'}</span>
      </div>
    </div>
  );
}

interface ScannedCheque {
  cheque_number?: string;
  payment_date?: string;
  amount?: number;
  branch_number?: string;
  image_url?: string;
}

async function findExistingCheque(
  chequeNumber: string,
  bankCode: string | null,
): Promise<string | null> {
  if (!chequeNumber || chequeNumber.length < 4) return null;
  const matchBank = <T,>(p: PromiseLike<T>) => p;
  const eqBank = (q: ReturnType<typeof supabase.from>) =>
    bankCode ? q.eq('bank_code', bankCode) : q.is('bank_code', null);
  const [{ data: cs }, { data: bs }, { data: ex }, { data: pp }] = await Promise.all([
    matchBank(
      eqBank(
        supabase
          .from('company_settlements')
          .select('id, settlement_date')
          .eq('cheque_number', chequeNumber)
          .limit(1),
      ),
    ),
    matchBank(
      eqBank(
        supabase
          .from('broker_settlements')
          .select('id, settlement_date')
          .eq('cheque_number', chequeNumber)
          .limit(1),
      ),
    ),
    matchBank(
      eqBank(
        supabase
          .from('expenses')
          .select('id, expense_date')
          .eq('cheque_number', chequeNumber)
          .limit(1),
      ),
    ),
    matchBank(
      eqBank(
        supabase
          .from('policy_payments')
          .select('id, payment_date')
          .eq('cheque_number', chequeNumber)
          .limit(1),
      ),
    ),
  ]);
  if (cs && cs.length) return `سند صرف شركة بتاريخ ${cs[0].settlement_date}`;
  if (bs && bs.length) return `سند وسيط بتاريخ ${bs[0].settlement_date}`;
  if (ex && ex.length) return `مصروف بتاريخ ${ex[0].expense_date}`;
  if (pp && pp.length) return `دفعة عميل بتاريخ ${pp[0].payment_date}`;
  return null;
}
