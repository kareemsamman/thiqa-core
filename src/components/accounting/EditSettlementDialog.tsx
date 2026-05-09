import { useEffect, useState } from 'react';
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
import { Banknote, CreditCard, FileText, Loader2, Receipt, Wallet } from 'lucide-react';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { BankPicker } from '@/components/shared/BankPicker';
import { MultiImagePicker } from '@/components/shared/MultiImagePicker';
import { sanitizeChequeNumber, validateChequeNumber } from '@/lib/chequeUtils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SettlementRow } from './SettlementsTable';

const PAYMENT_TYPE_ICON = {
  cash: Banknote,
  cheque: FileText,
  customer_cheque: Wallet,
  bank_transfer: Receipt,
  visa: CreditCard,
} as const;

const PAYMENT_TYPE_LABEL = {
  cash: 'نقداً',
  cheque: 'شيك جديد',
  customer_cheque: 'شيك عميل',
  bank_transfer: 'تحويل بنكي',
  visa: 'فيزا',
} as const;

export type SettlementTable = 'company_settlements' | 'broker_settlements' | 'expenses';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which table the row lives in. expenses uses different column
   *  names (amount/expense_date/payment_method) but the dialog maps
   *  them onto the same shared editable state. */
  table: SettlementTable;
  /** Row to edit. Most fields aren't on SettlementRow, so we lazy-load
   *  the full record when the dialog opens. */
  row: SettlementRow | null;
  onSaved: () => void;
}

// Column-name differences between settlement tables and expenses.
// Centralised here so the rest of the dialog can keep working in
// "settlement" terms regardless of which table is being edited.
function tableColumns(t: SettlementTable) {
  if (t === 'expenses') {
    return {
      amountCol: 'amount',
      dateCol: 'expense_date',
      typeCol: 'payment_method',
    } as const;
  }
  return {
    amountCol: 'total_amount',
    dateCol: 'settlement_date',
    typeCol: 'payment_type',
  } as const;
}

interface EditableState {
  total_amount: number;
  settlement_date: string;
  /** Cheque-only: تاريخ الاستحقاق (when the cheque can be cashed). */
  cheque_due_date: string;
  /** Cheque-only: تاريخ الإصدار (when we wrote it / money left).
   *  Mirrored back into settlement_date on save so the ledger logic
   *  (which keys off settlement_date) keeps working unchanged. */
  cheque_issue_date: string;
  payment_type: string;
  cheque_number: string;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_urls: string[];
  bank_reference: string;
  notes: string;
}

const empty: EditableState = {
  total_amount: 0,
  settlement_date: '',
  cheque_due_date: '',
  cheque_issue_date: '',
  payment_type: 'cash',
  cheque_number: '',
  bank_code: null,
  branch_code: null,
  cheque_image_urls: [],
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
      const cols = tableColumns(table);
      const selectList = [
        `${cols.amountCol} as amount_val`,
        `${cols.dateCol} as date_val`,
        `${cols.typeCol} as type_val`,
        'cheque_due_date',
        'cheque_issue_date',
        'cheque_number',
        'bank_code',
        'branch_code',
        'cheque_image_url',
        'cheque_image_urls',
        'bank_reference',
        'notes',
      ].join(', ');
      const { data, error } = await supabase
        .from(table)
        .select(selectList)
        .eq('id', row.id)
        .maybeSingle();
      if (!cancelled) {
        if (error || !data) {
          toast.error('فشل تحميل السند');
          onOpenChange(false);
        } else {
          const d = data as Record<string, unknown>;
          // Treat the legacy single column as the first element when
          // the new array column is empty — this keeps old rows visible
          // until they're edited and migrated to the array.
          const arr = Array.isArray(d.cheque_image_urls)
            ? (d.cheque_image_urls as string[])
            : [];
          const single = (d.cheque_image_url as string) ?? null;
          const merged = arr.length > 0 ? arr : single ? [single] : [];
          const settlementDate = (d.date_val as string) ?? '';
          setState({
            total_amount: Number(d.amount_val ?? 0),
            settlement_date: settlementDate,
            // Pre-2026-05 rows have NULL in the new columns — fall back
            // to settlement_date so the picker isn't empty on legacy data.
            cheque_due_date: (d.cheque_due_date as string) ?? settlementDate,
            cheque_issue_date: (d.cheque_issue_date as string) ?? settlementDate,
            payment_type: (d.type_val as string) ?? 'cash',
            cheque_number: (d.cheque_number as string) ?? '',
            bank_code: (d.bank_code as string) ?? null,
            branch_code: (d.branch_code as string) ?? null,
            cheque_image_urls: merged,
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
      // For cheques, the issue date is the canonical "money left on this
      // day" timestamp — keep settlement_date in sync so the ledger and
      // any non-cheque-aware view keep showing the same date.
      const finalSettlementDate =
        state.payment_type === 'cheque'
          ? state.cheque_issue_date || state.settlement_date
          : state.settlement_date;
      const cols = tableColumns(table);
      const updatePayload: Record<string, unknown> = {
        [cols.amountCol]: state.total_amount,
        [cols.dateCol]: finalSettlementDate,
        [cols.typeCol]: state.payment_type,
        cheque_number: state.payment_type === 'cheque' ? state.cheque_number || null : null,
        bank_code: state.payment_type === 'cheque' ? state.bank_code : null,
        branch_code: state.payment_type === 'cheque' ? state.branch_code : null,
        cheque_due_date:
          state.payment_type === 'cheque'
            ? state.cheque_due_date || finalSettlementDate
            : null,
        cheque_issue_date:
          state.payment_type === 'cheque' ? finalSettlementDate : null,
        // Mirror first image into the legacy single column so older
        // viewers (list thumbnail, exports) keep working.
        cheque_image_url:
          state.payment_type === 'cheque' ? state.cheque_image_urls[0] ?? null : null,
        cheque_image_urls:
          state.payment_type === 'cheque' ? state.cheque_image_urls : [],
        bank_reference:
          state.payment_type === 'bank_transfer' ? state.bank_reference || null : null,
        notes: state.notes || null,
      };
      const { error } = await supabase
        .from(table)
        .update(updatePayload as never)
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

  const Icon =
    PAYMENT_TYPE_ICON[state.payment_type as keyof typeof PAYMENT_TYPE_ICON] ?? FileText;
  const typeLabel =
    PAYMENT_TYPE_LABEL[state.payment_type as keyof typeof PAYMENT_TYPE_LABEL] ?? 'دفعة';

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تعديل السند</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Card body mirrors AddSettlementDialog's PaymentLineCard so
                the edit and create flows feel like the same surface. */}
            <Card className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">{typeLabel}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px]">طريقة الدفع</Label>
                  <Select
                    value={state.payment_type}
                    onValueChange={(v) => setState({ ...state, payment_type: v })}
                    disabled={state.payment_type === 'customer_cheque'}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">نقداً</SelectItem>
                      <SelectItem value="cheque">شيك جديد</SelectItem>
                      <SelectItem value="customer_cheque" disabled>
                        شيك عميل (غير قابل للتعديل هنا)
                      </SelectItem>
                      <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
                      <SelectItem value="visa">فيزا</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px]">التاريخ</Label>
                  {state.payment_type === 'cheque' ? (
                    // Cheques get split issue/due pickers down in the
                    // cheque-specific section. Show the resolved issue
                    // date here as a read-only badge so the row still
                    // visually balances at 3 columns.
                    <div className="h-10 flex items-center px-3 rounded-md border border-input bg-muted/40 text-xs text-muted-foreground">
                      <span className="ltr-nums">{state.cheque_issue_date || '—'}</span>
                    </div>
                  ) : (
                    <ArabicDatePicker
                      value={state.settlement_date}
                      onChange={(v) => setState({ ...state, settlement_date: v ?? '' })}
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px]">المبلغ</Label>
                  <Input
                    type="number"
                    value={state.total_amount || ''}
                    onChange={(e) =>
                      setState({ ...state, total_amount: parseFloat(e.target.value) || 0 })
                    }
                    className="h-10 tabular-nums"
                    placeholder="0"
                    dir="ltr"
                  />
                </div>
              </div>

              {state.payment_type === 'cheque' && (
                <div className="space-y-3 border-t pt-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <Label className="text-[11px]">تاريخ الاستحقاق</Label>
                      <ArabicDatePicker
                        value={state.cheque_due_date}
                        onChange={(v) => setState({ ...state, cheque_due_date: v ?? '' })}
                      />
                    </div>
                    <div className="space-y-1.5 min-w-0">
                      <Label className="text-[11px]">تاريخ الإصدار</Label>
                      <ArabicDatePicker
                        value={state.cheque_issue_date}
                        onChange={(v) => setState({ ...state, cheque_issue_date: v ?? '' })}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <MultiImagePicker
                      value={state.cheque_image_urls}
                      onChange={(urls) => setState({ ...state, cheque_image_urls: urls })}
                      entityType="settlement_cheque"
                      entityId={row?.id}
                      label="صور الشيك"
                    />
                    <span>
                      {state.cheque_image_urls.length > 0
                        ? `${state.cheque_image_urls.length} صور مرفقة`
                        : 'صور الشيك (اختياري)'}
                    </span>
                  </div>
                </div>
              )}

              {state.payment_type === 'bank_transfer' && (
                <div className="space-y-1.5 border-t pt-3">
                  <Label className="text-[11px]">رقم المرجع البنكي</Label>
                  <Input
                    value={state.bank_reference}
                    onChange={(e) => setState({ ...state, bank_reference: e.target.value })}
                    placeholder="رقم الحوالة"
                    dir="ltr"
                    className="h-10"
                  />
                </div>
              )}
            </Card>

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
