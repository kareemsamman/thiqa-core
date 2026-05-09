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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { Banknote, CreditCard, FileText, Loader2, Plus, Receipt, Scan, Split, Trash2, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { toast } from 'sonner';
import { CustomerChequeSelector, SelectableCheque } from '@/components/shared/CustomerChequeSelector';
import { BankPicker } from '@/components/shared/BankPicker';
import { MultiImagePicker } from '@/components/shared/MultiImagePicker';
import { sanitizeChequeNumber, validateChequeNumber } from '@/lib/chequeUtils';
import { cn } from '@/lib/utils';

export type SettlementMode = 'company' | 'broker';
export type SettlementKind = 'disbursement' | 'receipt';
export type PaymentLineType = 'cash' | 'cheque' | 'customer_cheque' | 'bank_transfer' | 'visa';

export interface SettlementEntity {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SettlementMode;
  kind: SettlementKind;
  defaultEntityId?: string | null;
  entities: SettlementEntity[];
  onSaved: () => void;
}

interface PaymentLine {
  id: string;
  payment_type: PaymentLineType;
  amount: number;
  /** Generic payment date — used by cash + bank_transfer. */
  payment_date: string;
  /** New cheque (cheque type) — registry lookup data. */
  cheque_number?: string;
  bank_code?: string | null;
  branch_code?: string | null;
  /** تاريخ الاستحقاق — when the cheque can be cashed. */
  cheque_due_date?: string;
  /** تاريخ الإصدار — when we wrote the cheque / when money left. */
  cheque_issue_date?: string;
  /** Multi-image attachments — first one is mirrored to cheque_image_url
   *  on save for backwards compat with old viewers. */
  cheque_image_urls?: string[];
  /** Bank transfer reference number. */
  bank_reference?: string;
  /** Customer cheque type — picked from the available pool. */
  selected_cheques?: SelectableCheque[];
}

const PAYMENT_TYPE_LABEL: Record<PaymentLineType, string> = {
  cash: 'نقداً',
  cheque: 'شيك جديد',
  customer_cheque: 'شيك عميل',
  bank_transfer: 'تحويل بنكي',
  visa: 'فيزا',
};

const PAYMENT_TYPE_ICON: Record<PaymentLineType, typeof Banknote> = {
  cash: Banknote,
  cheque: FileText,
  customer_cheque: Wallet,
  bank_transfer: Receipt,
  visa: CreditCard,
};

const today = () => format(new Date(), 'yyyy-MM-dd');

function isSeedEmpty(line: PaymentLine): boolean {
  return line.payment_type === 'cash' && Number(line.amount || 0) === 0;
}

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

const titleFor = (mode: SettlementMode, kind: SettlementKind): string => {
  if (mode === 'company') {
    return kind === 'disbursement' ? 'إضافة سند صرف لشركة' : 'إضافة سند قبض من شركة';
  }
  return kind === 'disbursement' ? 'إضافة سند صرف لوسيط' : 'إضافة سند قبض من وسيط';
};

export function AddSettlementDialog({
  open,
  onOpenChange,
  mode,
  kind,
  defaultEntityId,
  entities,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const { agentId } = useAgentContext();
  const [entityId, setEntityId] = useState<string>(defaultEntityId ?? '');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PaymentLine[]>([makeLine('cash')]);
  const [saving, setSaving] = useState(false);
  // تقسيط — split a single amount into N cheque lines spaced monthly.
  const [splitAmount, setSplitAmount] = useState('');
  const [splitCount, setSplitCount] = useState(2);
  const [splitOpen, setSplitOpen] = useState(false);
  // Lazy-loaded cheque scanner — keeps the dialog bundle small.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [ScannerComp, setScannerComp] = useState<React.ComponentType<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (cheques: ScannedCheque[]) => void;
    title?: string;
  }> | null>(null);

  // Reset whenever the dialog opens or mode/kind changes underneath.
  useEffect(() => {
    if (!open) return;
    setEntityId(defaultEntityId ?? '');
    setNotes('');
    setLines([makeLine('cash')]);
    setSplitAmount('');
    setSplitCount(2);
  }, [open, defaultEntityId, mode, kind]);

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

  // Drop the seeded empty cash line when the user adds a different
  // payment — otherwise the dialog would keep that placeholder row
  // alongside whatever they actually wanted, forcing them to delete it.
  const addLineOfType = (t: PaymentLineType) =>
    setLines((prev) => {
      const stripped =
        prev.length === 1 && isSeedEmpty(prev[0]) ? [] : prev;
      return [...stripped, makeLine(t)];
    });

  // تقسيط — N equal cheque lines spaced monthly. Uses today's date as
  // the issue and the i-th month as the due, mirroring the wallet flow.
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
    setLines((prev) => {
      const stripped = prev.length === 1 && isSeedEmpty(prev[0]) ? [] : prev;
      return [...stripped, ...next];
    });
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
      cheque_image_urls: c.image_url ? [c.image_url] : [],
      branch_code: c.branch_number || null,
    }));
    setLines((prev) => {
      const stripped = prev.length === 1 && isSeedEmpty(prev[0]) ? [] : prev;
      return [...stripped, ...next];
    });
    toast.success(`أُضيفت ${scanned.length} شيكات من الماسح`);
  };

  const handleSave = async () => {
    if (!entityId) {
      toast.error(mode === 'company' ? 'الرجاء اختيار شركة' : 'الرجاء اختيار وسيط');
      return;
    }
    // Silently drop empty placeholder lines — the dialog seeds with an
    // empty cash row, and quick-add buttons stack more empty rows when
    // staff are deciding what to add. A line counts as empty when:
    //   - cash / bank_transfer: amount <= 0
    //   - cheque: no amount AND no cheque_number AND no bank picked
    //   - customer_cheque: no cheques selected
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
    // Validate only the lines we'll actually save.
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
        // Cross-surface dup guard — even if the user dismissed the
        // auto-switch popup, we still refuse to write a cheque whose
        // (number + bank) already exists somewhere else.
        const dup = await findExistingCheque(line.cheque_number ?? '', line.bank_code ?? null);
        if (dup) {
          toast.error(`لا يمكن حفظ شيك مكرر — موجود مسبقاً: ${dup.description}`);
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

        // Settlement_date: we use the issue date for cheques (when money
        // logically left), and payment_date for everything else. The
        // separate due date is persisted alongside in cheque_due_date.
        const settlementDate =
          line.payment_type === 'cheque'
            ? line.cheque_issue_date ?? line.payment_date
            : line.payment_date;

        const shared = {
          total_amount: amount,
          settlement_date: settlementDate,
          status: 'completed' as const,
          notes: notes || null,
          created_by_admin_id: user?.id ?? null,
          agent_id: agentId ?? null,
          payment_type: line.payment_type,
          cheque_number: line.payment_type === 'cheque' ? line.cheque_number ?? null : null,
          bank_code: line.payment_type === 'cheque' ? line.bank_code ?? null : null,
          branch_code: line.payment_type === 'cheque' ? line.branch_code ?? null : null,
          cheque_due_date:
            line.payment_type === 'cheque'
              ? line.cheque_due_date ?? line.cheque_issue_date ?? settlementDate
              : null,
          cheque_issue_date:
            line.payment_type === 'cheque'
              ? line.cheque_issue_date ?? settlementDate
              : null,
          cheque_image_url:
            line.payment_type === 'cheque' ? line.cheque_image_urls?.[0] ?? null : null,
          cheque_image_urls:
            line.payment_type === 'cheque' ? line.cheque_image_urls ?? [] : [],
          bank_reference:
            line.payment_type === 'bank_transfer' ? line.bank_reference ?? null : null,
          customer_cheque_ids: customerChequeIds,
          refused: false,
        };

        let settlementId: string | null = null;
        if (mode === 'company') {
          const { data, error } = await supabase
            .from('company_settlements')
            .insert({
              ...shared,
              company_id: entityId,
              direction: kind === 'disbursement' ? 'outgoing' : 'incoming',
            } as never)
            .select('id')
            .single();
          if (error) throw error;
          settlementId = (data as { id: string }).id;
        } else {
          const { data, error } = await supabase
            .from('broker_settlements')
            .insert({
              ...shared,
              broker_id: entityId,
              direction: kind === 'disbursement' ? 'we_owe' : 'broker_owes',
            } as never)
            .select('id')
            .single();
          if (error) throw error;
          settlementId = (data as { id: string }).id;
        }

        if (isCustomerCheque && customerChequeIds.length > 0 && settlementId) {
          const { error: updateError } = await supabase
            .from('policy_payments')
            .update({
              cheque_status: 'transferred_out',
              transferred_to_type: mode,
              transferred_to_id: entityId,
              transferred_payment_id: settlementId,
              transferred_at: new Date().toISOString(),
            })
            .in('id', customerChequeIds);
          if (updateError) throw updateError;
        }
      }

      toast.success('تم الحفظ');
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
            <DialogTitle>{titleFor(mode, kind)}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Entity picker */}
            <div className="space-y-1.5">
              <Label className="text-xs">{mode === 'company' ? 'الشركة' : 'الوسيط'}</Label>
              <Select value={entityId} onValueChange={setEntityId}>
                <SelectTrigger>
                  <SelectValue placeholder={mode === 'company' ? 'اختر شركة' : 'اختر وسيط'} />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">الوصف / ملاحظات</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="وصف السند..."
              />
            </div>

            {/* Toolbar — type-specific quick adds + split + scanner */}
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-semibold">الدفعات</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <QuickAddButton type="cash" onClick={() => addLineOfType('cash')} />
                  <QuickAddButton type="cheque" onClick={() => addLineOfType('cheque')} />
                  <QuickAddButton type="customer_cheque" onClick={() => addLineOfType('customer_cheque')} />
                  <QuickAddButton type="bank_transfer" onClick={() => addLineOfType('bank_transfer')} />
                  <QuickAddButton type="visa" onClick={() => addLineOfType('visa')} />
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

              {/* Newest-first display so adding lines pushes prior
                  entries down rather than scrolling the user past
                  what they were just typing. The numeric label stays
                  tied to the original index for stable identity. */}
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
              <span className="text-sm font-semibold">إجمالي السند:</span>
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
          title="مسح شيكات للسند"
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

      {/* CASH + BANK_TRANSFER row layout. Source order: payment_type
          select → date → amount. RTL flex puts payment_type first
          (rightmost — physical-right), as the user requested. We keep
          the type select even though the line was created via the
          quick-add button, so a typo can be corrected without removing
          and re-adding. */}
      {(line.payment_type === 'cash' || line.payment_type === 'bank_transfer' || line.payment_type === 'visa') && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[11px]">طريقة الدفع</Label>
            <Select
              value={line.payment_type}
              onValueChange={(v) => onChange({ payment_type: v as PaymentLineType })}
            >
              <SelectTrigger className="h-10">
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
              className="h-10 tabular-nums"
            />
          </div>

          {line.payment_type === 'bank_transfer' && (
            <div className="md:col-span-3 space-y-1.5">
              <Label className="text-[11px]">رقم المرجع البنكي</Label>
              <Input
                value={line.bank_reference ?? ''}
                onChange={(e) => onChange({ bank_reference: e.target.value })}
                placeholder="رقم الحوالة"
                className="h-10"
                dir="ltr"
              />
            </div>
          )}
        </div>
      )}

      {/* CHEQUE — full chequebook entry. */}
      {line.payment_type === 'cheque' && <ChequeLineEditor line={line} onChange={onChange} />}

      {/* CUSTOMER CHEQUE — picker. */}
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
  // Cross-surface duplicate detection — same query the expense form runs.
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  // Once the user dismisses the auto-switch prompt for a given cheque
  // number we shouldn't keep popping it back up. Tracks the
  // "{number}|{bank}" pair the user already saw the dialog for.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  useEffect(() => {
    // Trigger on cheque number alone — bank is a *narrower* filter,
    // not a precondition. Without this, agents who only typed the
    // number (typical when copying off a paper cheque) never saw the
    // dedup popup at all. We still pass bank_code to findExistingCheque
    // so the search narrows when both are present.
    const num = (line.cheque_number ?? '').trim();
    if (num.length < 4) {
      setDuplicate(null);
      setSwitchOpen(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const found = await findExistingCheque(num, line.bank_code ?? null);
      if (cancelled) return;
      setDuplicate(found);
      // Only auto-open the switch dialog when the duplicate is a
      // customer cheque (policy_payments) — duplicates in any other
      // table can't be "switched to", they just have to be a different
      // cheque. Dismissed pairs are remembered to avoid loops.
      const key = `${line.cheque_number}|${line.bank_code}`;
      if (
        found &&
        found.source === 'policy_payments' &&
        dismissedKey !== key
      ) {
        setSwitchOpen(true);
      } else {
        setSwitchOpen(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [line.cheque_number, line.bank_code, dismissedKey]);

  const acceptSwitch = async () => {
    if (!duplicate || duplicate.source !== 'policy_payments') return;
    const cheque = await loadPolicyPaymentAsCheque(duplicate.recordId);
    if (!cheque) {
      toast.error('تعذر تحميل بيانات الشيك');
      return;
    }
    // Convert the line: customer_cheque type, pre-selected with the
    // matched record. Clear the new-cheque fields since they're no
    // longer relevant.
    onChange({
      payment_type: 'customer_cheque',
      selected_cheques: [cheque],
      amount: cheque.amount,
      cheque_number: undefined,
      bank_code: null,
      branch_code: null,
      cheque_image_urls: [],
      cheque_due_date: undefined,
      cheque_issue_date: undefined,
    });
    setSwitchOpen(false);
    setDuplicate(null);
    toast.success('تم تحويل الدفعة إلى شيك عميل واختيار الشيك');
  };

  const declineSwitch = () => {
    setDismissedKey(`${line.cheque_number}|${line.bank_code}`);
    setSwitchOpen(false);
  };

  // Three equal columns shared by both rows (bank/branch/cheque# and
  // amount/due/issue) so every field on the cheque card renders at the
  // same width — fixes the "البنك is bigger than الفرع" feedback. The
  // image picker hangs off the bottom-left in its own compact slot.
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
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5 flex items-center justify-between gap-2 flex-wrap">
          <span>⚠ هذا الشيك مسجل مسبقاً في النظام: {duplicate.description}</span>
          {duplicate.source === 'policy_payments' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => setSwitchOpen(true)}
            >
              تحويل إلى شيك عميل
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={switchOpen} onOpenChange={(v) => (v ? setSwitchOpen(true) : declineSwitch())}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>هذا الشيك موجود مسبقاً</AlertDialogTitle>
            <AlertDialogDescription>
              {duplicate?.description}. هل تريد تحويل هذه الدفعة إلى نوع <strong>شيك عميل</strong>{' '}
              واختيار هذا الشيك مباشرة؟ إذا اخترت <strong>إلغاء</strong> فلن يُسمح بحفظ الشيك بنفس الرقم.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={declineSwitch}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={acceptSwitch}>تحويل واختيار</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Amount + due date + issue date — same 3-column grid as the
          bank row so columns align across both rows. */}
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
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">تاريخ الإصدار</Label>
          <ArabicDatePicker
            value={line.cheque_issue_date ?? ''}
            onChange={(v) => onChange({ cheque_issue_date: v ?? '' })}
          />
        </div>
      </div>

      {/* Multi-image picker — agents asked to attach multiple shots
          per cheque (front, back, copies). The single-image path is
          preserved on save by mirroring images[0] into cheque_image_url. */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <MultiImagePicker
          value={line.cheque_image_urls ?? []}
          onChange={(urls) => onChange({ cheque_image_urls: urls })}
          entityType="settlement_cheque"
          entityId={line.id}
          label="صور الشيك"
        />
        <span>
          {line.cheque_image_urls && line.cheque_image_urls.length > 0
            ? `${line.cheque_image_urls.length} صور مرفقة`
            : 'صور الشيك (اختياري)'}
        </span>
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

type DuplicateSource = 'company_settlements' | 'broker_settlements' | 'expenses' | 'policy_payments';

interface DuplicateMatch {
  description: string;
  source: DuplicateSource;
  recordId: string;
}

/**
 * Cross-surface cheque-duplicate lookup. Returns the source + record id
 * so the caller can offer a "switch to شيك عميل" flow when the match is
 * a customer-cheque (policy_payments). Same scan as ExpensesSection's
 * helper — kept inline so the dialog stays self-contained.
 */
async function findExistingCheque(
  chequeNumber: string,
  bankCode: string | null,
): Promise<DuplicateMatch | null> {
  if (!chequeNumber || chequeNumber.length < 4) return null;
  // When a bank is selected we narrow the search to that bank — same
  // cheque number across two different banks is a legitimate
  // coincidence. When no bank is set we fall back to a number-only
  // match so an in-progress entry still surfaces the duplicate.
  const narrowBank = <T,>(q: T): T =>
    bankCode ? ((q as { eq: (a: string, b: string) => T }).eq('bank_code', bankCode) as T) : q;
  const [{ data: cs }, { data: bs }, { data: ex }, { data: pp }] = await Promise.all([
    narrowBank(
      supabase
        .from('company_settlements')
        .select('id, settlement_date')
        .eq('cheque_number', chequeNumber)
        .limit(1),
    ),
    narrowBank(
      supabase
        .from('broker_settlements')
        .select('id, settlement_date')
        .eq('cheque_number', chequeNumber)
        .limit(1),
    ),
    narrowBank(
      supabase
        .from('expenses')
        .select('id, expense_date')
        .eq('cheque_number', chequeNumber)
        .limit(1),
    ),
    narrowBank(
      supabase
        .from('policy_payments')
        .select('id, payment_date')
        .eq('cheque_number', chequeNumber)
        .limit(1),
    ),
  ]);
  if (cs && cs.length) {
    const row = cs[0] as { id: string; settlement_date: string };
    return { source: 'company_settlements', recordId: row.id, description: `سند صرف شركة بتاريخ ${row.settlement_date}` };
  }
  if (bs && bs.length) {
    const row = bs[0] as { id: string; settlement_date: string };
    return { source: 'broker_settlements', recordId: row.id, description: `سند وسيط بتاريخ ${row.settlement_date}` };
  }
  if (ex && ex.length) {
    const row = ex[0] as { id: string; expense_date: string };
    return { source: 'expenses', recordId: row.id, description: `مصروف بتاريخ ${row.expense_date}` };
  }
  if (pp && pp.length) {
    const row = pp[0] as { id: string; payment_date: string };
    return { source: 'policy_payments', recordId: row.id, description: `دفعة عميل بتاريخ ${row.payment_date}` };
  }
  return null;
}

/**
 * Loads the policy_payment row + joined client/car info needed to build
 * a SelectableCheque, so the auto-switch flow can pre-select the matched
 * customer cheque without making the user pick it from the list.
 */
async function loadPolicyPaymentAsCheque(paymentId: string): Promise<SelectableCheque | null> {
  const { data, error } = await supabase
    .from('policy_payments')
    .select(
      'id, amount, payment_date, cheque_number, cheque_image_url, policy_id, bank_code, branch_code, transferred_to_type, refused, cheque_status, policies(clients(full_name, phone_number), cars(car_number))',
    )
    .eq('id', paymentId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    id: string;
    amount: number | null;
    payment_date: string;
    cheque_number: string | null;
    cheque_image_url: string | null;
    policy_id: string;
    bank_code: string | null;
    branch_code: string | null;
    transferred_to_type: string | null;
    refused: boolean | null;
    cheque_status: string | null;
    policies: {
      clients: { full_name: string; phone_number: string | null } | null;
      cars: { car_number: string | null } | null;
    } | null;
  };
  // Refuse to surface cheques already consumed elsewhere, refused, or
  // explicitly past pending — those would just confuse the auto-switch.
  if (row.transferred_to_type) return null;
  if (row.refused) return null;
  if (row.cheque_status && row.cheque_status !== 'pending') return null;
  return {
    id: row.id,
    amount: Number(row.amount ?? 0),
    payment_date: row.payment_date,
    cheque_number: row.cheque_number,
    cheque_image_url: row.cheque_image_url,
    policy_id: row.policy_id,
    bank_code: row.bank_code,
    branch_code: row.branch_code,
    client_name: row.policies?.clients?.full_name ?? '',
    client_phone: row.policies?.clients?.phone_number ?? null,
    car_number: row.policies?.cars?.car_number ?? null,
  };
}
