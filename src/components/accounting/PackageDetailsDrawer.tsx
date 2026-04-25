import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';
import { Layers } from 'lucide-react';
import { IssuanceRow, policyTypeKey } from './accountingTypes';
import { PolicyTypeBadge } from './PolicyTypeBadge';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: IssuanceRow | null;
  /** company / broker — drives which money fields are shown. */
  mode: 'company' | 'broker';
}

export function PackageDetailsDrawer({ open, onOpenChange, row, mode }: Props) {
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

        {row && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border bg-muted/30 px-4 py-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[11px] text-muted-foreground">سعر التأمين الإجمالي</p>
                <p className="font-bold tabular-nums">₪{row.insurance_price.toLocaleString('en-US')}</p>
              </div>
              {mode === 'company' ? (
                <>
                  <div>
                    <p className="text-[11px] text-muted-foreground">المستحق للشركات</p>
                    <p className="font-bold tabular-nums text-destructive">
                      ₪{row.payed_for_company.toLocaleString('en-US')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">الربح + العمولات</p>
                    <p className="font-bold tabular-nums text-emerald-700">
                      ₪{(row.profit + row.office_commission).toLocaleString('en-US')}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-[11px] text-muted-foreground">سعر الشراء من الوسيط</p>
                    <p className="font-bold tabular-nums text-amber-700">
                      ₪{row.broker_buy_price.toLocaleString('en-US')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">الربح</p>
                    <p className="font-bold tabular-nums text-emerald-700">
                      ₪{Math.max(0, row.insurance_price - row.broker_buy_price).toLocaleString('en-US')}
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
                return (
                  <div key={sub.id} className="rounded-lg border p-3 space-y-2">
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

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">سعر التأمين</p>
                        <p className="font-semibold tabular-nums">
                          ₪{sub.insurance_price.toLocaleString('en-US')}
                        </p>
                      </div>
                      {mode === 'company' ? (
                        isElzami ? (
                          <div>
                            <p className="text-muted-foreground">عمولة المكتب</p>
                            <p className="font-semibold tabular-nums text-emerald-700">
                              ₪{Number(sub.office_commission ?? 0).toLocaleString('en-US')}
                            </p>
                          </div>
                        ) : (
                          <>
                            <div>
                              <p className="text-muted-foreground">المستحق للشركة</p>
                              <p className="font-semibold tabular-nums text-destructive">
                                ₪{Number(sub.payed_for_company ?? 0).toLocaleString('en-US')}
                              </p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-muted-foreground">الربح</p>
                              <p className="font-semibold tabular-nums text-emerald-700">
                                ₪{Number(sub.profit ?? 0).toLocaleString('en-US')}
                              </p>
                            </div>
                          </>
                        )
                      ) : (
                        <>
                          <div>
                            <p className="text-muted-foreground">سعر الشراء من الوسيط</p>
                            <p className="font-semibold tabular-nums text-amber-700">
                              ₪{Number(sub.broker_buy_price ?? 0).toLocaleString('en-US')}
                            </p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-muted-foreground">الربح</p>
                            <p className="font-semibold tabular-nums text-emerald-700">
                              ₪{Math.max(0, sub.insurance_price - Number(sub.broker_buy_price ?? 0)).toLocaleString('en-US')}
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
                    {/* policyTypeKey reference kept for future filter wiring */}
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
