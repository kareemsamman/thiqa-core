// ─── AddDebitNoteDialog ────────────────────────────────────────
//
// Standalone "إشعار مدين" creation for a customer — the mirror of
// AddCreditNoteDialog. Per the user's model: "احنا كوكيل بدنا منوا
// مصاري" — the office records that the customer owes us X for some
// reason (late fee, admin charge, accident bill, etc.).
//
// Flow mirrors the credit-note version:
//   1. INSERT customer_wallet_transactions (transaction_type =
//      'manual_debit') as the source of truth for the new
//      customerOwes balance.
//   2. Allocate an M{nn}/{year} voucher number via
//      allocate_debit_note_number RPC (parallel to the C-allocator).
//   3. INSERT receipts (receipt_type='debit_note') with
//      wallet_transaction_id linking the two — keeps the audit trail
//      walkable from either side.
//
// The customer's debt math (kashf, ClientDetails debt tile,
// DebtPaymentModal cap, get_client_balance RPC) all read the wallet
// and add 'manual_debit' to the customerOwes side, so the next
// payment session sees the bumped total automatically.

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
import type { ClientLite } from './AddVoucherDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientLite;
  /** Fires after the receipt is inserted. Receives the new receipts.id
   *  so the caller can hand it off to VoucherSendDialog for print/SMS. */
  onSaved: (info: { receiptId: string }) => void;
  /** Label for the secondary footer button. Defaults to "إلغاء"; the
   *  AddVoucher wizard passes "رجوع". */
  cancelLabel?: string;
}

export function AddDebitNoteDialog({
  open,
  onOpenChange,
  client,
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
      const { data: clientRow, error: clientErr } = await supabase
        .from('clients')
        .select('branch_id')
        .eq('id', client.id)
        .maybeSingle();
      if (clientErr) throw clientErr;
      const branchId = clientRow?.branch_id ?? null;

      const { data: walletRow, error: walletErr } = await supabase
        .from('customer_wallet_transactions')
        .insert({
          client_id: client.id,
          transaction_type: 'manual_debit',
          amount: amt,
          description: description.trim(),
          notes: notes.trim() || null,
          created_by_admin_id: user?.id ?? null,
          branch_id: branchId,
          agent_id: agentId,
        })
        .select('id')
        .single();
      if (walletErr) throw walletErr;

      const year = new Date(issueDate).getFullYear();
      const { data: voucherNumber, error: numErr } = await supabase.rpc(
        'allocate_debit_note_number',
        { p_agent_id: agentId, p_year: year } as never,
      );
      if (numErr) throw numErr;

      const trimmedNotes = notes.trim();
      const combinedReceiptNotes = trimmedNotes
        ? `${description.trim()}\nملاحظات: ${trimmedNotes}`
        : description.trim();
      const { data: receiptRow, error: receiptErr } = await supabase
        .from('receipts')
        .insert({
          receipt_type: 'debit_note',
          source: 'auto',
          voucher_number: voucherNumber,
          client_id: client.id,
          client_name: client.full_name,
          wallet_transaction_id: walletRow?.id,
          amount: amt,
          receipt_date: issueDate,
          notes: combinedReceiptNotes,
          agent_id: agentId,
          branch_id: branchId,
          created_by: user?.id ?? null,
        } as never)
        .select('id')
        .single();
      if (receiptErr) throw receiptErr;

      toast.success(`تم إصدار إشعار مدين ${voucherNumber}`);
      onSaved({ receiptId: (receiptRow as { id: string }).id });
      onOpenChange(false);
    } catch (err: any) {
      console.error('[AddDebitNoteDialog] save failed:', err);
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
            إضافة إشعار مدين — {client.full_name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground mb-1">العميل</div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-semibold text-base">{client.full_name}</span>
              {client.id_number && (
                <span className="text-xs text-muted-foreground ltr-nums">
                  هوية: {client.id_number}
                </span>
              )}
              {client.phone_number && (
                <span className="text-xs text-muted-foreground ltr-nums">
                  هاتف: {client.phone_number}
                </span>
              )}
            </div>
            <p className="text-[11px] text-rose-700 dark:text-rose-400 mt-2 leading-relaxed">
              إشعار مدين: تسجيل مبلغ مستحق على العميل (رسوم متأخرة، رسوم إدارية،
              مبلغ خدمة...) — يُضاف فوراً إلى دين العميل ويُخصم من أول دفعة قادمة.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dn-amount" className="text-xs">المبلغ (₪)</Label>
              <Input
                id="dn-amount"
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
            <Label htmlFor="dn-description" className="text-xs">السبب</Label>
            <Input
              id="dn-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثلاً: رسوم متأخرة، رسوم إدارية، مبلغ مستحق على حادث..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dn-notes" className="text-xs">ملاحظات (اختياري)</Label>
            <Textarea
              id="dn-notes"
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
