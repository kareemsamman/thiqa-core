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
import { useAgentContext } from '@/hooks/useAgentContext';
import { useAuth } from '@/hooks/useAuth';
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
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-2 leading-relaxed">
              إشعار دائن يُضاف على الحساب المفتوح بينك وبين الشركة — يزيد المستحق
              لها بدون كاش. لتسديده فعلياً أصدر سند صرف لاحقاً.
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
                className="ltr-nums"
                dir="ltr"
              />
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
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin ms-2" /> : null}
            حفظ الإشعار
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
