// ─── AddBrokerDebitNoteDialog ──────────────────────────────────
//
// "إشعار مدين" against a broker — the office records that the
// broker owes us X. Uses the new receipt_type='debit_note' so it
// joins the unified debit-note infrastructure (M{nn}/{year} voucher
// number, generate-voucher renderer, etc.).
//
// Note: an older AddBrokerCreditNoteDialog exists which renders
// title "إشعار مدين" but stores receipt_type='credit_note' (legacy
// from before the proper debit_note type existed). Both dialogs
// produce semantically equivalent rows for the broker balance —
// AddSettlementDialog's brokerBalance subtracts both credit_note
// AND debit_note rows from owesUs (see stage 6). New entries go
// through this dialog; existing data stays as credit_note.

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
  onSaved: (info: { receiptId: string }) => void;
  cancelLabel?: string;
}

export function AddBrokerDebitNoteDialog({
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
      const year = new Date(issueDate).getFullYear();
      const { data: voucherNumber, error: numErr } = await supabase.rpc(
        'allocate_debit_note_number',
        { p_agent_id: agentId, p_year: year } as never,
      );
      if (numErr) throw numErr;

      const trimmedNotes = notes.trim();
      const combinedNotes = trimmedNotes
        ? `${description.trim()}\nملاحظات: ${trimmedNotes}`
        : description.trim();

      const { data: receiptRow, error: receiptErr } = await supabase
        .from('receipts')
        .insert({
          receipt_type: 'debit_note',
          source: 'auto',
          voucher_number: voucherNumber,
          client_id: null,
          client_name: broker.name,
          broker_id: broker.id,
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

      toast.success(`تم إصدار إشعار مدين ${voucherNumber}`);
      onSaved({ receiptId: (receiptRow as { id: string }).id });
      onOpenChange(false);
    } catch (err: any) {
      console.error('[AddBrokerDebitNoteDialog] save failed:', err);
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
            <Wallet className="h-5 w-5 text-rose-600" />
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
            <p className="text-[11px] text-rose-700 dark:text-rose-400 mt-2 leading-relaxed">
              إشعار مدين على الوسيط: تسجيل مبلغ مستحق علينا منه — يُضاف إلى دين الوسيط
              تجاه المكتب ويُخصم من أول دفعة قادمة منه.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bdn-amount" className="text-xs">المبلغ (₪)</Label>
              <Input
                id="bdn-amount"
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
            <Label htmlFor="bdn-description" className="text-xs">السبب</Label>
            <Input
              id="bdn-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثلاً: تسوية فرق عمولة، استرداد دفعة..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bdn-notes" className="text-xs">ملاحظات (اختياري)</Label>
            <Textarea
              id="bdn-notes"
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
