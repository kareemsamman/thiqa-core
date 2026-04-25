import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChevronLeft, ChevronRight, Eye, FileText, Layers, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave';
import { CalculationExplanationModal } from '@/components/reports/CalculationExplanationModal';
import { PolicyReceiptsDrawer } from './PolicyReceiptsDrawer';
import { PackageDetailsDrawer } from './PackageDetailsDrawer';
import { PolicyTypeBadge } from './PolicyTypeBadge';
import { StickyHorizontalScroll } from './StickyHorizontalScroll';
import { IssuanceRow, PAYMENT_METHOD_LABELS } from './accountingTypes';

type Mode = 'company' | 'broker';

interface CompanyForCalc {
  id: string;
  name: string;
  name_ar: string | null;
}

interface Props {
  rows: IssuanceRow[];
  companies: CompanyForCalc[];
  loading: boolean;
  mode: Mode;
  /** Controlled visibility — section owns the column-visibility state. */
  visible: string[];
  onRowSaved?: (rowId: string) => void;
  pageSize?: number;
}

interface PolicyPatch {
  insurance_price?: number;
  payed_for_company?: number;
  profit?: number;
  office_commission?: number;
  broker_buy_price?: number;
  issue_date?: string | null;
  start_date?: string;
  end_date?: string;
}

interface CarPatch {
  car_value?: number;
}

export function CompanyIssuancesTable({
  rows,
  companies,
  loading,
  mode,
  visible,
  onRowSaved,
  pageSize = 10,
}: Props) {
  const [calcRow, setCalcRow] = useState<IssuanceRow | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [drawerRow, setDrawerRow] = useState<IssuanceRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [packageRow, setPackageRow] = useState<IssuanceRow | null>(null);
  const [packageOpen, setPackageOpen] = useState(false);
  const [editLocal, setEditLocal] = useState<Record<string, PolicyPatch & CarPatch>>({});
  const [page, setPage] = useState(1);

  const savePolicy = useMemo(
    () => async (policyId: string, patch: PolicyPatch) => {
      const { error } = await supabase.from('policies').update(patch).eq('id', policyId);
      if (error) {
        toast.error(`فشل الحفظ: ${error.message}`);
        return;
      }
      toast.success('تم الحفظ', { duration: 1200 });
      // Inline edits skip the parent refresh on purpose — local state in
      // `editLocal` already reflects the change, and re-fetching the
      // whole table would steal focus / scroll on every keystroke save.
    },
    [],
  );

  const saveCar = useMemo(
    () => async (carId: string, patch: CarPatch) => {
      const { error } = await supabase.from('cars').update(patch).eq('id', carId);
      if (error) {
        toast.error(`فشل حفظ السيارة: ${error.message}`);
        return;
      }
      toast.success('تم الحفظ', { duration: 1200 });
    },
    [],
  );

  const policyDebounced = useDebouncedAutoSave<PolicyPatch>(savePolicy, 600);
  const carDebounced = useDebouncedAutoSave<CarPatch>(saveCar, 600);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const merge = (rowId: string, patch: PolicyPatch & CarPatch) =>
    setEditLocal((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] ?? {}), ...patch } }));

  const showCol = (key: string) => visible.includes(key);
  const visibleCount = visible.length;

  const updateNumericField = (
    row: IssuanceRow,
    field: keyof PolicyPatch,
    raw: string,
  ) => {
    if (row.is_grouped) return;
    const num = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(num)) return;
    merge(row.id, { [field]: num });
    policyDebounced.schedule(row.main.id, { [field]: num });
  };

  const updateDateField = (row: IssuanceRow, field: 'issue_date' | 'start_date' | 'end_date', raw: string) => {
    if (row.is_grouped) return;
    merge(row.id, { [field]: raw });
    policyDebounced.schedule(row.main.id, { [field]: raw || null });
  };

  const updateCarValue = (row: IssuanceRow, raw: string) => {
    if (!row.main.car_id || row.is_grouped) return;
    const num = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(num)) return;
    merge(row.id, { car_value: num });
    carDebounced.schedule(row.main.car_id, { car_value: num });
  };

  const view = (row: IssuanceRow): IssuanceRow => {
    const local = editLocal[row.id];
    if (!local) return row;
    const next: IssuanceRow = { ...row, main: { ...row.main } };
    if ('insurance_price' in local) {
      next.insurance_price = Number(local.insurance_price ?? row.insurance_price);
      next.main.insurance_price = next.insurance_price;
    }
    if ('payed_for_company' in local) {
      next.payed_for_company = Number(local.payed_for_company ?? row.payed_for_company);
      next.main.payed_for_company = next.payed_for_company;
    }
    if ('profit' in local) {
      next.profit = Number(local.profit ?? row.profit);
      next.main.profit = next.profit;
    }
    if ('office_commission' in local) {
      next.office_commission = Number(local.office_commission ?? row.office_commission);
      next.main.office_commission = next.office_commission;
    }
    if ('broker_buy_price' in local) {
      next.broker_buy_price = Number(local.broker_buy_price ?? row.broker_buy_price);
      next.main.broker_buy_price = next.broker_buy_price;
    }
    if ('issue_date' in local) next.main.issue_date = local.issue_date ?? null;
    if ('start_date' in local && local.start_date) next.main.start_date = local.start_date;
    if ('end_date' in local && local.end_date) next.main.end_date = local.end_date;
    if ('car_value' in local) next.main.car_value = Number(local.car_value ?? row.main.car_value);
    return next;
  };

  const calcCompany = useMemo(() => {
    if (!calcRow?.main.company_id) return null;
    return companies.find((c) => c.id === calcRow.main.company_id) ?? null;
  }, [calcRow, companies]);

  const disabledTip = 'تعديل الحزمة من أيقونة "تفاصيل" — لكل بند قيمته الخاصة';

  return (
    <TooltipProvider delayDuration={250}>
      <div className="space-y-2.5">
        <div className="rounded-lg border bg-card">
          <StickyHorizontalScroll>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {showCol('row_number') && (
                    <TableHead className="whitespace-nowrap w-12 text-center text-xs">#</TableHead>
                  )}
                  {showCol('document_number') && (
                    <TableHead className="whitespace-nowrap min-w-[140px]">رقم المعاملة</TableHead>
                  )}
                  {showCol('receipts') && <TableHead className="whitespace-nowrap min-w-[120px]">سندات القبض</TableHead>}
                  {showCol('client_name') && <TableHead className="whitespace-nowrap min-w-[160px]">العميل</TableHead>}
                  {showCol('client_id_number') && <TableHead className="whitespace-nowrap min-w-[140px]">رقم الهوية</TableHead>}
                  {showCol('client_phone') && <TableHead className="whitespace-nowrap min-w-[140px]">رقم الهاتف</TableHead>}
                  {showCol('issue_date') && <TableHead className="whitespace-nowrap min-w-[160px]">تاريخ الإصدار</TableHead>}
                  {showCol('start_date') && <TableHead className="whitespace-nowrap min-w-[160px]">بدء التأمين</TableHead>}
                  {showCol('end_date') && <TableHead className="whitespace-nowrap min-w-[160px]">نهاية التأمين</TableHead>}
                  {showCol('car_number') && <TableHead className="whitespace-nowrap min-w-[120px]">رقم السيارة</TableHead>}
                  {showCol('car_value') && <TableHead className="whitespace-nowrap min-w-[120px]">سعر السيارة</TableHead>}
                  {showCol('payment_method') && <TableHead className="whitespace-nowrap min-w-[120px]">طريقة الدفع</TableHead>}
                  {showCol('company_name') && <TableHead className="whitespace-nowrap min-w-[160px]">{mode === 'broker' ? 'الوسيط / الشركة' : 'شركة التأمين'}</TableHead>}
                  {showCol('policy_type') && <TableHead className="whitespace-nowrap min-w-[110px]">نوع التأمين</TableHead>}
                  {mode === 'company' && showCol('payed_for_company') && (
                    <TableHead className="whitespace-nowrap min-w-[140px]">المستحق للشركة</TableHead>
                  )}
                  {mode === 'broker' && showCol('broker_buy_price') && (
                    <TableHead className="whitespace-nowrap min-w-[160px]">سعر الشراء من الوسيط</TableHead>
                  )}
                  {mode === 'broker' && showCol('insurance_price') && (
                    <TableHead className="whitespace-nowrap min-w-[140px]">سعر البيع للعميل</TableHead>
                  )}
                  {showCol('profit') && (
                    <TableHead className="whitespace-nowrap min-w-[140px]">
                      {mode === 'broker' ? 'الربح' : 'الربح / العمولة'}
                    </TableHead>
                  )}
                  {mode === 'company' && showCol('insurance_price') && (
                    <TableHead className="whitespace-nowrap min-w-[140px]">سعر التأمين</TableHead>
                  )}
                  {showCol('actions') && (
                    <TableHead className="whitespace-nowrap text-center sticky left-0 bg-slate-100/95 border-l z-10 w-20 min-w-[80px] px-1">
                      إجراءات
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={`sk-${i}`} className="hover:bg-transparent">
                      {Array.from({ length: visibleCount }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-7 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : paged.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={visibleCount} className="text-center py-12 text-muted-foreground">
                      <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">لا توجد معاملات</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.map((rawRow, idx) => {
                    const row = view(rawRow);
                    const isElzami = row.main.policy_type_parent === 'ELZAMI';
                    const editable = !row.is_grouped;
                    const rowNumber = (safePage - 1) * pageSize + idx + 1;
                    return (
                      <TableRow
                        key={row.id}
                        className={cn(
                          'h-14 hover:bg-slate-50/60',
                          row.main.cancelled && 'bg-destructive/5 hover:bg-destructive/10',
                        )}
                      >
                        {showCol('row_number') && (
                          <TableCell className="text-center text-xs text-muted-foreground tabular-nums">
                            {rowNumber}
                          </TableCell>
                        )}
                        {showCol('document_number') && (
                          <TableCell className="font-mono text-sm">
                            <span>{row.document_number ?? '—'}</span>
                          </TableCell>
                        )}

                        {showCol('receipts') && (
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => {
                                setDrawerRow(rawRow);
                                setDrawerOpen(true);
                              }}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                                row.receipts_count > 0
                                  ? 'border-emerald-500/30 text-emerald-700 bg-emerald-500/5 hover:bg-emerald-500/10'
                                  : 'border-dashed text-muted-foreground hover:bg-slate-50',
                              )}
                            >
                              <Receipt className="h-3.5 w-3.5" />
                              {row.receipts_count > 0 ? `${row.receipts_count} سند` : 'لا يوجد'}
                            </button>
                          </TableCell>
                        )}

                        {showCol('client_name') && (
                          <TableCell className="text-sm max-w-[180px] truncate" title={row.client_name ?? ''}>
                            {row.client_name || '-'}
                          </TableCell>
                        )}
                        {showCol('client_id_number') && (
                          <TableCell className="font-mono text-xs">
                            {row.client_id_number || '-'}
                          </TableCell>
                        )}
                        {showCol('client_phone') && (
                          <TableCell className="font-mono text-xs" dir="ltr">
                            {row.client_phone || '-'}
                          </TableCell>
                        )}

                        {showCol('issue_date') && (
                          <TableCell>
                            <DateCell
                              value={row.main.issue_date ?? ''}
                              disabled={!editable}
                              onChange={(v) => updateDateField(rawRow, 'issue_date', v)}
                              tip={disabledTip}
                            />
                          </TableCell>
                        )}
                        {showCol('start_date') && (
                          <TableCell>
                            <DateCell
                              value={row.main.start_date}
                              disabled={!editable}
                              onChange={(v) => updateDateField(rawRow, 'start_date', v)}
                              tip={disabledTip}
                            />
                          </TableCell>
                        )}
                        {showCol('end_date') && (
                          <TableCell>
                            <DateCell
                              value={row.main.end_date}
                              disabled={!editable}
                              onChange={(v) => updateDateField(rawRow, 'end_date', v)}
                              tip={disabledTip}
                            />
                          </TableCell>
                        )}

                        {showCol('car_number') && (
                          <TableCell className="text-sm">{row.main.car_number || '-'}</TableCell>
                        )}
                        {showCol('car_value') && (
                          <TableCell>
                            <NumberCell
                              value={row.main.car_value ?? 0}
                              disabled={!editable || !row.main.car_id}
                              onChange={(v) => updateCarValue(rawRow, v)}
                              tip={!row.main.car_id ? 'لا توجد سيارة مرتبطة' : disabledTip}
                            />
                          </TableCell>
                        )}

                        {showCol('payment_method') && (
                          <TableCell>
                            {(() => {
                              // ELZAMI premiums are always paid on the
                              // company portal with the customer's own
                              // card — render as "فيزا خارجي" regardless
                              // of whether a policy_payments row exists
                              // yet (matches getPaymentTypeLabel).
                              const label = isElzami
                                ? 'فيزا خارجي'
                                : row.primary_payment_method
                                ? PAYMENT_METHOD_LABELS[row.primary_payment_method] ??
                                  row.primary_payment_method
                                : null;
                              return label ? (
                                <Badge variant="outline" className="text-xs">{label}</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              );
                            })()}
                          </TableCell>
                        )}

                        {showCol('company_name') && (() => {
                          // Count distinct companies across the group. The
                          // main name is shown literally; if there are
                          // others, render a "+N" pill that opens the
                          // package drawer (mirrors the type column).
                          const companyNames = Array.from(
                            new Set(
                              row.sub_policies
                                .map((s) => s.company_name)
                                .filter((n): n is string => !!n),
                            ),
                          );
                          const otherCount = Math.max(0, companyNames.length - 1);
                          return (
                            <TableCell className="text-sm max-w-[200px]">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate" title={row.main.company_name ?? ''}>
                                  {row.main.company_name || '-'}
                                </span>
                                {otherCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPackageRow(rawRow);
                                      setPackageOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 shrink-0"
                                    title="عرض كل شركات الحزمة"
                                  >
                                    <Layers className="h-3 w-3" />
                                    +{otherCount}
                                  </button>
                                )}
                              </div>
                            </TableCell>
                          );
                        })()}

                        {showCol('policy_type') && (
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <PolicyTypeBadge
                                parent={row.main.policy_type_parent}
                                child={row.main.policy_type_child}
                              />
                              {row.is_grouped && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPackageRow(rawRow);
                                    setPackageOpen(true);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                                  title="عرض كل بنود الحزمة"
                                >
                                  <Layers className="h-3 w-3" />
                                  +{row.sub_policies.length - 1}
                                </button>
                              )}
                            </div>
                          </TableCell>
                        )}

                        {mode === 'company' && showCol('payed_for_company') && (
                          <TableCell>
                            {isElzami ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <NumberCell
                                value={row.payed_for_company ?? 0}
                                disabled={!editable}
                                onChange={(v) => updateNumericField(rawRow, 'payed_for_company', v)}
                                tone="destructive"
                                tip={disabledTip}
                              />
                            )}
                          </TableCell>
                        )}

                        {mode === 'broker' && showCol('broker_buy_price') && (
                          <TableCell>
                            <NumberCell
                              value={row.broker_buy_price ?? 0}
                              disabled={!editable}
                              onChange={(v) => updateNumericField(rawRow, 'broker_buy_price', v)}
                              tone="amber"
                              tip={disabledTip}
                            />
                          </TableCell>
                        )}

                        {mode === 'broker' && showCol('insurance_price') && (
                          <TableCell>
                            <NumberCell
                              value={row.insurance_price ?? 0}
                              disabled={!editable}
                              onChange={(v) => updateNumericField(rawRow, 'insurance_price', v)}
                              tone="strong"
                              tip={disabledTip}
                            />
                          </TableCell>
                        )}

                        {showCol('profit') && (
                          <TableCell>
                            {mode === 'broker' ? (
                              <span className="font-semibold tabular-nums text-emerald-700">
                                ₪{Math.max(0, row.insurance_price - row.broker_buy_price).toLocaleString('en-US')}
                              </span>
                            ) : (
                              <NumberCell
                                value={isElzami ? row.office_commission ?? 0 : row.profit ?? 0}
                                disabled={!editable}
                                onChange={(v) =>
                                  updateNumericField(
                                    rawRow,
                                    isElzami ? 'office_commission' : 'profit',
                                    v,
                                  )
                                }
                                tone="emerald"
                                tip={disabledTip}
                              />
                            )}
                          </TableCell>
                        )}

                        {mode === 'company' && showCol('insurance_price') && (
                          <TableCell>
                            <NumberCell
                              value={row.insurance_price ?? 0}
                              disabled={!editable}
                              onChange={(v) => updateNumericField(rawRow, 'insurance_price', v)}
                              tone="strong"
                              tip={disabledTip}
                            />
                          </TableCell>
                        )}

                        {showCol('actions') && (
                          <TableCell className="sticky left-0 bg-slate-50/95 border-l z-10 px-1 w-20 min-w-[80px]">
                            <div className="flex items-center justify-center gap-0.5">
                              {row.is_grouped ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 hover:bg-slate-200/60"
                                      onClick={() => {
                                        setPackageRow(rawRow);
                                        setPackageOpen(true);
                                      }}
                                    >
                                      <Layers className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="whitespace-nowrap">تفاصيل الحزمة</TooltipContent>
                                </Tooltip>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 opacity-40 cursor-not-allowed"
                                        disabled
                                      >
                                        <Layers className="h-3.5 w-3.5" />
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="whitespace-nowrap">
                                    معاملة فردية — لا توجد بنود متعددة
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 hover:bg-slate-200/60"
                                      disabled={!row.main.company_id}
                                      onClick={() => {
                                        setCalcRow(rawRow);
                                        setCalcOpen(true);
                                      }}
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="whitespace-nowrap">معاينة المعاملة</TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </StickyHorizontalScroll>

          {!loading && rows.length > pageSize && (
            <div className="flex items-center justify-between border-t px-4 py-2.5">
              <p className="text-xs text-muted-foreground">
                {rows.length} معاملة · صفحة {safePage} من {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <CalculationExplanationModal
          open={calcOpen}
          onOpenChange={setCalcOpen}
          policy={
            calcRow
              ? {
                  id: calcRow.main.id,
                  policy_type_parent: calcRow.main.policy_type_parent,
                  policy_type_child: calcRow.main.policy_type_child,
                  insurance_price: Number(view(calcRow).insurance_price),
                  payed_for_company: view(calcRow).payed_for_company ?? null,
                  profit: view(calcRow).profit ?? null,
                  is_under_24: calcRow.main.is_under_24 ?? null,
                  car: calcRow.main.car_id
                    ? {
                        id: calcRow.main.car_id,
                        car_number: calcRow.main.car_number ?? '',
                        car_type: calcRow.main.car_type,
                        car_value: view(calcRow).main.car_value ?? null,
                        year: calcRow.main.car_year,
                      }
                    : null,
                }
              : null
          }
          company={calcCompany}
        />

        <PolicyReceiptsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          policyId={drawerRow?.main.id ?? null}
          policyNumber={drawerRow?.document_number ?? null}
          clientName={drawerRow?.client_name ?? null}
        />

        <PackageDetailsDrawer
          open={packageOpen}
          onOpenChange={setPackageOpen}
          row={packageRow}
          mode={mode}
          onSubPolicySaved={(id) => onRowSaved?.(id)}
        />
      </div>
    </TooltipProvider>
  );
}

// Inline date cell — wraps ArabicDatePicker compact + tooltip on disabled.
function DateCell({
  value,
  onChange,
  disabled,
  tip,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  tip?: string;
}) {
  const inner = (
    <div className="w-[150px]">
      <ArabicDatePicker
        value={value}
        onChange={(v) => onChange(v ?? '')}
        disabled={disabled}
        compact
      />
    </div>
  );
  if (disabled && tip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{inner}</div>
        </TooltipTrigger>
        <TooltipContent side="top" className="whitespace-nowrap">{tip}</TooltipContent>
      </Tooltip>
    );
  }
  return inner;
}

function NumberCell({
  value,
  onChange,
  disabled,
  tone,
  tip,
}: {
  value: number;
  onChange: (v: string) => void;
  disabled?: boolean;
  tone?: 'destructive' | 'emerald' | 'amber' | 'strong';
  tip?: string;
}) {
  const cls =
    tone === 'destructive'
      ? 'text-destructive'
      : tone === 'emerald'
      ? 'text-emerald-700'
      : tone === 'amber'
      ? 'text-amber-700'
      : tone === 'strong'
      ? 'font-semibold'
      : '';
  const inner = (
    <Input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn('h-8 text-sm w-[110px] tabular-nums', cls)}
    />
  );
  if (disabled && tip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{inner}</div>
        </TooltipTrigger>
        <TooltipContent side="top" className="whitespace-nowrap">{tip}</TooltipContent>
      </Tooltip>
    );
  }
  return inner;
}
