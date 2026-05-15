// ─── AddCompanyCreditNoteDialog ───────────────────────────────
//
// "إشعار دائن" for an insurance company — paper acknowledgment that
// the agent owes the company more (outside the normal policy-
// issuance flow). Per the user's accounting model:
//   • Credit memo issued IN FAVOR OF the company = credit on the
//     open running account between us.
//   • Effect: ADDS to المستحق للشركة (the company's claim grows).
//
// This is the opposite sign convention from customer/broker credit
// notes — for customer + broker the office HOLDS the receivable, so
// crediting their account reduces what they owe us. For companies
// the office holds the PAYABLE, so crediting their account grows
// what we owe them. Same receipt_type ('credit_note') stored in DB;
// the difference is in how useCompaniesOutstanding aggregates it.
//
// No settlement row — this is paper-only until the agent issues a
// follow-up سند صرف (which would write to company_settlements with
// direction='outgoing').

import { useEffect, useState } from 'react';
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
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { Loader2, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useAgentContext } from '@/hooks/useAgentContext';
import { useAuth } from '@/hooks/useAuth';
import { useCompaniesOutstanding } from '@/hooks/useCompaniesOutstanding';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { CompanyLite } from './AddVoucherDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: CompanyLite;
  /** Fires after the receipt is inserted. Receives the new
   *  receipts.id so the caller can hand it off to VoucherSendDialog
   *  for print/SMS/WhatsApp routing. */
  onSaved: (info: { receiptId: string }) => void;
  /** Label for the secondary footer button. Defaults to "إلغاء";
   *  the AddVoucher wizard passes "رجوع". */
  cancelLabel?: string;
}

export function AddCompanyCreditNoteDialog({
  open,
  onOpenChange,
  company,
  onSaved,
  cancelLabel = 'إلغاء',
}: Props) {
  const { agentId } = useAgentContext();
  const { user } = useAuth();
  const { outstandingByCompany } = useCompaniesOutstanding();
  const balance = outstandingByCompany.get(company.id) ?? null;
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [issueDate, setIssueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setAmount('');
      setDescription('');
      setNotes('');
      setIssueDate(format(new Date(), 'yyyy-MM-dd'));
      setSaving(false);
    }
  }, [open]);

  const displayName = company.name_ar || company.name;

  // Live cap — إشعار دائن reduces المستحق same way سند صرف does, so
  // recording more than what's actually owed would create a fake
  // credit balance with the company. Per the user "ممنوع اقدر احط
  // سعر اكتر من المطلوب باشعار دائن او بسند صرف". Outstanding can
  // be missing (loading) or zero — both block save.
  const enteredAmount = Number(amount);
  const cap = balance?.outstanding ?? null;
  const capZero = cap !== null && cap <= 0.005;
  const capExceeded =
    cap !== null && Number.isFinite(enteredAmount) && enteredAmount > cap + 0.005;

  const handleSave = async () => {
    if (!agentId) {
      toast.error('لم يتم تحميل بيانات الوكيل بعد');
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('أدخل مبلغاً صحيحاً أكبر من صفر');
      return;
    }
    // Runtime cap guard — UI also blocks via disabled button, but the
    // balance could be stale if another tab just settled something.
    if (cap !== null && amt > cap + 0.005) {
      toast.error(
        capZero
          ? 'لا يوجد مستحق للشركة — لا يمكن تسجيل إشعار دائن'
          : `المبلغ يتجاوز المستحق للشركة (₪${Math.round(cap).toLocaleString('en-US')})`,
      );
      return;
    }
    if (!description.trim()) {
      toast.error('السبب مطلوب');
      return;
    }

    setSaving(true);
    try {
      const year = new Date(issueDate).getFullYear();
      const { data: voucherNumber, error: numErr } = await supabase.rpc(
        'allocate_credit_note_number',
        { p_agent_id: agentId, p_year: year },
      );
      if (numErr) throw numErr;

      const trimmedNotes = notes.trim();
      const combinedNotes = trimmedNotes
        ? `${description.trim()}\nملاحظات: ${trimmedNotes}`
        : description.trim();

      const { data: receiptRow, error: receiptErr } = await supabase
        .from('receipts')
        .insert({
          receipt_type: 'credit_note',
          source: 'auto',
          voucher_number: voucherNumber,
          client_id: null,
          client_name: displayName,
          company_id: company.id,
          amount: amt,
          receipt_date: issueDate,
          notes: combinedNotes,
          agent_id: agentId,
          branch_id: null,
          created_by: user?.id ?? null,
        } as never)
        .select('id')
        .single();
      if (receiptErr) throw receiptErr;

      toast.success(`تم إصدار إشعار دائن ${voucherNumber}`);
      onSaved({ receiptId: (receiptRow as { id: string }).id });
      onOpenChange(false);
    } catch (err: any) {
      console.error('[AddCompanyCreditNoteDialog] save failed:', err);
      toast.error(err?.message || 'فشل في حفظ إشعار الدائن');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent
        dir="rtl"
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-amber-600" />
            إضافة إشعار دائن — {displayName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground mb-1">شركة التأمين</div>
            <div className="font-semibold text-base">{displayName}</div>
            {balance && (
              <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {balance.outstanding > 0.01
                      ? 'المستحق للشركة'
                      : balance.outstanding < -0.01
                        ? 'رصيد دائن لدى الشركة'
                        : 'الحساب مع الشركة مسوّى'}
                  </span>
                  <span
                    className={cn(
                      'text-base font-bold tabular-nums',
                      balance.outstanding > 0.01
                        ? 'text-rose-700 dark:text-rose-300'
                        : balance.outstanding < -0.01
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-muted-foreground',
                    )}
                  >
                    ₪{Math.round(Math.abs(balance.outstanding)).toLocaleString('en-US')}
                  </span>
                </div>
                <div className="space-y-1 text-[11px] tabular-nums border-t border-border/40 pt-2">
                  <div className="flex justify-between text-muted-foreground">
                    <span>المستحق من التأمينات</span>
                    <span>₪{Math.round(balance.totalPayable).toLocaleString('en-US')}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>− سندات الصرف</span>
                    <span>₪{Math.round(balance.totalPaidOut).toLocaleString('en-US')}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>− إشعارات دائنة</span>
                    <span>₪{Math.round(balance.totalCreditNotes).toLocaleString('en-US')}</span>
                  </div>
                </div>
              </div>
            )}
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-2 leading-relaxed">
              إشعار دائن: تسجيل الدفع على الحساب الجاري مع الشركة بدون كاش —
              يُقلِّل المستحق من التأمينات وينتظر التسوية الفعلية لاحقاً عبر سند صرف.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ccn-amount" className="text-xs">المبلغ (₪)</Label>
              <Input
                id="ccn-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className={cn(
                  'ltr-nums',
                  capExceeded && 'border-destructive focus-visible:ring-destructive',
                )}
                dir="ltr"
              />
              {capExceeded && !capZero && (
                <p className="text-[11px] text-destructive font-medium">
                  ⚠ يتجاوز المستحق للشركة — أقصى ₪{Math.round(cap!).toLocaleString('en-US')}
                </p>
              )}
              {capZero && enteredAmount > 0 && (
                <p className="text-[11px] text-destructive font-medium">
                  ⚠ لا يوجد مستحق للشركة — لا يمكن تسجيل إشعار دائن
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">التاريخ</Label>
              <ArabicDatePicker
                value={issueDate}
                onChange={setIssueDate}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ccn-description" className="text-xs">السبب</Label>
            <Input
              id="ccn-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثلاً: تسوية فرق عمولة، رسوم إدارية، اتفاق منتصف الفترة..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ccn-notes" className="text-xs">ملاحظات (اختياري)</Label>
            <Textarea
              id="ccn-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات إضافية..."
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
            {cancelLabel}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || capExceeded || (capZero && enteredAmount > 0)}
            title={
              capZero
                ? 'لا يوجد مستحق للشركة — لا يمكن تسجيل إشعار دائن'
                : capExceeded
                  ? `المبلغ يتجاوز المستحق للشركة (₪${Math.round(cap!).toLocaleString('en-US')})`
                  : undefined
            }
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin ms-2" /> : null}
            حفظ الإشعار
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
