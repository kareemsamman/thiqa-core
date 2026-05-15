// ─── AddCompanyDebitNoteDialog ─────────────────────────────────
//
// "إشعار مدين" against an insurance company — the office records
// that the company owes us X (commission claw-back, refund pending,
// administrative reconciliation). This REDUCES المستحق للشركة the
// same way a سند صرف does, and can flip the balance to a credit
// (the شركة عندنا/رصيد دائن state).
//
// Mirror of AddCompanyCreditNoteDialog with two changes:
//   • receipt_type='debit_note' (the new type)
//   • allocate_debit_note_number → M{nn}/{year} voucher
//
// No wallet entry — companies don't carry a wallet table. The
// get_company_outstanding_summary RPC reads receipts directly to
// fold these into the outstanding total.

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
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
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
  onSaved: (info: { receiptId: string }) => void;
  cancelLabel?: string;
}

export function AddCompanyDebitNoteDialog({
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

      toast.success(`تم إصدار إشعار مدين ${voucherNumber}`);
      onSaved({ receiptId: (receiptRow as { id: string }).id });
      onOpenChange(false);
    } catch (err: any) {
      console.error('[AddCompanyDebitNoteDialog] save failed:', err);
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
            إضافة إشعار مدين — {displayName}
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
              </div>
            )}
            <p className="text-[11px] text-rose-700 dark:text-rose-400 mt-2 leading-relaxed">
              إشعار مدين على الشركة: تسجيل مبلغ مستحق علينا منها (استرداد عمولة،
              تعويض، تسوية). يقلل المستحق للشركة فوراً وقد يحوّله إلى رصيد دائن لدى الشركة.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cdn-amount" className="text-xs">المبلغ (₪)</Label>
              <Input
                id="cdn-amount"
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
            <Label htmlFor="cdn-description" className="text-xs">السبب</Label>
            <Input
              id="cdn-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثلاً: استرداد عمولة، تسوية فرق، اتفاق منتصف الفترة..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cdn-notes" className="text-xs">ملاحظات (اختياري)</Label>
            <Textarea
              id="cdn-notes"
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
