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
// Why one dialog for four kinds: the form fields are identical apart
// from cosmetic labels (color tone, helper text). Four near-identical
// files would drift; one keyed-by-kind dialog stays consistent.

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
import { Banknote, Loader2, Receipt, Wallet, WalletMinimal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format } from 'date-fns';
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

// Fixed category list — kept on the client so the dropdown loads
// instantly. Custom categories live under the "أخرى" sentinel and
// flow through as the free-form custom_category input value.
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

// Payment method only applies to كاش-moving kinds (قبض / صرف). For
// إشعار دائن / إشعار مدين the method is "بدون كاش" by definition.
const PAYMENT_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'cash', label: 'نقدي' },
  { value: 'cheque', label: 'شيك' },
  { value: 'transfer', label: 'تحويل بنكي' },
  { value: 'visa', label: 'فيزا' },
];

export function AddOtherVoucherDialog({ open, onOpenChange, kind, onSaved }: Props) {
  const { agentId } = useAgentContext();
  const { user } = useAuth();
  const config = KIND_CONFIG[kind];
  const Icon = config.icon;
  const supportsCashFlow = kind === 'payment' || kind === 'disbursement';

  const [recipientName, setRecipientName] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [customCategory, setCustomCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [issueDate, setIssueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [chequeNumber, setChequeNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset everything when the dialog closes. Without this, switching
  // voucher kinds between consecutive opens would silently carry over
  // the previous amount / recipient — exactly the kind of stale state
  // that surprises users.
  useEffect(() => {
    if (!open) {
      setRecipientName('');
      setCategory('other');
      setCustomCategory('');
      setAmount('');
      setIssueDate(format(new Date(), 'yyyy-MM-dd'));
      setPaymentMethod('cash');
      setChequeNumber('');
      setNotes('');
      setSaving(false);
    }
  }, [open]);

  // Derive the category the row gets saved with. "أخرى" routes the
  // free-text into the column directly; the other options use the
  // canonical English key so downstream filters (e.g. "show me all
  // legal expenses") can match without locale gymnastics.
  const resolvedCategory = useMemo(() => {
    if (category === 'other') return customCategory.trim() || 'other';
    return category;
  }, [category, customCategory]);

  const canSave =
    !!agentId &&
    recipientName.trim().length > 0 &&
    Number(amount) > 0 &&
    !!issueDate &&
    !saving;

  const handleSave = async () => {
    if (!canSave) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('أدخل مبلغاً صحيحاً أكبر من صفر');
      return;
    }

    setSaving(true);
    try {
      // Allocate the per-agent / per-year voucher number using the
      // matching RPC. Same sequence as typed-counterparty rows so the
      // ledger stays continuous across all four kinds.
      const year = new Date(issueDate).getFullYear();
      const { data: voucherNumber, error: numErr } = await supabase.rpc(
        config.allocatorRpc as never,
        { p_agent_id: agentId, p_year: year } as never,
      );
      if (numErr) throw numErr;

      const trimmedRecipient = recipientName.trim();
      const trimmedNotes = notes.trim();
      const insertRow: Record<string, unknown> = {
        receipt_type: kind,
        source: 'manual',
        voucher_number: voucherNumber,
        // No FK on any of these — that's what flags the row as "آخر".
        client_id: null,
        broker_id: null,
        company_id: null,
        client_name: trimmedRecipient,
        recipient_name: trimmedRecipient,
        recipient_category: resolvedCategory,
        amount: amt,
        receipt_date: issueDate,
        notes: trimmedNotes || null,
        agent_id: agentId,
        branch_id: null,
        created_by: user?.id ?? null,
      };
      if (supportsCashFlow) {
        insertRow.payment_method = paymentMethod;
        if (paymentMethod === 'cheque' && chequeNumber.trim()) {
          insertRow.cheque_number = chequeNumber.trim();
        }
      }

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
          {/* Hero — short reminder of WHAT this voucher does and the
              kind of recipients it's appropriate for. Reads at a
              glance so the user can confirm they picked the right
              voucher type before filling the form. */}
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">التصنيف</Label>
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
              {category === 'other' && (
                <Input
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="اكتب التصنيف..."
                  className="mt-1.5"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">التاريخ</Label>
              <ArabicDatePicker value={issueDate} onChange={setIssueDate} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="other-amount" className="text-xs">
                المبلغ (₪) <span className="text-rose-600">*</span>
              </Label>
              <Input
                id="other-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="ltr-nums"
                dir="ltr"
              />
            </div>

            {supportsCashFlow && (
              <div className="space-y-1.5">
                <Label className="text-xs">طريقة الدفع</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {supportsCashFlow && paymentMethod === 'cheque' && (
            <div className="space-y-1.5">
              <Label htmlFor="other-cheque" className="text-xs">
                رقم الشيك (اختياري)
              </Label>
              <Input
                id="other-cheque"
                value={chequeNumber}
                onChange={(e) => setChequeNumber(e.target.value)}
                placeholder="مثلاً: 1234567"
                className="ltr-nums"
                dir="ltr"
              />
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
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
