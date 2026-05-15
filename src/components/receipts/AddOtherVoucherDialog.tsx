// ─── AddOtherVoucherDialog ─────────────────────────────────────
//
// Single dialog that handles ALL FOUR voucher kinds for the "آخر"
// counterparty (external party — utility, lawyer, garage, salary,
// etc.). No entity picker — the agent types a free-form recipient
// name and picks a category from a fixed list (with "أخرى" + free
// text fallback for custom categories).
//
// Layout mirrors DebtPaymentModal's payment-line editor: a single
// "إضافة دفعة" button + per-line cards with grid-cols-3 (المبلغ /
// طريقة الدفع / التاريخ) and a cheque sub-row (البنك / الفرع /
// رقم الشيك / تاريخ الاستحقاق) when the line type is cheque. Per-
// line notes textarea. مجموع الدفعات tally at the bottom.
//
// Schema-wise the dialog still writes ONE row to `receipts`:
//   • 1 line   → payment_method = that line's type, single row.
//   • N lines  → payment_method = 'multiple', total amount, the
//                breakdown gets prepended into notes.
// (No new table needed; matches the company-settlements pattern.)

import { useEffect, useMemo, useState } from 'react';
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
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import {
  Banknote,
  Copy,
  CreditCard,
  FileText,
  Loader2,
  Plus,
  Receipt,
  Trash2,
  Wallet,
  WalletMinimal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { BankPicker } from '@/components/shared/BankPicker';
import type { VoucherKind } from './AddVoucherDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: VoucherKind;
  onSaved: (info: { receiptId: string; voucherNumber: string | null }) => void;
}

// Per-kind cosmetic config. Keeps the dialog title, hero tone, and
// success message in sync with the choice the user made on the
// previous AddVoucherDialog step.
const KIND_CONFIG: Record<
  VoucherKind,
  {
    title: string;
    icon: typeof Receipt;
    iconColor: string;
    heroTone: string;
    helper: string;
    allocatorRpc: string;
    successPrefix: string;
  }
> = {
  payment: {
    title: 'إضافة سند قبض — جهة خارجية',
    icon: Receipt,
    iconColor: 'text-emerald-600',
    heroTone: 'border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20',
    helper: 'مبلغ استلمه المكتب من جهة خارجية (مثلاً: استرداد، تعويض، دفعة).',
    allocatorRpc: 'allocate_payment_number',
    successPrefix: 'تم إصدار سند قبض',
  },
  disbursement: {
    title: 'إضافة سند صرف — جهة خارجية',
    icon: Banknote,
    iconColor: 'text-rose-600',
    heroTone: 'border-rose-200 bg-rose-50/60 dark:bg-rose-950/20',
    helper:
      'مبلغ دفعه المكتب لجهة خارجية (كهرباء، ماء، راتب، أتعاب محامي، صيانة، رسوم رسمية…).',
    allocatorRpc: 'allocate_disbursement_number',
    successPrefix: 'تم إصدار سند صرف',
  },
  credit_note: {
    title: 'إضافة إشعار دائن — جهة خارجية',
    icon: Wallet,
    iconColor: 'text-amber-600',
    heroTone: 'border-amber-200 bg-amber-50/60 dark:bg-amber-950/20',
    helper:
      'تسجيل رصيد للجهة الخارجية لدى المكتب بدون كاش — مثل فاتورة محامي مستحقة لم تُدفع بعد.',
    allocatorRpc: 'allocate_credit_note_number',
    successPrefix: 'تم إصدار إشعار دائن',
  },
  debit_note: {
    title: 'إضافة إشعار مدين — جهة خارجية',
    icon: WalletMinimal,
    iconColor: 'text-rose-600',
    heroTone: 'border-rose-200 bg-rose-50/60 dark:bg-rose-950/20',
    helper:
      'تسجيل مبلغ مستحق لنا على الجهة الخارجية بدون كاش — مثل تعويض متفق عليه أو خصم على فاتورة.',
    allocatorRpc: 'allocate_debit_note_number',
    successPrefix: 'تم إصدار إشعار مدين',
  },
};

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'utility', label: 'كهرباء / ماء / إنترنت / هاتف' },
  { value: 'salary', label: 'راتب / أجر' },
  { value: 'legal', label: 'محامي / رسوم قضائية' },
  { value: 'maintenance', label: 'صيانة / كراج / تنظيف' },
  { value: 'office_supplies', label: 'قرطاسية / طباعة' },
  { value: 'marketing', label: 'إعلانات / تسويق' },
  { value: 'tax_fees', label: 'ضرائب / رسوم رسمية' },
  { value: 'other', label: 'أخرى' },
];

// Payment-line types supported for "آخر" vouchers. Customer-cheque
// + visa intentionally omitted — they need an entity link.
type LineType = 'cash' | 'cheque' | 'transfer' | 'visa';

interface PaymentLine {
  id: string;
  type: LineType;
  amount: number;
  date: string;
  // Cheque-specific fields. cheque_due_date holds the maturity (when
  // the cheque can be cashed); the row's `date` holds the issue date
  // for cheque rows so the layout matches DebtPaymentModal.
  cheque_number?: string;
  bank_code?: string | null;
  branch_code?: string | null;
  cheque_due_date?: string;
  notes?: string;
}

const TYPE_LABEL: Record<LineType, string> = {
  cash: 'نقداً',
  cheque: 'شيك',
  transfer: 'تحويل بنكي',
  visa: 'فيزا',
};

const TYPE_ICON: Record<LineType, typeof Banknote> = {
  cash: Banknote,
  cheque: FileText,
  transfer: Receipt,
  visa: CreditCard,
};

const today = () => format(new Date(), 'yyyy-MM-dd');

function makeLine(type: LineType = 'cash'): PaymentLine {
  const base: PaymentLine = {
    id: crypto.randomUUID(),
    type,
    amount: 0,
    date: today(),
  };
  if (type === 'cheque') {
    base.cheque_due_date = today();
    base.bank_code = null;
    base.branch_code = null;
  }
  return base;
}

export function AddOtherVoucherDialog({ open, onOpenChange, kind, onSaved }: Props) {
  const { agentId } = useAgentContext();
  const { user } = useAuth();
  const config = KIND_CONFIG[kind];
  const Icon = config.icon;
  const supportsCashFlow = kind === 'payment' || kind === 'disbursement';

  const [recipientName, setRecipientName] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [customCategory, setCustomCategory] = useState('');
  const [paperAmount, setPaperAmount] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [lines, setLines] = useState<PaymentLine[]>([makeLine('cash')]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setRecipientName('');
      setCategory('other');
      setCustomCategory('');
      setPaperAmount('');
      setIssueDate(today());
      setLines([makeLine('cash')]);
      setNotes('');
      setSaving(false);
    }
  }, [open]);

  const resolvedCategory = useMemo(() => {
    if (category === 'other') return customCategory.trim() || 'other';
    return category;
  }, [category, customCategory]);

  const linesTotal = useMemo(
    () => lines.reduce((s, l) => s + Number(l.amount || 0), 0),
    [lines],
  );

  const finalAmount = supportsCashFlow ? linesTotal : Number(paperAmount || 0);

  const validLineCount = useMemo(
    () => lines.filter((l) => Number(l.amount || 0) > 0).length,
    [lines],
  );

  const canSave =
    !!agentId &&
    recipientName.trim().length > 0 &&
    finalAmount > 0 &&
    !!issueDate &&
    (!supportsCashFlow || validLineCount > 0) &&
    !saving;

  const updateLine = (id: string, patch: Partial<PaymentLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = () => setLines((prev) => [...prev, makeLine('cash')]);

  const duplicateLine = (id: string) =>
    setLines((prev) => {
      const src = prev.find((l) => l.id === id);
      if (!src) return prev;
      return [...prev, { ...src, id: crypto.randomUUID() }];
    });

  const removeLine = (id: string) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const handleSave = async () => {
    if (!canSave) return;

    setSaving(true);
    try {
      const year = new Date(issueDate).getFullYear();
      const { data: voucherNumber, error: numErr } = await supabase.rpc(
        config.allocatorRpc as never,
        { p_agent_id: agentId, p_year: year } as never,
      );
      if (numErr) throw numErr;

      const trimmedRecipient = recipientName.trim();
      const trimmedNotes = notes.trim();

      let paymentMethod: string | null = null;
      let chequeNumber: string | null = null;
      let breakdownText = '';
      if (supportsCashFlow) {
        const nonZero = lines.filter((l) => Number(l.amount || 0) > 0);
        if (nonZero.length === 1) {
          const only = nonZero[0];
          paymentMethod = only.type;
          if (only.type === 'cheque') {
            chequeNumber = only.cheque_number?.trim() || null;
          }
        } else if (nonZero.length > 1) {
          paymentMethod = 'multiple';
          breakdownText = nonZero
            .map((l) => {
              const label = TYPE_LABEL[l.type];
              const amt = `₪${Number(l.amount).toLocaleString('en-US')}`;
              if (l.type === 'cheque' && l.cheque_number) {
                return `${label} ${l.cheque_number}: ${amt}`;
              }
              return `${label}: ${amt}`;
            })
            .join('\n');
        }
      }

      const combinedNotes = [breakdownText, trimmedNotes].filter(Boolean).join('\n');

      const insertRow: Record<string, unknown> = {
        receipt_type: kind,
        source: 'manual',
        voucher_number: voucherNumber,
        client_id: null,
        broker_id: null,
        company_id: null,
        client_name: trimmedRecipient,
        recipient_name: trimmedRecipient,
        recipient_category: resolvedCategory,
        amount: finalAmount,
        receipt_date: issueDate,
        notes: combinedNotes || null,
        agent_id: agentId,
        branch_id: null,
        created_by: user?.id ?? null,
      };
      if (paymentMethod) insertRow.payment_method = paymentMethod;
      if (chequeNumber) insertRow.cheque_number = chequeNumber;

      const { data: receiptRow, error: receiptErr } = await supabase
        .from('receipts')
        .insert(insertRow as never)
        .select('id')
        .single();
      if (receiptErr) throw receiptErr;

      toast.success(`${config.successPrefix} ${voucherNumber ?? ''}`.trim());
      onSaved({
        receiptId: (receiptRow as { id: string }).id,
        voucherNumber: (voucherNumber as string) ?? null,
      });
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل في الحفظ';
      console.error('[AddOtherVoucherDialog] save failed:', err);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent
        dir="rtl"
        className="max-w-5xl w-[95vw] max-h-[92vh] sm:max-h-[90vh] overflow-y-auto p-4 sm:p-6"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={cn('h-5 w-5', config.iconColor)} />
            {config.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className={cn('rounded-lg border p-4 space-y-1.5', config.heroTone)}>
            <p className="text-sm font-semibold text-foreground">
              {config.title.split('—')[0].trim()}
            </p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {config.helper}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="other-recipient" className="text-xs">
              اسم الجهة / المستلم <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="other-recipient"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="مثلاً: شركة الكهرباء، محامي تامر، كراج إبراهيم"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">التصنيف</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full">
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
            {category === 'other' && (
              <Textarea
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="اكتب التصنيف..."
                rows={2}
                className="resize-none"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">التاريخ</Label>
            <ArabicDatePicker value={issueDate} onChange={setIssueDate} />
          </div>

          {!supportsCashFlow && (
            <div className="space-y-1.5">
              <Label htmlFor="other-paper-amount" className="text-xs">
                المبلغ (₪) <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="other-paper-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={paperAmount}
                onChange={(e) => setPaperAmount(e.target.value)}
                placeholder="0"
                className="ltr-nums"
                dir="ltr"
              />
            </div>
          )}

          {/* Multi-line payment editor — same layout pattern as
              DebtPaymentModal: single "إضافة دفعة" button on the
              right, per-line card with grid-cols-3 primary row, a
              cheque sub-row when type === 'cheque', and a notes
              textarea per line. */}
          {supportsCashFlow && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">الدفعات</Label>
                <Button variant="outline" size="sm" onClick={addLine}>
                  <Plus className="h-4 w-4 ml-2" />
                  إضافة دفعة
                </Button>
              </div>

              {lines.map((line, index) => {
                const TypeIcon = TYPE_ICON[line.type];
                return (
                  <Card key={line.id} className="p-3">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                          <TypeIcon className="h-3.5 w-3.5" />
                          دفعة {index + 1}
                        </span>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                            onClick={() => duplicateLine(line.id)}
                            title="تكرار الدفعة"
                            aria-label="تكرار الدفعة"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          {lines.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => removeLine(line.id)}
                              title="حذف الدفعة"
                              aria-label="حذف الدفعة"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Primary row: amount / type / date — same order
                          DebtPaymentModal uses so the cashier types
                          the most-changing fields together. */}
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs">المبلغ</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={line.amount || ''}
                            onChange={(e) =>
                              updateLine(line.id, { amount: Number(e.target.value) || 0 })
                            }
                            placeholder="0"
                            className="ltr-nums"
                            dir="ltr"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">طريقة الدفع</Label>
                          <Select
                            value={line.type}
                            onValueChange={(v) => updateLine(line.id, { type: v as LineType })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">
                                <span className="flex items-center gap-2">
                                  <Banknote className="h-4 w-4" />
                                  نقداً
                                </span>
                              </SelectItem>
                              <SelectItem value="cheque">
                                <span className="flex items-center gap-2">
                                  <FileText className="h-4 w-4" />
                                  شيك
                                </span>
                              </SelectItem>
                              <SelectItem value="transfer">
                                <span className="flex items-center gap-2">
                                  <Receipt className="h-4 w-4" />
                                  تحويل بنكي
                                </span>
                              </SelectItem>
                              <SelectItem value="visa">
                                <span className="flex items-center gap-2">
                                  <CreditCard className="h-4 w-4" />
                                  فيزا
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">
                            {line.type === 'cheque' ? 'تاريخ الإصدار' : 'تاريخ الدفع'}
                          </Label>
                          <ArabicDatePicker
                            value={line.date}
                            onChange={(v) => updateLine(line.id, { date: v ?? '' })}
                          />
                        </div>
                      </div>

                      {line.type === 'cheque' && (
                        <div className="grid grid-cols-4 gap-3">
                          <div className="space-y-1.5 min-w-0">
                            <Label className="text-xs font-semibold">البنك</Label>
                            <BankPicker
                              value={line.bank_code ?? null}
                              onChange={(code) => updateLine(line.id, { bank_code: code })}
                            />
                          </div>
                          <div className="space-y-1.5 min-w-0">
                            <Label className="text-xs font-semibold">الفرع</Label>
                            <Input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={4}
                              className="h-10 text-sm ltr-nums font-mono"
                              placeholder="مثال: 305"
                              value={line.branch_code || ''}
                              onChange={(e) => {
                                const v = e.target.value.replace(/\D/g, '');
                                updateLine(line.id, { branch_code: v || null });
                              }}
                            />
                          </div>
                          <div className="space-y-1.5 min-w-0">
                            <Label className="text-xs font-semibold">رقم الشيك</Label>
                            <Input
                              value={line.cheque_number || ''}
                              onChange={(e) =>
                                updateLine(line.id, { cheque_number: e.target.value })
                              }
                              placeholder="رقم الشيك"
                              className="h-10 font-mono"
                            />
                          </div>
                          <div className="space-y-1.5 min-w-0">
                            <Label className="text-xs">تاريخ الاستحقاق</Label>
                            <ArabicDatePicker
                              value={line.cheque_due_date ?? ''}
                              onChange={(v) =>
                                updateLine(line.id, { cheque_due_date: v ?? '' })
                              }
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <Label className="text-xs">ملاحظات (اختياري)</Label>
                        <Textarea
                          value={line.notes || ''}
                          onChange={(e) =>
                            updateLine(line.id, { notes: e.target.value })
                          }
                          placeholder="أضف ملاحظة لهذه الدفعة..."
                          rows={1}
                          className="resize-none text-sm min-h-9"
                        />
                      </div>
                    </div>
                  </Card>
                );
              })}

              <Card className="p-3 flex items-center justify-between">
                <span className="text-sm font-semibold">مجموع الدفعات:</span>
                <span className="text-base font-bold tabular-nums">
                  ₪{linesTotal.toLocaleString('en-US')}
                </span>
              </Card>

              {validLineCount === 0 && (
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  ⚠ أضف دفعة واحدة على الأقل
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="other-notes" className="text-xs">
              ملاحظات عامة (اختياري)
            </Label>
            <Textarea
              id="other-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="تفاصيل إضافية، رقم فاتورة، تواريخ مرجعية..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            رجوع
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : supportsCashFlow ? (
              'تسديد المبلغ'
            ) : (
              'حفظ'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
