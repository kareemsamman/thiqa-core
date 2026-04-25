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
import { Loader2 } from 'lucide-react';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { BankPicker } from '@/components/shared/BankPicker';
import { CompactImagePicker } from '@/components/shared/CompactImagePicker';
import { sanitizeChequeNumber, validateChequeNumber } from '@/lib/chequeUtils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SettlementRow } from './SettlementsTable';

export type SettlementTable = 'company_settlements' | 'broker_settlements';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which table the row lives in. */
  table: SettlementTable;
  /** Row to edit. Most fields aren't on SettlementRow, so we lazy-load
   *  the full record when the dialog opens. */
  row: SettlementRow | null;
  onSaved: () => void;
}

interface EditableState {
  total_amount: number;
  settlement_date: string;
  payment_type: string;
  cheque_number: string;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url: string | null;
  bank_reference: string;
  notes: string;
}

const empty: EditableState = {
  total_amount: 0,
  settlement_date: '',
  payment_type: 'cash',
  cheque_number: '',
  bank_code: null,
  branch_code: null,
  cheque_image_url: null,
  bank_reference: '',
  notes: '',
};

/**
 * Compact "edit voucher" dialog. Surfaces the fields a user is most
 * likely to fix after the fact — amount, date, cheque-identification
 * triple, transfer reference, notes. The voucher's payment_type is
 * editable too, but switching it to/from `customer_cheque` is *not*
 * supported here because that involves consuming or releasing
 * customer cheques (use delete + re-add for that case).
 */
export function EditSettlementDialog({ open, onOpenChange, table, row, onSaved }: Props) {
  const [state, setState] = useState<EditableState>(empty);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from(table)
        .select(
          'total_amount, settlement_date, payment_type, cheque_number, bank_code, branch_code, cheque_image_url, bank_reference, notes',
        )
        .eq('id', row.id)
        .maybeSingle();
      if (!cancelled) {
        if (error || !data) {
          toast.error('فشل تحميل السند');
          onOpenChange(false);
        } else {
          const d = data as Record<string, unknown>;
          setState({
            total_amount: Number(d.total_amount ?? 0),
            settlement_date: (d.settlement_date as string) ?? '',
            payment_type: (d.payment_type as string) ?? 'cash',
            cheque_number: (d.cheque_number as string) ?? '',
            bank_code: (d.bank_code as string) ?? null,
            branch_code: (d.branch_code as string) ?? null,
            cheque_image_url: (d.cheque_image_url as string) ?? null,
            bank_reference: (d.bank_reference as string) ?? '',
            notes: (d.notes as string) ?? '',
          });
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, row, table, onOpenChange]);

  const save = async () => {
    if (!row) return;
    if (state.total_amount <= 0) {
      toast.error('المبلغ يجب أن يكون أكبر من صفر');
      return;
    }
    if (state.payment_type === 'cheque') {
      const v = validateChequeNumber(state.cheque_number);
      if (!v.isValid) {
        toast.error(v.error ?? 'رقم الشيك غير صحيح');
        return;
      }
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from(table)
        .update({
          total_amount: state.total_amount,
          settlement_date: state.settlement_date,
          payment_type: state.payment_type,
          cheque_number: state.payment_type === 'cheque' ? state.cheque_number || null : null,
          bank_code: state.payment_type === 'cheque' ? state.bank_code : null,
          branch_code: state.payment_type === 'cheque' ? state.branch_code : null,
          cheque_image_url: state.payment_type === 'cheque' ? state.cheque_image_url : null,
          bank_reference:
            state.payment_type === 'bank_transfer' ? state.bank_reference || null : null,
          notes: state.notes || null,
        } as never)
        .eq('id', row.id);
      if (error) throw error;
      toast.success('تم الحفظ');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل الحفظ';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent dir="rtl" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>تعديل السند</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px]">المبلغ</Label>
                <Input
                  type="number"
                  value={state.total_amount || ''}
                  onChange={(e) =>
                    setState({ ...state, total_amount: parseFloat(e.target.value) || 0 })
                  }
                  className="h-9 tabular-nums"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">التاريخ</Label>
                <ArabicDatePicker
                  value={state.settlement_date}
                  onChange={(v) => setState({ ...state, settlement_date: v ?? '' })}
                  compact
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">طريقة الدفع</Label>
                <select
                  value={state.payment_type}
                  onChange={(e) => setState({ ...state, payment_type: e.target.value })}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  <option value="cash">نقداً</option>
                  <option value="cheque">شيك جديد</option>
                  <option value="customer_cheque" disabled>
                    شيك عميل (غير قابل للتعديل هنا)
                  </option>
                  <option value="bank_transfer">تحويل بنكي</option>
                </select>
              </div>
            </div>

            {state.payment_type === 'cheque' && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5 min-w-0">
                    <Label className="text-[11px]">البنك</Label>
                    <BankPicker
                      value={state.bank_code}
                      onChange={(c) => setState({ ...state, bank_code: c })}
                    />
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <Label className="text-[11px]">الفرع</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="مثال: 305"
                      value={state.branch_code ?? ''}
                      onChange={(e) =>
                        setState({
                          ...state,
                          branch_code: e.target.value.replace(/\D/g, '') || null,
                        })
                      }
                      className="h-10 tabular-nums font-mono"
                    />
                  </div>
                  <div className="space-y-1.5 min-w-0">
                    <Label className="text-[11px]">رقم الشيك</Label>
                    <Input
                      value={state.cheque_number}
                      onChange={(e) =>
                        setState({
                          ...state,
                          cheque_number: sanitizeChequeNumber(e.target.value),
                        })
                      }
                      placeholder="12345678"
                      inputMode="numeric"
                      dir="ltr"
                      className="h-10 tabular-nums"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <CompactImagePicker
                    value={state.cheque_image_url}
                    onChange={(url) => setState({ ...state, cheque_image_url: url })}
                    entityType="settlement_cheque"
                    entityId={row?.id}
                    label="صورة الشيك"
                  />
                  <span>{state.cheque_image_url ? 'صورة مرفقة' : 'صورة الشيك (اختياري)'}</span>
                </div>
              </div>
            )}

            {state.payment_type === 'bank_transfer' && (
              <div className="space-y-1.5">
                <Label className="text-xs">رقم المرجع البنكي</Label>
                <Input
                  value={state.bank_reference}
                  onChange={(e) => setState({ ...state, bank_reference: e.target.value })}
                  placeholder="رقم الحوالة"
                  dir="ltr"
                  className="h-9"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">ملاحظات</Label>
              <Textarea
                rows={2}
                value={state.notes}
                onChange={(e) => setState({ ...state, notes: e.target.value })}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={saving || loading} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            حفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
