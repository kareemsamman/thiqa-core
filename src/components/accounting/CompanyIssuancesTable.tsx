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
import { useTableColumnVisibility } from '@/hooks/useTableColumnVisibility';
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave';
import { ManageColumnsDropdown, ColumnOption } from './ManageColumnsDropdown';
import { CalculationExplanationModal } from '@/components/reports/CalculationExplanationModal';
import { PolicyReceiptsDrawer } from './PolicyReceiptsDrawer';
import { PackageDetailsDrawer } from './PackageDetailsDrawer';
import { PolicyTypeBadge } from './PolicyTypeBadge';
import { IssuanceRow, PAYMENT_METHOD_LABELS } from './accountingTypes';

type Mode = 'company' | 'broker';

const COMPANY_COLUMNS: ColumnOption[] = [
  { key: 'document_number', label: 'رقم المعاملة', required: true },
  { key: 'receipts', label: 'سندات القبض' },
  { key: 'client_name', label: 'العميل' },
  { key: 'client_id_number', label: 'رقم هوية العميل' },
  { key: 'client_phone', label: 'رقم الهاتف' },
  { key: 'issue_date', label: 'تاريخ الإصدار' },
  { key: 'start_date', label: 'بدء التأمين' },
  { key: 'end_date', label: 'نهاية التأمين' },
  { key: 'car_number', label: 'رقم السيارة' },
  { key: 'car_value', label: 'سعر السيارة' },
  { key: 'payment_method', label: 'طريقة الدفع' },
  { key: 'company_name', label: 'شركة التأمين' },
  { key: 'policy_type', label: 'نوع التأمين' },
  { key: 'payed_for_company', label: 'المستحق للشركة' },
  { key: 'profit', label: 'الربح / العمولة' },
  { key: 'insurance_price', label: 'سعر التأمين' },
  { key: 'actions', label: 'إجراءات', required: true },
];

const BROKER_COLUMNS: ColumnOption[] = [
  { key: 'document_number', label: 'رقم المعاملة', required: true },
  { key: 'receipts', label: 'سندات القبض' },
  { key: 'client_name', label: 'العميل' },
  { key: 'client_id_number', label: 'رقم هوية العميل' },
  { key: 'client_phone', label: 'رقم الهاتف' },
  { key: 'issue_date', label: 'تاريخ الإصدار' },
  { key: 'start_date', label: 'بدء التأمين' },
  { key: 'end_date', label: 'نهاية التأمين' },
  { key: 'car_number', label: 'رقم السيارة' },
  { key: 'car_value', label: 'سعر السيارة' },
  { key: 'payment_method', label: 'طريقة الدفع' },
  { key: 'company_name', label: 'الوسيط / الشركة' },
  { key: 'policy_type', label: 'نوع التأمين' },
  { key: 'broker_buy_price', label: 'سعر الشراء من الوسيط' },
  { key: 'insurance_price', label: 'سعر البيع للعميل' },
  { key: 'profit', label: 'الربح' },
  { key: 'actions', label: 'إجراءات', required: true },
];

// Default = every column EXCEPT id_number / phone (user wants those off
// by default per round-2 feedback). The hook persists user toggles.
const DEFAULT_OFF = new Set(['client_id_number', 'client_phone']);

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
  onRowSaved?: (rowId: string) => void;
  storageId?: string;
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
  onRowSaved,
  storageId = 'accounting-company-issuances',
  pageSize = 10,
}: Props) {
  const COLUMNS = mode === 'broker' ? BROKER_COLUMNS : COMPANY_COLUMNS;
  const ALL_KEYS = COLUMNS.map((c) => c.key);
  const DEFAULT_VISIBLE = ALL_KEYS.filter((k) => !DEFAULT_OFF.has(k));
  // Bump suffix to "v2" so the new schema (document_number + ID/phone)
  // doesn't inherit a stale list that's missing the required columns.
  const versionedId = `${storageId}-v2`;
  const { visible, toggle, reset } = useTableColumnVisibility(
    versionedId,
    DEFAULT_VISIBLE,
    ALL_KEYS,
  );

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
      onRowSaved?.(policyId);
    },
    [onRowSaved],
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
        <div className="flex items-center justify-end gap-2 px-1">
          <span className="text-xs text-muted-foreground ml-auto">
            {loading ? '...' : `${rows.length} معاملة`}
          </span>
          <ManageColumnsDropdown
            columns={COLUMNS}
            visible={visible}
            onToggle={toggle}
            onReset={reset}
          />
        </div>

        <div className="rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
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
                    <TableHead className="whitespace-nowrap text-left sticky left-0 bg-white z-10 min-w-[120px] shadow-[-4px_0_8px_-6px_rgba(15,23,42,0.18)]">
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
                  paged.map((rawRow) => {
                    const row = view(rawRow);
                    const isElzami = row.main.policy_type_parent === 'ELZAMI';
                    const editable = !row.is_grouped;
                    return (
                      <TableRow
                        key={row.id}
                        className={cn(
                          'h-14 hover:bg-slate-50/60',
                          row.main.cancelled && 'bg-destructive/5 hover:bg-destructive/10',
                        )}
                      >
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
                            {row.primary_payment_method ? (
                              <Badge variant="outline" className="text-xs">
                                {PAYMENT_METHOD_LABELS[row.primary_payment_method] ?? row.primary_payment_method}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        )}

                        {showCol('company_name') && (
                          <TableCell className="text-sm max-w-[180px] truncate" title={row.main.company_name ?? ''}>
                            {row.main.company_name || '-'}
                          </TableCell>
                        )}

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
                          <TableCell className="sticky left-0 bg-white z-10 text-left shadow-[-4px_0_8px_-6px_rgba(15,23,42,0.18)]">
                            <div className="flex items-center gap-1">
                              {row.is_grouped && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 gap-1 hover:bg-slate-100"
                                  onClick={() => {
                                    setPackageRow(rawRow);
                                    setPackageOpen(true);
                                  }}
                                  title="تفاصيل الحزمة"
                                >
                                  <Layers className="h-3.5 w-3.5" />
                                  <span className="text-xs">تفاصيل</span>
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 gap-1 hover:bg-slate-100"
                                disabled={!row.main.company_id}
                                onClick={() => {
                                  setCalcRow(rawRow);
                                  setCalcOpen(true);
                                }}
                                title="معاينة المعاملة"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

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
        <TooltipContent side="top">{tip}</TooltipContent>
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
        <TooltipContent side="top">{tip}</TooltipContent>
      </Tooltip>
    );
  }
  return inner;
}
