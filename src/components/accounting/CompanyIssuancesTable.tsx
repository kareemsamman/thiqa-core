import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Calculator, FileText, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useTableColumnVisibility } from '@/hooks/useTableColumnVisibility';
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave';
import { ManageColumnsDropdown, ColumnOption } from './ManageColumnsDropdown';
import { CalculationExplanationModal } from '@/components/reports/CalculationExplanationModal';
import { PolicyReceiptsDrawer } from './PolicyReceiptsDrawer';
import {
  IssuanceRow,
  PAYMENT_METHOD_LABELS,
  policyTypeLabel,
} from './accountingTypes';

// All columns the user listed (plus client + type which are obvious).
// Order = visual order from right-to-left in RTL.
const COLUMNS: ColumnOption[] = [
  { key: 'policy_number', label: 'رقم المعاملة', required: true },
  { key: 'receipts', label: 'سندات القبض' },
  { key: 'client_name', label: 'العميل' },
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

const DEFAULT_VISIBLE = COLUMNS.map((c) => c.key);

interface CompanyForCalc {
  id: string;
  name: string;
  name_ar: string | null;
}

interface Props {
  rows: IssuanceRow[];
  companies: CompanyForCalc[];
  loading: boolean;
  /** Called when a row save succeeds, so the parent can refresh derived totals. */
  onRowSaved?: (rowId: string) => void;
  storageId?: string;
}

type EditableField =
  | 'insurance_price'
  | 'payed_for_company'
  | 'profit'
  | 'office_commission'
  | 'issue_date'
  | 'start_date'
  | 'end_date'
  | 'policy_number';

interface PolicyPatch {
  insurance_price?: number;
  payed_for_company?: number;
  profit?: number;
  office_commission?: number;
  issue_date?: string | null;
  start_date?: string;
  end_date?: string;
  policy_number?: string;
}

interface CarPatch {
  car_value?: number;
  car_number?: string;
}

export function CompanyIssuancesTable({
  rows,
  companies,
  loading,
  onRowSaved,
  storageId = 'accounting-company-issuances',
}: Props) {
  const { visible, toggle, reset } = useTableColumnVisibility(storageId, DEFAULT_VISIBLE);

  const [calcPolicy, setCalcPolicy] = useState<IssuanceRow | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [drawerPolicy, setDrawerPolicy] = useState<IssuanceRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Local mirror of edited values per row, so the cell shows what the
  // user just typed even before the auto-save flushes.
  const [editLocal, setEditLocal] = useState<Record<string, Partial<IssuanceRow>>>({});

  const savePolicy = useMemo(
    () => async (rowId: string, patch: PolicyPatch) => {
      const { error } = await supabase.from('policies').update(patch).eq('id', rowId);
      if (error) {
        toast.error(`فشل الحفظ: ${error.message}`);
        return;
      }
      toast.success('تم الحفظ', { duration: 1200 });
      onRowSaved?.(rowId);
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

  const merge = (rowId: string, patch: Partial<IssuanceRow>) =>
    setEditLocal((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] ?? {}), ...patch } }));

  const valueOf = (row: IssuanceRow): IssuanceRow => ({
    ...row,
    ...(editLocal[row.id] ?? {}),
  });

  const showCol = (key: string) => visible.includes(key);

  const columnCount = visible.length;

  const onChangePolicyField = (
    row: IssuanceRow,
    field: EditableField,
    raw: string,
  ) => {
    const numericFields: EditableField[] = [
      'insurance_price',
      'payed_for_company',
      'profit',
      'office_commission',
    ];
    if (numericFields.includes(field)) {
      const num = raw === '' ? 0 : Number(raw);
      if (Number.isNaN(num)) return;
      merge(row.id, { [field]: num } as Partial<IssuanceRow>);
      policyDebounced.schedule(row.id, { [field]: num } as PolicyPatch);
    } else {
      merge(row.id, { [field]: raw } as Partial<IssuanceRow>);
      policyDebounced.schedule(row.id, { [field]: raw || null } as PolicyPatch);
    }
  };

  const onChangeCarValue = (row: IssuanceRow, raw: string) => {
    if (!row.car_id) return;
    const num = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(num)) return;
    merge(row.id, { car_value: num });
    carDebounced.schedule(row.car_id, { car_value: num });
  };

  const openCalc = (row: IssuanceRow) => {
    setCalcPolicy(row);
    setCalcOpen(true);
  };

  const openReceipts = (row: IssuanceRow) => {
    setDrawerPolicy(row);
    setDrawerOpen(true);
  };

  const calcCompany = useMemo(() => {
    if (!calcPolicy?.company_id) return null;
    return companies.find((c) => c.id === calcPolicy.company_id) ?? null;
  }, [calcPolicy, companies]);

  return (
    <div className="space-y-3">
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
              <TableRow className="bg-muted/40">
                {showCol('policy_number') && (
                  <TableHead className="whitespace-nowrap sticky right-0 bg-muted/40 z-10 min-w-[140px]">
                    رقم المعاملة
                  </TableHead>
                )}
                {showCol('receipts') && <TableHead className="whitespace-nowrap min-w-[120px]">سندات القبض</TableHead>}
                {showCol('client_name') && <TableHead className="whitespace-nowrap min-w-[160px]">العميل</TableHead>}
                {showCol('issue_date') && <TableHead className="whitespace-nowrap min-w-[140px]">تاريخ الإصدار</TableHead>}
                {showCol('start_date') && <TableHead className="whitespace-nowrap min-w-[140px]">بدء التأمين</TableHead>}
                {showCol('end_date') && <TableHead className="whitespace-nowrap min-w-[140px]">نهاية التأمين</TableHead>}
                {showCol('car_number') && <TableHead className="whitespace-nowrap min-w-[120px]">رقم السيارة</TableHead>}
                {showCol('car_value') && <TableHead className="whitespace-nowrap min-w-[120px]">سعر السيارة</TableHead>}
                {showCol('payment_method') && <TableHead className="whitespace-nowrap min-w-[120px]">طريقة الدفع</TableHead>}
                {showCol('company_name') && <TableHead className="whitespace-nowrap min-w-[160px]">شركة التأمين</TableHead>}
                {showCol('policy_type') && <TableHead className="whitespace-nowrap min-w-[110px]">نوع التأمين</TableHead>}
                {showCol('payed_for_company') && <TableHead className="whitespace-nowrap min-w-[140px]">المستحق للشركة</TableHead>}
                {showCol('profit') && <TableHead className="whitespace-nowrap min-w-[140px]">الربح / العمولة</TableHead>}
                {showCol('insurance_price') && <TableHead className="whitespace-nowrap min-w-[140px]">سعر التأمين</TableHead>}
                {showCol('actions') && (
                  <TableHead className="whitespace-nowrap text-left sticky left-0 bg-muted/40 z-10 min-w-[80px]">
                    إجراءات
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    {Array.from({ length: columnCount }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-7 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center py-12 text-muted-foreground">
                    <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">لا توجد معاملات</p>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((rawRow) => {
                  const row = valueOf(rawRow);
                  const isElzami = row.policy_type_parent === 'ELZAMI';
                  return (
                    <TableRow key={row.id} className={row.cancelled ? 'bg-destructive/5' : ''}>
                      {showCol('policy_number') && (
                        <TableCell className="sticky right-0 bg-card z-10 font-mono text-sm">
                          <Input
                            value={row.policy_number ?? ''}
                            onChange={(e) => onChangePolicyField(rawRow, 'policy_number', e.target.value)}
                            className="h-8 text-sm font-mono w-[120px]"
                          />
                        </TableCell>
                      )}

                      {showCol('receipts') && (
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => openReceipts(rawRow)}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs hover:bg-accent transition-colors',
                              row.receipts_count > 0
                                ? 'border-emerald-500/30 text-emerald-700 bg-emerald-500/5'
                                : 'border-dashed text-muted-foreground',
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

                      {showCol('issue_date') && (
                        <TableCell>
                          <Input
                            type="date"
                            value={fmtIso(row.issue_date)}
                            onChange={(e) => onChangePolicyField(rawRow, 'issue_date', e.target.value)}
                            className="h-8 text-xs w-[130px]"
                          />
                        </TableCell>
                      )}
                      {showCol('start_date') && (
                        <TableCell>
                          <Input
                            type="date"
                            value={fmtIso(row.start_date)}
                            onChange={(e) => onChangePolicyField(rawRow, 'start_date', e.target.value)}
                            className="h-8 text-xs w-[130px]"
                          />
                        </TableCell>
                      )}
                      {showCol('end_date') && (
                        <TableCell>
                          <Input
                            type="date"
                            value={fmtIso(row.end_date)}
                            onChange={(e) => onChangePolicyField(rawRow, 'end_date', e.target.value)}
                            className="h-8 text-xs w-[130px]"
                          />
                        </TableCell>
                      )}

                      {showCol('car_number') && (
                        <TableCell className="text-sm">{row.car_number || '-'}</TableCell>
                      )}
                      {showCol('car_value') && (
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            value={row.car_value ?? 0}
                            onChange={(e) => onChangeCarValue(rawRow, e.target.value)}
                            disabled={!row.car_id}
                            className="h-8 text-sm w-[110px] tabular-nums"
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
                        <TableCell className="text-sm max-w-[180px] truncate" title={row.company_name ?? ''}>
                          {row.company_name || '-'}
                        </TableCell>
                      )}

                      {showCol('policy_type') && (
                        <TableCell>
                          <Badge variant={isElzami ? 'destructive' : 'secondary'} className="text-xs">
                            {policyTypeLabel(row.policy_type_parent, row.policy_type_child)}
                          </Badge>
                        </TableCell>
                      )}

                      {showCol('payed_for_company') && (
                        <TableCell>
                          {isElzami ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <Input
                              type="number"
                              value={row.payed_for_company ?? 0}
                              onChange={(e) =>
                                onChangePolicyField(rawRow, 'payed_for_company', e.target.value)
                              }
                              className="h-8 text-sm w-[110px] tabular-nums text-destructive"
                            />
                          )}
                        </TableCell>
                      )}

                      {showCol('profit') && (
                        <TableCell>
                          <Input
                            type="number"
                            value={isElzami ? row.office_commission ?? 0 : row.profit ?? 0}
                            onChange={(e) =>
                              onChangePolicyField(
                                rawRow,
                                isElzami ? 'office_commission' : 'profit',
                                e.target.value,
                              )
                            }
                            className="h-8 text-sm w-[110px] tabular-nums text-emerald-700"
                          />
                        </TableCell>
                      )}

                      {showCol('insurance_price') && (
                        <TableCell>
                          <Input
                            type="number"
                            value={row.insurance_price ?? 0}
                            onChange={(e) =>
                              onChangePolicyField(rawRow, 'insurance_price', e.target.value)
                            }
                            className="h-8 text-sm w-[110px] tabular-nums font-semibold"
                          />
                        </TableCell>
                      )}

                      {showCol('actions') && (
                        <TableCell className="sticky left-0 bg-card z-10 text-left">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 gap-1"
                            disabled={!row.company_id}
                            onClick={() => openCalc(rawRow)}
                            title="شرح الحسبة"
                          >
                            <Calculator className="h-3.5 w-3.5" />
                            <span className="text-xs">شرح</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <CalculationExplanationModal
        open={calcOpen}
        onOpenChange={setCalcOpen}
        policy={
          calcPolicy
            ? {
                id: calcPolicy.id,
                policy_type_parent: calcPolicy.policy_type_parent,
                policy_type_child: calcPolicy.policy_type_child,
                insurance_price: Number(valueOf(calcPolicy).insurance_price),
                payed_for_company: valueOf(calcPolicy).payed_for_company ?? null,
                profit: valueOf(calcPolicy).profit ?? null,
                is_under_24: calcPolicy.is_under_24 ?? null,
                car: calcPolicy.car_id
                  ? {
                      id: calcPolicy.car_id,
                      car_number: calcPolicy.car_number ?? '',
                      car_type: calcPolicy.car_type,
                      car_value: valueOf(calcPolicy).car_value ?? null,
                      year: calcPolicy.car_year,
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
        policyId={drawerPolicy?.id ?? null}
        policyNumber={drawerPolicy?.policy_number ?? null}
        clientName={drawerPolicy?.client_name ?? null}
      />
    </div>
  );
}

function fmtIso(date: string | null | undefined): string {
  if (!date) return '';
  try {
    return format(parseISO(date), 'yyyy-MM-dd');
  } catch {
    return '';
  }
}
