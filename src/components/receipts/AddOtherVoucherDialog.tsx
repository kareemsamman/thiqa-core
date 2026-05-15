// ─── AddOtherVoucherDialog ─────────────────────────────────────
//
// Single dialog that handles ALL FOUR voucher kinds for the "آخر"
// counterparty (external party — utility, lawyer, garage, salary,
// etc.). No entity picker — the agent types a free-form recipient
// name and picks a category from a fixed list (with "أخرى" + free
// text fallback for custom categories).
//
// Schema-wise these rows live in `receipts` like every other voucher:
//   client_id / broker_id / company_id ← null
//   recipient_name                     ← typed
//   recipient_category                 ← chosen (or custom text when
//                                         category === 'other')
//   receipt_type                       ← payment | disbursement |
//                                         credit_note | debit_note
//   voucher_number                     ← R/D/C/M{n}/{year}
//
// For قبض/صرف vouchers the form mirrors AddSettlementDialog's multi-
// line payment editor: نقداً / شيك جديد / تحويل بنكي / فيزا quick-add
// buttons, one row per line, total at the bottom. Multi-line saves
// land as ONE receipts row with payment_method='multiple' and the
// breakdown in `notes` — same pattern company settlements use, kept
// minimal because /آخر vouchers don't need customer-cheque
// integration or installment splitter.

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
import { BankBranchPicker } from '@/components/shared/BankBranchPicker';
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

// Payment-line types we support for "آخر" vouchers. Customer-cheque
// + installment splitter intentionally omitted — they're entity-tied
// flows that don't apply when the counterparty is a free-text label.
type LineType = 'cash' | 'cheque' | 'bank_transfer' | 'visa';

interface PaymentLine {
  id: string;
  type: LineType;
  amount: number;
  date: string;
  // Cheque-specific fields, only populated when type === 'cheque'.
  cheque_number?: string;
  bank_code?: string | null;
  branch_code?: string | null;
  cheque_due_date?: string;
}

const LINE_LABEL: Record<LineType, string> = {
  cash: 'نقداً',
  cheque: 'شيك جديد',
  bank_transfer: 'تحويل بنكي',
  visa: 'فيزا',
};

const LINE_ICON: Record<LineType, typeof Banknote> = {
  cash: Banknote,
  cheque: FileText,
  bank_transfer: Receipt,
  visa: CreditCard,
};

const today = () => format(new Date(), 'yyyy-MM-dd');

function makeLine(type: LineType): PaymentLine {
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
  // قبض / صرف move cash → multi-line editor. إشعار دائن / مدين are
  // paper-only adjustments → single amount input, no payment lines.
  const supportsCashFlow = kind === 'payment' || kind === 'disbursement';

  const [recipientName, setRecipientName] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [customCategory, setCustomCategory] = useState('');
  // Paper-voucher single amount (used when supportsCashFlow is false).
  const [paperAmount, setPaperAmount] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  // Multi-line payments (used when supportsCashFlow is true).
  const [lines, setLines] = useState<PaymentLine[]>([makeLine('cash')]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset everything when the dialog closes so the next opening starts
  // fresh.
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

  // Update a field on one line — keeps the other lines untouched and
  // the array order stable.
  const updateLine = (id: string, patch: Partial<PaymentLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = (type: LineType) =>
    setLines((prev) => [...prev, makeLine(type)]);

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

      // Build the breakdown block + decide payment_method.
      //  • 1 line   → payment_method = that line's type, single row.
      //  • N lines  → payment_method = 'multiple', total amount, the
      //                line breakdown gets prepended to the notes.
      //  • paper    → no payment_method (إشعار دائن/مدين).
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
              const label = LINE_LABEL[l.type];
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
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
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

          {/* Category — full-width so the dropdown + custom textarea
              read cleanly on long category labels. */}
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

          {/* Paper-voucher single-amount input (إشعار دائن / إشعار مدين).
              These flows don't move cash so a single amount field is
              all the user needs. */}
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

          {/* Multi-line payment editor (قبض / صرف). Matches the
              AddSettlementDialog layout: quick-add buttons row,
              one card per line, total + warning at the bottom. */}
          {supportsCashFlow && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold">الدفعات</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <QuickAddButton type="cash" onClick={() => addLine('cash')} />
                  <QuickAddButton type="cheque" onClick={() => addLine('cheque')} />
                  <QuickAddButton type="bank_transfer" onClick={() => addLine('bank_transfer')} />
                  <QuickAddButton type="visa" onClick={() => addLine('visa')} />
                </div>
              </div>

              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <PaymentLineCard
                    key={line.id}
                    index={idx}
                    line={line}
                    onChange={(patch) => updateLine(line.id, patch)}
                    onRemove={lines.length > 1 ? () => removeLine(line.id) : undefined}
                  />
                ))}
              </div>

              <Card className="p-3 flex items-center justify-between">
                <span className="text-sm font-semibold">إجمالي السند:</span>
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
              ملاحظات (اختياري)
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
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `حفظ${supportsCashFlow ? ` (${validLineCount})` : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// QuickAddButton — same visual the settlement dialog uses
// ──────────────────────────────────────────────────────────────

function QuickAddButton({
  type,
  onClick,
}: {
  type: LineType;
  onClick: () => void;
}) {
  const Icon = LINE_ICON[type];
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="gap-1.5 h-8"
    >
      <Plus className="h-3 w-3" />
      <Icon className="h-3.5 w-3.5" />
      <span className="text-xs">{LINE_LABEL[type]}</span>
    </Button>
  );
}

// ──────────────────────────────────────────────────────────────
// PaymentLineCard — one row per line
// ──────────────────────────────────────────────────────────────

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
  const Icon = LINE_ICON[line.type];
  return (
    <Card className="p-3 space-y-2.5 bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">
            دفعة {index + 1} · {LINE_LABEL[line.type]}
          </span>
        </div>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">طريقة الدفع</Label>
          <Select
            value={line.type}
            onValueChange={(v) => onChange({ type: v as LineType })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">نقداً</SelectItem>
              <SelectItem value="cheque">شيك جديد</SelectItem>
              <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
              <SelectItem value="visa">فيزا</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">التاريخ</Label>
          <ArabicDatePicker
            value={line.date}
            onChange={(v) => onChange({ date: v ?? '' })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">المبلغ (₪)</Label>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={line.amount || ''}
            onChange={(e) => onChange({ amount: Number(e.target.value) || 0 })}
            placeholder="0"
            className="ltr-nums h-9"
            dir="ltr"
          />
        </div>
      </div>

      {line.type === 'cheque' && (
        <div className="space-y-2 pt-1 border-t">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">رقم الشيك</Label>
              <Input
                value={line.cheque_number ?? ''}
                onChange={(e) => onChange({ cheque_number: e.target.value })}
                placeholder="مثلاً: 1234567"
                className="ltr-nums h-9"
                dir="ltr"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">تاريخ الاستحقاق</Label>
              <ArabicDatePicker
                value={line.cheque_due_date ?? ''}
                onChange={(v) => onChange({ cheque_due_date: v ?? '' })}
              />
            </div>
          </div>
          <BankBranchPicker
            bankCode={line.bank_code ?? null}
            branchCode={line.branch_code ?? null}
            onBankChange={(code) => onChange({ bank_code: code })}
            onBranchChange={(code) => onChange({ branch_code: code })}
          />
        </div>
      )}
    </Card>
  );
}
