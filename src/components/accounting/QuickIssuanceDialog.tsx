import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Loader2, Search, X } from 'lucide-react';
import { addYears, format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CAR_POLICY_TYPES } from '@/components/policies/wizard/types';

export type IssuanceMode = 'issue' | 'return';

interface CompanyOption {
  id: string;
  name: string;
  name_ar: string | null;
  broker_id: string | null;
}

interface BrokerOption {
  id: string;
  name: string;
}

interface ClientLite {
  id: string;
  full_name: string;
  id_number: string;
  phone_number: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** issue = active policy, return = cancelled policy. Toggle inside. */
  defaultMode?: IssuanceMode;
  companies: CompanyOption[];
  brokers: BrokerOption[];
  onSaved: () => void;
}

interface FormState {
  mode: IssuanceMode;
  company_id: string;
  broker_id: string;
  client_id: string | null;
  client_label: string;
  document_number: string;
  policy_number: string;
  policy_type_parent: string;
  policy_type_child: string;
  issue_date: string;
  start_date: string;
  end_date: string;
  insurance_price: string;
  payed_for_company: string;
  profit: string;
  office_commission: string;
  notes: string;
}

const today = () => format(new Date(), 'yyyy-MM-dd');

const empty = (mode: IssuanceMode): FormState => ({
  mode,
  company_id: '',
  broker_id: '',
  client_id: null,
  client_label: '',
  document_number: '',
  policy_number: '',
  policy_type_parent: 'THIRD_FULL',
  policy_type_child: 'THIRD',
  issue_date: today(),
  start_date: today(),
  end_date: format(addYears(new Date(), 1), 'yyyy-MM-dd'),
  insurance_price: '',
  payed_for_company: '',
  profit: '',
  office_commission: '',
  notes: '',
});

/**
 * Quick single-policy entry from the accounting page. Two modes:
 *   - "issue": active policy (cancelled = false) — for one-off entries
 *     that don't fit the package builder
 *   - "return": مرتجع (cancelled = true) — for after-the-fact bookkeeping
 *     of a cancelled policy that was never created normally
 *
 * Numbers can go negative for returns (refund situations). Client + car
 * are optional since accounting entries don't always need a real client.
 */
export function QuickIssuanceDialog({
  open,
  onOpenChange,
  defaultMode = 'issue',
  companies,
  brokers,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(() => empty(defaultMode));
  const [saving, setSaving] = useState(false);

  // Reset whenever the dialog opens — useEffect on `open` so the next
  // open starts from a clean slate even if defaultMode hasn't changed.
  useEffect(() => {
    if (open) setForm(empty(defaultMode));
  }, [open, defaultMode]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const isThirdFull = form.policy_type_parent === 'THIRD_FULL';

  const title =
    form.mode === 'return' ? 'إضافة مرتجع يدوي' : 'إضافة إصدار يدوي';

  const handleSave = async () => {
    if (!form.policy_type_parent) {
      toast.error('اختر نوع التأمين');
      return;
    }
    if (!form.start_date || !form.end_date) {
      toast.error('أدخل تاريخ البدء والانتهاء');
      return;
    }
    if (!form.insurance_price || isNaN(parseFloat(form.insurance_price))) {
      toast.error('أدخل سعر التأمين');
      return;
    }
    if (isThirdFull && !form.policy_type_child) {
      toast.error('اختر ثالث أو شامل');
      return;
    }

    setSaving(true);
    try {
      const insertPayload: Record<string, unknown> = {
        company_id: form.company_id || null,
        broker_id: form.broker_id || null,
        client_id: form.client_id || null,
        document_number: form.document_number || null,
        policy_number: form.policy_number || null,
        policy_type_parent: form.policy_type_parent,
        policy_type_child: isThirdFull ? form.policy_type_child : null,
        issue_date: form.issue_date || form.start_date,
        start_date: form.start_date,
        end_date: form.end_date,
        insurance_price: parseFloat(form.insurance_price),
        payed_for_company: form.payed_for_company
          ? parseFloat(form.payed_for_company)
          : 0,
        profit: form.profit ? parseFloat(form.profit) : 0,
        office_commission: form.office_commission
          ? parseFloat(form.office_commission)
          : 0,
        notes: form.notes || null,
        cancelled: form.mode === 'return',
      };

      const { error } = await supabase.from('policies').insert(insertPayload as never);
      if (error) throw error;
      toast.success(form.mode === 'return' ? 'تم تسجيل المرتجع' : 'تم تسجيل الإصدار');
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
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode toggle — visually a segmented control. Tabs would be
              overkill for two options. */}
          <div className="inline-flex rounded-lg border bg-muted p-0.5">
            {(['issue', 'return'] as IssuanceMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => update('mode', m)}
                className={cn(
                  'px-4 h-9 text-sm rounded-md transition',
                  form.mode === m
                    ? 'bg-background shadow text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'issue' ? 'إصدار' : 'مرتجع'}
              </button>
            ))}
          </div>

          <Card className="p-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">شركة التأمين</Label>
                <Select
                  value={form.company_id}
                  onValueChange={(v) => update('company_id', v)}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="اختر شركة (اختياري)" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name_ar || c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">الوسيط</Label>
                <Select
                  value={form.broker_id || '__none'}
                  onValueChange={(v) => update('broker_id', v === '__none' ? '' : v)}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="بدون وسيط" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">بدون وسيط</SelectItem>
                    {brokers.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <ClientPicker
              clientId={form.client_id}
              clientLabel={form.client_label}
              onChange={(id, label) => {
                update('client_id', id);
                update('client_label', label);
              }}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">رقم المعاملة</Label>
                <Input
                  className="h-10"
                  value={form.document_number}
                  onChange={(e) => update('document_number', e.target.value)}
                  placeholder="اختياري"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">رقم البوليصة</Label>
                <Input
                  className="h-10"
                  value={form.policy_number}
                  onChange={(e) => update('policy_number', e.target.value)}
                  placeholder="اختياري"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">تاريخ الإصدار</Label>
                <ArabicDatePicker
                  value={form.issue_date}
                  onChange={(v) => update('issue_date', v ?? '')}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">نوع التأمين</Label>
                <Select
                  value={form.policy_type_parent}
                  onValueChange={(v) => update('policy_type_parent', v)}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAR_POLICY_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isThirdFull && (
                <div className="space-y-1.5">
                  <Label className="text-xs">الفئة الفرعية</Label>
                  <Select
                    value={form.policy_type_child}
                    onValueChange={(v) => update('policy_type_child', v)}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="THIRD">ثالث</SelectItem>
                      <SelectItem value="FULL">شامل</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5 md:col-span-1">
                <Label className="text-xs">تاريخ البدء</Label>
                <ArabicDatePicker
                  value={form.start_date}
                  onChange={(v) => update('start_date', v ?? '')}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">تاريخ الانتهاء</Label>
                <ArabicDatePicker
                  value={form.end_date}
                  onChange={(v) => update('end_date', v ?? '')}
                />
              </div>
            </div>
          </Card>

          <Card className="p-3 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground">المبالغ</div>
            <p className="text-[11px] text-muted-foreground">
              يمكن إدخال أرقام سالبة للمرتجعات (مثل: استرجاع ربح من شركة).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <NumField
                label="سعر التأمين"
                value={form.insurance_price}
                onChange={(v) => update('insurance_price', v)}
              />
              <NumField
                label="المستحق للشركة"
                value={form.payed_for_company}
                onChange={(v) => update('payed_for_company', v)}
              />
              <NumField
                label="الربح"
                value={form.profit}
                onChange={(v) => update('profit', v)}
              />
              <NumField
                label="عمولة المكتب"
                value={form.office_commission}
                onChange={(v) => update('office_commission', v)}
              />
            </div>
          </Card>

          <div className="space-y-1.5">
            <Label className="text-xs">ملاحظات</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder={form.mode === 'return' ? 'سبب الإلغاء…' : 'ملاحظات…'}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {form.mode === 'return' ? 'حفظ المرتجع' : 'حفظ الإصدار'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        dir="ltr"
        className="h-10 tabular-nums"
      />
    </div>
  );
}

/**
 * Inline client search — typing 2+ characters runs a debounced query
 * against `clients` matching name / id_number / phone. The selected
 * client renders as a clearable chip; clearing it lets the user save
 * without a client (the column is nullable).
 */
function ClientPicker({
  clientId,
  clientLabel,
  onChange,
}: {
  clientId: string | null;
  clientLabel: string;
  onChange: (id: string | null, label: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClientLite[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (clientId) {
      setQuery('');
      setResults([]);
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await supabase
          .from('clients')
          .select('id, full_name, id_number, phone_number')
          .or(
            `full_name.ilike.%${query}%,id_number.ilike.%${query}%,phone_number.ilike.%${query}%`,
          )
          .limit(8);
        setResults((data ?? []) as ClientLite[]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, clientId]);

  if (clientId) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">العميل</Label>
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <span className="text-sm">{clientLabel}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onChange(null, '')}
            aria-label="إزالة العميل"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">العميل (اختياري)</Label>
      <div className="relative">
        <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="h-10 pr-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث بالاسم أو الهوية أو الهاتف…"
        />
      </div>
      {searching && (
        <p className="text-[11px] text-muted-foreground">جاري البحث…</p>
      )}
      {!searching && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-[11px] text-muted-foreground">لا توجد نتائج</p>
      )}
      {results.length > 0 && (
        <div className="rounded-md border bg-card max-h-44 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id, `${c.full_name} · ${c.id_number}`)}
              className="w-full text-right px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-b-0"
            >
              <div className="font-medium">{c.full_name}</div>
              <div className="text-[11px] text-muted-foreground" dir="ltr">
                {c.id_number}
                {c.phone_number ? ` · ${c.phone_number}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
