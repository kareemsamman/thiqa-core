// ─── AddBrokerCreditNoteDialog ────────────────────────────────
//
// "إشعار مدين" for a broker — the broker-side mirror of the
// customer إشعار دائن flow. Per the user's accounting model:
//   • إشعار مدين للوسيط = the office acknowledges the broker is
//     owed this amount (he wants money from us).
//   • Functionally, the office uses it to write down what the
//     broker still owes us — the new amount lands as a "credit
//     against the broker's outstanding debt" in the accounting
//     page balance.
//
// Brokers don't have a dedicated wallet table the way customers do
// (customer_wallet_transactions). Instead the credit-note lives
// solely on the receipts table (receipt_type='credit_note',
// broker_id set), and the broker-balance computation in
// AddSettlementDialog / BrokersSection subtracts the sum of these
// rows from "بدنا منه" (broker's outstanding debt). No settlement
// row is created — the إشعار مدين is paper-only until the user
// follows up with an actual سند صرف.
//
// Title and copy use the "إشعار مدين" terminology the user
// requested for brokers, but the underlying receipt_type stays
// 'credit_note' so the rest of the pipeline (generate-voucher,
// send-voucher, /receipts page badges, kashf) treats it the same
// way as customer credit notes.

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
import type { BrokerLite } from './AddVoucherDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  broker: BrokerLite;
  /** Fires after the receipt is inserted. Receives the new
   *  receipts.id so the caller can hand it off to VoucherSendDialog
   *  for print/SMS/WhatsApp routing. */
  onSaved: (info: { receiptId: string }) => void;
  /** Label for the secondary footer button. Defaults to "إلغاء";
   *  the AddVoucher wizard passes "رجوع". */
  cancelLabel?: string;
}

export function AddBrokerCreditNoteDialog({
  open,
  onOpenChange,
  broker,
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

  // Reset every field on close so the next opening starts fresh.
  useEffect(() => {
    if (!open) {
      setAmount('');
      setDescription('');
      setNotes('');
      setIssueDate(format(new Date(), 'yyyy-MM-dd'));
      setSaving(false);
    }
  }, [open]);

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
      // Allocate the user-facing C-number via the shared allocator.
      // Same pool as customer credit notes — agencies prefer one
      // continuous sequence over per-counterparty sub-sequences.
      const year = new Date(issueDate).getFullYear();
      const { data: voucherNumber, error: numErr } = await supabase.rpc(
        'allocate_credit_note_number',
        { p_agent_id: agentId, p_year: year },
      );
      if (numErr) throw numErr;

      // Insert the receipts row. broker_id is set; client_id stays
      // NULL since this isn't tied to a customer. The receipts page
      // and accounting balance both look at broker_id to scope
      // broker-related rows.
      const { data: receiptRow, error: receiptErr } = await supabase
        .from('receipts')
        .insert({
          receipt_type: 'credit_note',
          source: 'auto',
          voucher_number: voucherNumber,
          client_id: null,
          client_name: broker.name,
          broker_id: broker.id,
          amount: amt,
          receipt_date: issueDate,
          notes: description.trim(),
          agent_id: agentId,
          // No branch resolution for brokers — they're agency-wide
          // entities, not branch-scoped.
          branch_id: null,
          created_by: user?.id ?? null,
        })
        .select('id')
        .single();
      if (receiptErr) throw receiptErr;

      toast.success(`تم إصدار إشعار مدين ${voucherNumber}`);
      onSaved({ receiptId: receiptRow!.id });
      onOpenChange(false);
    } catch (err: any) {
      console.error('[AddBrokerCreditNoteDialog] save failed:', err);
      toast.error(err?.message || 'فشل في حفظ إشعار المدين');
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
            إضافة إشعار مدين — {broker.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground mb-1">الوسيط</div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-semibold text-base">{broker.name}</span>
              {broker.phone && (
                <span className="text-xs text-muted-foreground ltr-nums">
                  هاتف: {broker.phone}
                </span>
              )}
            </div>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-2 leading-relaxed">
              إشعار مدين يُسجَّل في حساب الوسيط ويُخصم من رصيده عليك. لا يُصرف نقداً —
              لتسديده فعلياً أصدر سند صرف لاحقاً.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bcn-amount" className="text-xs">المبلغ (₪)</Label>
              <Input
                id="bcn-amount"
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
            <Label htmlFor="bcn-description" className="text-xs">السبب</Label>
            <Input
              id="bcn-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثلاً: تسوية فرق عمولة، اتفاق على خصم..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bcn-notes" className="text-xs">ملاحظات (اختياري)</Label>
            <Textarea
              id="bcn-notes"
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
