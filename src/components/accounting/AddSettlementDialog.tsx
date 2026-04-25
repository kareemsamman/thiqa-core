import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
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
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { toast } from 'sonner';
import { CustomerChequeSelector, SelectableCheque } from '@/components/shared/CustomerChequeSelector';
import { sanitizeChequeNumber, validateChequeNumber } from '@/lib/chequeUtils';
import { cn } from '@/lib/utils';

export type SettlementMode = 'company' | 'broker';
export type SettlementKind = 'disbursement' | 'receipt';
export type PaymentLineType = 'cash' | 'cheque' | 'customer_cheque' | 'bank_transfer' | 'visa';

export interface SettlementEntity {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SettlementMode;
  kind: SettlementKind;
  /** Pre-selected entity id (skips the picker for that case). */
  defaultEntityId?: string | null;
  entities: SettlementEntity[];
  onSaved: () => void;
}

interface PaymentLine {
  id: string;
  payment_type: PaymentLineType;
  amount: number;
  payment_date: string;
  cheque_number?: string;
  bank_code?: string;
  branch_code?: string;
  bank_reference?: string;
  selected_cheques?: SelectableCheque[];
}

const PAYMENT_TYPE_LABEL: Record<PaymentLineType, string> = {
  cash: 'نقداً',
  cheque: 'شيك جديد',
  customer_cheque: 'شيك عميل',
  bank_transfer: 'تحويل بنكي',
  visa: 'بطاقة ائتمان',
};

function makeLine(): PaymentLine {
  return {
    id: crypto.randomUUID(),
    payment_type: 'cash',
    amount: 0,
    payment_date: format(new Date(), 'yyyy-MM-dd'),
  };
}

const titleFor = (mode: SettlementMode, kind: SettlementKind): string => {
  if (mode === 'company') {
    return kind === 'disbursement' ? 'إضافة سند صرف لشركة' : 'إضافة سند قبض من شركة';
  }
  return kind === 'disbursement' ? 'إضافة سند صرف لوسيط' : 'إضافة سند قبض من وسيط';
};

export function AddSettlementDialog({
  open,
  onOpenChange,
  mode,
  kind,
  defaultEntityId,
  entities,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const { agentId } = useAgentContext();
  const [entityId, setEntityId] = useState<string>(defaultEntityId ?? '');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PaymentLine[]>([makeLine()]);
  const [saving, setSaving] = useState(false);

  // Reset form whenever the dialog opens (or the mode/kind/default changes
  // while it's open — switching tabs underneath).
  useEffect(() => {
    if (!open) return;
    setEntityId(defaultEntityId ?? '');
    setNotes('');
    setLines([makeLine()]);
  }, [open, defaultEntityId, mode, kind]);

  const total = useMemo(
    () =>
      lines.reduce((s, l) => {
        if (l.payment_type === 'customer_cheque' && l.selected_cheques) {
          return s + l.selected_cheques.reduce((a, c) => a + Number(c.amount || 0), 0);
        }
        return s + Number(l.amount || 0);
      }, 0),
    [lines],
  );

  const updateLine = (id: string, patch: Partial<PaymentLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLine = (id: string) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.id !== id)));

  const addLine = () => setLines((prev) => [...prev, makeLine()]);

  const handleSave = async () => {
    if (!entityId) {
      toast.error(mode === 'company' ? 'الرجاء اختيار شركة' : 'الرجاء اختيار وسيط');
      return;
    }

    // Per-line validation
    for (const line of lines) {
      if (line.payment_type === 'cheque') {
        const v = validateChequeNumber(line.cheque_number ?? '');
        if (!v.isValid) {
          toast.error(v.error ?? 'رقم الشيك غير صحيح');
          return;
        }
      }
      if (line.payment_type === 'customer_cheque') {
        if (!line.selected_cheques || line.selected_cheques.length === 0) {
          toast.error('اختر شيك عميل واحد على الأقل');
          return;
        }
      } else if (!(line.amount > 0)) {
        toast.error('المبلغ يجب أن يكون أكبر من صفر');
        return;
      }
    }

    setSaving(true);
    try {
      for (const line of lines) {
        const isCustomerCheque = line.payment_type === 'customer_cheque';
        const customerChequeIds: string[] = isCustomerCheque
          ? (line.selected_cheques ?? []).map((c) => c.id)
          : [];
        const amount = isCustomerCheque
          ? (line.selected_cheques ?? []).reduce((s, c) => s + Number(c.amount || 0), 0)
          : Number(line.amount || 0);

        // Common fields shared across both settlement tables.
        const shared = {
          total_amount: amount,
          settlement_date: line.payment_date,
          status: 'completed' as const,
          notes: notes || null,
          created_by_admin_id: user?.id ?? null,
          agent_id: agentId ?? null,
          payment_type: line.payment_type,
          cheque_number: line.payment_type === 'cheque' ? line.cheque_number ?? null : null,
          bank_code: line.payment_type === 'cheque' ? line.bank_code ?? null : null,
          branch_code: line.payment_type === 'cheque' ? line.branch_code ?? null : null,
          bank_reference: line.payment_type === 'bank_transfer' ? line.bank_reference ?? null : null,
          customer_cheque_ids: customerChequeIds,
          refused: false,
        };

        let settlementId: string | null = null;
        if (mode === 'company') {
          const { data, error } = await supabase
            .from('company_settlements')
            .insert({
              ...shared,
              company_id: entityId,
              // Direction lets a single table track both وارد + صادر.
              direction: kind === 'disbursement' ? 'outgoing' : 'incoming',
            } as never)
            .select('id')
            .single();
          if (error) throw error;
          settlementId = (data as { id: string }).id;
        } else {
          const { data, error } = await supabase
            .from('broker_settlements')
            .insert({
              ...shared,
              broker_id: entityId,
              direction: kind === 'disbursement' ? 'we_owe' : 'broker_owes',
            } as never)
            .select('id')
            .single();
          if (error) throw error;
          settlementId = (data as { id: string }).id;
        }

        // Mark consumed customer cheques as transferred-out so they
        // don't show up as available for the next selector.
        if (isCustomerCheque && customerChequeIds.length > 0 && settlementId) {
          const { error: updateError } = await supabase
            .from('policy_payments')
            .update({
              cheque_status: 'transferred_out',
              transferred_to_type: mode,
              transferred_to_id: entityId,
              transferred_payment_id: settlementId,
              transferred_at: new Date().toISOString(),
            })
            .in('id', customerChequeIds);
          if (updateError) throw updateError;
        }
      }

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
      <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titleFor(mode, kind)}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Entity picker */}
          <div className="space-y-1.5">
            <Label className="text-xs">{mode === 'company' ? 'الشركة' : 'الوسيط'}</Label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger>
                <SelectValue placeholder={mode === 'company' ? 'اختر شركة' : 'اختر وسيط'} />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs">الوصف / ملاحظات</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="وصف السند..."
            />
          </div>

          {/* Payment lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">الدفعات</span>
              <Button type="button" variant="outline" size="sm" onClick={addLine} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                إضافة دفعة
              </Button>
            </div>

            {lines.map((line, idx) => (
              <PaymentLineCard
                key={line.id}
                index={idx}
                line={line}
                onChange={(patch) => updateLine(line.id, patch)}
                onRemove={lines.length > 1 ? () => removeLine(line.id) : undefined}
              />
            ))}
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-2.5">
            <span className="text-sm font-semibold">إجمالي السند:</span>
            <span className="text-lg font-bold tabular-nums">
              ₪{total.toLocaleString('en-US')}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {`حفظ (${lines.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentLineCard({
  index,
  line,
  onChange,
  onRemove,
}: {
  index: number;
  line: PaymentLine;
  onChange: (patch: Partial<PaymentLine>) => void;
  onRemove?: () => void;
}) {
  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">دفعة {index + 1}</span>
        {onRemove && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {line.payment_type !== 'customer_cheque' && (
          <div className="space-y-1.5">
            <Label className="text-[11px]">المبلغ</Label>
            <Input
              type="number"
              value={line.amount || ''}
              onChange={(e) => onChange({ amount: parseFloat(e.target.value) || 0 })}
              placeholder="0"
              dir="ltr"
              className="h-9"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-[11px]">التاريخ</Label>
          <ArabicDatePicker
            value={line.payment_date}
            onChange={(v) => onChange({ payment_date: v ?? '' })}
            compact
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px]">طريقة الدفع</Label>
          <Select
            value={line.payment_type}
            onValueChange={(v) => {
              const next: Partial<PaymentLine> = { payment_type: v as PaymentLineType };
              // Reset type-specific fields so stale values don't bleed across.
              if (v !== 'cheque') {
                next.cheque_number = undefined;
                next.bank_code = undefined;
                next.branch_code = undefined;
              }
              if (v !== 'bank_transfer') next.bank_reference = undefined;
              if (v !== 'customer_cheque') next.selected_cheques = undefined;
              if (v === 'customer_cheque') next.amount = 0;
              onChange(next);
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PAYMENT_TYPE_LABEL) as PaymentLineType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {PAYMENT_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {line.payment_type === 'cheque' && <ChequeFields line={line} onChange={onChange} />}

      {line.payment_type === 'customer_cheque' && (
        <div className="space-y-2 border-t pt-3">
          <Label className="text-xs">اختر شيكات العميل</Label>
          <CustomerChequeSelector
            selectedCheques={line.selected_cheques ?? []}
            onSelectionChange={(cheques) => {
              const sum = cheques.reduce((s, c) => s + Number(c.amount || 0), 0);
              onChange({ selected_cheques: cheques, amount: sum });
            }}
          />
        </div>
      )}

      {line.payment_type === 'bank_transfer' && (
        <div className="space-y-1.5">
          <Label className="text-[11px]">رقم المرجع البنكي</Label>
          <Input
            value={line.bank_reference ?? ''}
            onChange={(e) => onChange({ bank_reference: e.target.value })}
            placeholder="رقم الحوالة"
            className="h-9"
            dir="ltr"
          />
        </div>
      )}
    </Card>
  );
}

function ChequeFields({
  line,
  onChange,
}: {
  line: PaymentLine;
  onChange: (patch: Partial<PaymentLine>) => void;
}) {
  // Live duplicate-detection across every surface that stores cheques.
  const [duplicate, setDuplicate] = useState<string | null>(null);
  useEffect(() => {
    if (!line.cheque_number || !line.bank_code) {
      setDuplicate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const existing = await findExistingCheque(line.cheque_number ?? '', line.bank_code ?? null);
      if (!cancelled) setDuplicate(existing);
    })();
    return () => {
      cancelled = true;
    };
  }, [line.cheque_number, line.bank_code]);

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[11px]">رقم الشيك</Label>
          <Input
            value={line.cheque_number ?? ''}
            onChange={(e) => onChange({ cheque_number: sanitizeChequeNumber(e.target.value) })}
            placeholder="12345678"
            inputMode="numeric"
            dir="ltr"
            className={cn('h-9 tabular-nums', duplicate && 'border-amber-500 ring-1 ring-amber-200')}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px]">رقم البنك</Label>
          <Input
            value={line.bank_code ?? ''}
            onChange={(e) => onChange({ bank_code: e.target.value.replace(/\D/g, '').slice(0, 3) })}
            placeholder="11"
            inputMode="numeric"
            dir="ltr"
            className="h-9 tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px]">رقم الفرع</Label>
          <Input
            value={line.branch_code ?? ''}
            onChange={(e) => onChange({ branch_code: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            placeholder="123"
            inputMode="numeric"
            dir="ltr"
            className="h-9 tabular-nums"
          />
        </div>
      </div>
      {duplicate && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
          ⚠ هذا الشيك مسجل مسبقاً في النظام: {duplicate}
        </p>
      )}
    </div>
  );
}

/**
 * Cross-surface duplicate detection. We keyed every cheque-bearing
 * table with `(cheque_number, bank_code)` indexes in the migration so
 * this stays cheap. Returns a human-readable description of the first
 * existing match, or null.
 */
async function findExistingCheque(
  chequeNumber: string,
  bankCode: string | null,
): Promise<string | null> {
  if (!chequeNumber || chequeNumber.length < 4) return null;
  const matchBank = (q: ReturnType<typeof supabase.from>) =>
    bankCode ? q.eq('bank_code', bankCode) : q.is('bank_code', null);

  const [{ data: cs }, { data: bs }, { data: ex }, { data: pp }] = await Promise.all([
    matchBank(
      supabase.from('company_settlements').select('id, settlement_date').eq('cheque_number', chequeNumber).limit(1),
    ),
    matchBank(
      supabase.from('broker_settlements').select('id, settlement_date').eq('cheque_number', chequeNumber).limit(1),
    ),
    matchBank(
      supabase.from('expenses').select('id, expense_date').eq('cheque_number', chequeNumber).limit(1),
    ),
    matchBank(
      supabase.from('policy_payments').select('id, payment_date').eq('cheque_number', chequeNumber).limit(1),
    ),
  ]);

  if (cs && cs.length) return `سند صرف شركة بتاريخ ${cs[0].settlement_date}`;
  if (bs && bs.length) return `سند وسيط بتاريخ ${bs[0].settlement_date}`;
  if (ex && ex.length) return `مصروف بتاريخ ${ex[0].expense_date}`;
  if (pp && pp.length) return `دفعة عميل بتاريخ ${pp[0].payment_date}`;
  return null;
}
