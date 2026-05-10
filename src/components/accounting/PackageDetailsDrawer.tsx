import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { format, parseISO } from 'date-fns';
import { Layers } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave';
import { IssuanceRow, SubPolicy, policyTypeKey } from './accountingTypes';
import { PolicyTypeBadge } from './PolicyTypeBadge';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: IssuanceRow | null;
  /** company / broker — drives which money fields are editable. */
  mode: 'company' | 'broker';
  /** Bubble up after a successful save so the parent can patch its
   *  in-memory data optimistically (no full refetch). */
  onSubPolicySaved?: (subPolicyId: string, patch: SubPatch) => void;
}

interface SubPatch {
  insurance_price?: number;
  payed_for_company?: number;
  profit?: number;
  office_commission?: number;
  broker_buy_price?: number;
  manual_override?: boolean;
}

export function PackageDetailsDrawer({ open, onOpenChange, row, mode, onSubPolicySaved }: Props) {
  // Per-sub-policy local edits, used so the drawer reflects what the
  // user just typed before the auto-save flushes back via the parent.
  const [edits, setEdits] = useState<Record<string, SubPatch>>({});

  // Reset local edits whenever the drawer opens for a new row.
  // We deliberately key off `row?.id` (not `row`) so re-renders that
  // hand us a structurally-equal-but-new-reference row don't wipe
  // in-flight edits.
  const rowId = row?.id ?? null;
  useEffect(() => {
    if (open && rowId) setEdits({});
  }, [open, rowId]);

  const save = async (subId: string, patch: SubPatch) => {
    const { error } = await supabase.from('policies').update(patch).eq('id', subId);
    if (error) {
      toast.error(`فشل الحفظ: ${error.message}`);
      return;
    }
    toast.success('تم الحفظ', { duration: 1100 });
    onSubPolicySaved?.(subId, patch);
  };

  const debounced = useDebouncedAutoSave<SubPatch>(save, 600);

  const merge = (subId: string, patch: SubPatch) => {
    setEdits((prev) => ({ ...prev, [subId]: { ...(prev[subId] ?? {}), ...patch } }));
  };

  const update = (sub: SubPolicy, field: keyof SubPatch, raw: string) => {
    if (field === 'manual_override') return;
    const num = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(num)) return;
    // Money edits auto-lock the sub-policy from bulk recalculation.
    merge(sub.id, { [field]: num, manual_override: true });
    debounced.schedule(sub.id, { [field]: num, manual_override: true });
  };

  const valueOf = (sub: SubPolicy, field: keyof SubPatch, fallback: number): number => {
    const local = edits[sub.id]?.[field];
    if (local !== undefined && typeof local !== 'boolean') return local as number;
    return fallback;
  };

  // Drawer-level totals reflect local edits so the header tile updates
  // in real-time as the user types — no waiting on a refetch.
  // `broker_profit_total` is the broker-mode profit sum: for to_broker
  // subs it's the stored profit (= insurance_price - payed_for_company),
  // for from_broker subs it's the live `insurance_price - broker_buy_price`.
  const totals = row
    ? row.sub_policies.reduce(
        (acc, s) => {
          const ip = valueOf(s, 'insurance_price', Number(s.insurance_price ?? 0));
          const pf = valueOf(s, 'payed_for_company', Number(s.payed_for_company ?? 0));
          const pr = valueOf(s, 'profit', Number(s.profit ?? 0));
          const oc = valueOf(s, 'office_commission', Number(s.office_commission ?? 0));
          const bb = valueOf(s, 'broker_buy_price', Number(s.broker_buy_price ?? 0));
          acc.insurance_price += Number(ip);
          acc.payed_for_company += Number(pf);
          acc.profit += Number(pr);
          acc.office_commission += Number(oc);
          acc.broker_buy_price += Number(bb);
          if (s.broker_direction === 'to_broker') {
            acc.broker_profit_total += Number(pr);
          } else {
            acc.broker_profit_total += Math.max(0, Number(ip) - Number(bb));
          }
          return acc;
        },
        {
          insurance_price: 0,
          payed_for_company: 0,
          profit: 0,
          office_commission: 0,
          broker_buy_price: 0,
          broker_profit_total: 0,
        },
      )
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="space-y-1 text-right">
          <SheetTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            تفاصيل المعاملة
          </SheetTitle>
          {row && (
            <p className="text-xs text-muted-foreground">
              {row.client_name ? `${row.client_name} — ` : ''}
              معاملة {row.document_number ?? '—'}
            </p>
          )}
        </SheetHeader>

        {row && totals && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border bg-muted/30 px-4 py-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground">سعر التأمين الإجمالي</p>
                <p className="font-bold tabular-nums">₪{totals.insurance_price.toLocaleString('en-US')}</p>
              </div>
              {mode === 'company' ? (
                <>
                  <div>
                    <p className="text-[11px] text-muted-foreground">المستحق للشركات</p>
                    <p className="font-bold tabular-nums text-destructive">
                      ₪{totals.payed_for_company.toLocaleString('en-US')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">الربح + العمولات</p>
                    <p className="font-bold tabular-nums text-emerald-700">
                      ₪{(totals.profit + totals.office_commission).toLocaleString('en-US')}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-[11px] text-muted-foreground">سعر الشراء من الوسيط</p>
                    <p className="font-bold tabular-nums text-amber-700">
                      ₪{totals.broker_buy_price.toLocaleString('en-US')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">الربح</p>
                    <p className="font-bold tabular-nums text-emerald-700">
                      ₪{totals.broker_profit_total.toLocaleString('en-US')}
                    </p>
                  </div>
                </>
              )}
              <div>
                <p className="text-[11px] text-muted-foreground">عدد البنود</p>
                <p className="font-bold tabular-nums">{row.sub_policies.length}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground px-1">البنود</p>
              {row.sub_policies.map((sub) => {
                const isElzami = sub.policy_type_parent === 'ELZAMI';
                const insurancePrice = valueOf(sub, 'insurance_price', Number(sub.insurance_price ?? 0));
                const payedForCompany = valueOf(sub, 'payed_for_company', Number(sub.payed_for_company ?? 0));
                const profit = valueOf(sub, 'profit', Number(sub.profit ?? 0));
                const officeCommission = valueOf(sub, 'office_commission', Number(sub.office_commission ?? 0));
                const brokerBuyPrice = valueOf(sub, 'broker_buy_price', Number(sub.broker_buy_price ?? 0));
                const brokerProfit = Math.max(0, Number(insurancePrice) - Number(brokerBuyPrice));
                return (
                  <div key={sub.id} className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <PolicyTypeBadge
                        parent={sub.policy_type_parent}
                        child={sub.policy_type_child}
                      />
                      {sub.document_number && (
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {sub.document_number}
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">سعر التأمين</Label>
                        <Input
                          type="number"
                          value={insurancePrice}
                          onChange={(e) => update(sub, 'insurance_price', e.target.value)}
                          className="h-8 text-sm tabular-nums"
                        />
                      </div>
                      {mode === 'company' ? (
                        isElzami ? (
                          <div>
                            <Label className="text-[10px] text-muted-foreground">عمولة المكتب</Label>
                            <Input
                              type="number"
                              value={officeCommission}
                              onChange={(e) => update(sub, 'office_commission', e.target.value)}
                              className="h-8 text-sm tabular-nums text-emerald-700"
                            />
                          </div>
                        ) : (
                          <>
                            <div>
                              <Label className="text-[10px] text-muted-foreground">المستحق للشركة</Label>
                              <Input
                                type="number"
                                value={payedForCompany}
                                onChange={(e) => update(sub, 'payed_for_company', e.target.value)}
                                className="h-8 text-sm tabular-nums text-destructive"
                              />
                            </div>
                            <div className="col-span-2">
                              <Label className="text-[10px] text-muted-foreground">الربح</Label>
                              <Input
                                type="number"
                                value={profit}
                                onChange={(e) => update(sub, 'profit', e.target.value)}
                                className="h-8 text-sm tabular-nums text-emerald-700"
                              />
                            </div>
                          </>
                        )
                      ) : (
                        <>
                          <div>
                            <Label className="text-[10px] text-muted-foreground">سعر الشراء من الوسيط</Label>
                            <Input
                              type="number"
                              value={brokerBuyPrice}
                              onChange={(e) => update(sub, 'broker_buy_price', e.target.value)}
                              disabled={sub.broker_direction === 'to_broker'}
                              title={
                                sub.broker_direction === 'to_broker'
                                  ? 'البوليصة مباعة للوسيط — لا يوجد سعر شراء'
                                  : undefined
                              }
                              className="h-8 text-sm tabular-nums text-amber-700"
                            />
                          </div>
                          <div className="col-span-2">
                            <p className="text-[10px] text-muted-foreground">الربح (محسوب)</p>
                            <p className="h-8 inline-flex items-center font-semibold tabular-nums text-emerald-700">
                              ₪{(sub.broker_direction === 'to_broker'
                                ? Number(profit)
                                : brokerProfit
                              ).toLocaleString('en-US')}
                            </p>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>إصدار: {fmtDate(sub.issue_date ?? sub.start_date)}</span>
                      <span>·</span>
                      <span>سريان: {fmtDate(sub.start_date)} → {fmtDate(sub.end_date)}</span>
                    </div>
                    <span className="hidden">{policyTypeKey(sub.policy_type_parent, sub.policy_type_child)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try {
    return format(parseISO(d), 'dd/MM/yyyy');
  } catch {
    return d;
  }
}
