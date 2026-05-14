// ─── AddCreditNoteDialog ───────────────────────────────────────
//
// Standalone "إشعار دائن" creation for a customer. Mirrors the
// CancelPolicyModal flow: INSERT into customer_wallet_transactions
// first (the source of truth for the customer's credit balance),
// allocate a C{nn}/{year} voucher number via RPC, then INSERT into
// receipts with wallet_transaction_id linking the two.
//
// Used when the office wants to credit a customer outside the
// cancellation/transfer paths — e.g. goodwill gesture, overpayment
// adjustment, manual reconciliation. The customer's wallet receives
// the credit immediately; future سند قبض submissions deduct from it
// automatically (per the agency's existing balance logic).

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
   *  so the caller can hand it off to VoucherSendDialog for print/SMS/
   *  WhatsApp routing. */
  onSaved: (info: { receiptId: string }) => void;
  /** Label for the secondary footer button. Defaults to "إلغاء"; the
   *  AddVoucher wizard passes "رجوع" because closing this dialog
   *  returns to the still-mounted picker instead of cancelling. */
  cancelLabel?: string;
}

export function AddCreditNoteDialog({
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

  // Reset every field when the dialog closes so the next opening
  // starts clean. Without this an unsubmitted draft would leak into
  // the next customer's form silently.
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
      // 1. Pull branch_id from the client so the wallet entry and the
      //    receipt land in the right branch ledger. The receipts page
      //    filter is branch-aware (AgentBranchFilter), so missing
      //    branch_id would hide this row from anyone scoped to a
      //    branch.
      const { data: clientRow, error: clientErr } = await supabase
        .from('clients')
        .select('branch_id')
        .eq('id', client.id)
        .maybeSingle();
      if (clientErr) throw clientErr;
      const branchId = clientRow?.branch_id ?? null;

      // 2. Insert the wallet transaction first — it's the source of
      //    truth for the customer's credit balance. The receipts row
      //    we create next references it via wallet_transaction_id, so
      //    the inverse direction (receipts → wallet) is always
      //    walkable from a single row.
      const { data: walletRow, error: walletErr } = await supabase
        .from('customer_wallet_transactions')
        .insert({
          client_id: client.id,
          transaction_type: 'refund',
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

      // 3. Allocate the user-facing C-number. Same RPC the cancel /
      //    transfer flows use, so the numbering is shared across the
      //    agency and stays gap-free per year.
      const year = new Date(issueDate).getFullYear();
      const { data: voucherNumber, error: numErr } = await supabase.rpc(
        'allocate_credit_note_number',
        { p_agent_id: agentId, p_year: year },
      );
      if (numErr) throw numErr;

      // 4. Insert the receipts row with both links populated. We DO
      //    NOT set policy_id — this is a standalone credit note, not
      //    tied to a specific policy. The kashf / wallet UIs handle
      //    null policy_id by attributing the credit to the customer
      //    as a whole.
      const { data: receiptRow, error: receiptErr } = await supabase
        .from('receipts')
        .insert({
          receipt_type: 'credit_note',
          source: 'auto',
          voucher_number: voucherNumber,
          client_id: client.id,
          client_name: client.full_name,
          wallet_transaction_id: walletRow?.id,
          amount: amt,
          receipt_date: issueDate,
          notes: description.trim(),
          agent_id: agentId,
          branch_id: branchId,
          created_by: user?.id ?? null,
        })
        .select('id')
        .single();
      if (receiptErr) throw receiptErr;

      toast.success(`تم إصدار إشعار دائن ${voucherNumber}`);
      onSaved({ receiptId: receiptRow!.id });
      onOpenChange(false);
    } catch (err: any) {
      console.error('[AddCreditNoteDialog] save failed:', err);
      toast.error(err?.message || 'فشل في حفظ إشعار الدائن');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      {/* Match AddSettlementDialog's container (max-w-3xl + 90vh
          scrollable) so the three voucher-creation flows feel like
          one family — same modal width, same paddings, same footer
          shape. The body is leaner than the disbursement dialog
          because credit notes don't need a payment-lines section
          (there's no cash moving). */}
      <DialogContent
        dir="rtl"
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-amber-600" />
            إضافة إشعار دائن — {client.full_name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Client banner — same role the "عميل" section plays in the
              disbursement dialog. Shows name + ID + phone so the agent
              confirms the right person before saving. */}
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
          </div>

          {/* Amount + date pair — mirrors the layout of the first row
              of every payment-line block in AddSettlementDialog, so
              the eye recognises the same pattern. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cn-amount" className="text-xs">المبلغ (₪)</Label>
              <Input
                id="cn-amount"
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
              <Label htmlFor="cn-date" className="text-xs">التاريخ</Label>
              <Input
                id="cn-date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="ltr-nums"
                dir="ltr"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cn-description" className="text-xs">السبب</Label>
            <Input
              id="cn-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثلاً: تعويض عن مبلغ زائد"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cn-notes" className="text-xs">ملاحظات (اختياري)</Label>
            <Textarea
              id="cn-notes"
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
