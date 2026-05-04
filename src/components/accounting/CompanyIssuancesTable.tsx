import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  IssuanceEditOverlay,
  IssuanceEditPatch,
  IssuanceRow,
  PAYMENT_METHOD_LABELS,
  applyOverlay,
} from './accountingTypes';

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
  /** Live edit overlay owned by the parent section so totals + the
   *  calc modal can mirror the cell values without a refetch. */
  editLocal: IssuanceEditOverlay;
  onPatch: (rowId: string, patch: IssuanceEditPatch) => void;
  /** Called after the package drawer persists a sub-policy edit; the
   *  parent uses this to patch its data state optimistically instead
   *  of triggering a full refetch. */
  onSubPolicySaved?: (subPolicyId: string, patch: IssuanceEditPatch) => void;
  pageSize?: number;
}

type PolicyPatch = Pick<
  IssuanceEditPatch,
  | 'insurance_price'
  | 'payed_for_company'
  | 'profit'
  | 'office_commission'
  | 'broker_buy_price'
  | 'issue_date'
  | 'start_date'
  | 'end_date'
>;

type CarPatch = Pick<IssuanceEditPatch, 'car_value'>;

export function CompanyIssuancesTable({
  rows,
  companies,
  loading,
  mode,
  visible,
  editLocal,
  onPatch,
  onSubPolicySaved,
  pageSize = 10,
}: Props) {
  const [calcRow, setCalcRow] = useState<IssuanceRow | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [drawerRow, setDrawerRow] = useState<IssuanceRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [packageRow, setPackageRow] = useState<IssuanceRow | null>(null);
  const [packageOpen, setPackageOpen] = useState(false);
  const [page, setPage] = useState(1);

  // Scroll-pane plumbing for the side prev/next arrows. We forward the
  // ref into StickyHorizontalScroll so we can drive the same element
  // its internal scrollbar already syncs against. atStart/atEnd derive
  // from `Math.abs(scrollLeft)` so it works under both LTR and RTL
  // (modern RTL uses negative scrollLeft going from 0 → -(maxScroll)).
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ atStart: true, atEnd: true });

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

  // The shadcn <Table> component nests the actual <table> inside its
  // own div.overflow-x-auto. That nested div ends up being the real
  // scroll container — `scrollerRef` (the StickyHorizontalScroll
  // bottom) has nothing to scroll because the table wrapper is w-full.
  // Descend to whatever child actually overflows so both edge
  // detection and the arrow buttons target the right element.
  const findRealScroller = (root: HTMLElement | null): HTMLElement | null => {
    if (!root) return null;
    if (root.scrollWidth > root.clientWidth + 1) return root;
    const queue: HTMLElement[] = Array.from(root.children) as HTMLElement[];
    while (queue.length) {
      const node = queue.shift()!;
      if (node.scrollWidth > node.clientWidth + 1) return node;
      queue.push(...(Array.from(node.children) as HTMLElement[]));
    }
    return root;
  };

  useEffect(() => {
    const outer = scrollerRef.current;
    if (!outer) return;
    let raf = 0;
    let bound: HTMLElement | null = null;
    const update = () => {
      const el = findRealScroller(outer);
      bound = el;
      if (!el) {
        setScrollEdges({ atStart: true, atEnd: true });
        return;
      }
      // Direction-agnostic edge detection using bounding rects. Works
      // for LTR, modern RTL, "reverse" RTL, and "default" RTL — none
      // of which agree on what scrollLeft means at the edges, but all
      // agree that DOMRects describe pixels on screen.
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) {
        setScrollEdges({ atStart: true, atEnd: true });
        return;
      }
      const cr = el.getBoundingClientRect();
      let minLeft = Infinity;
      let maxRight = -Infinity;
      for (const child of Array.from(el.children) as HTMLElement[]) {
        const r = child.getBoundingClientRect();
        if (r.left < minLeft) minLeft = r.left;
        if (r.right > maxRight) maxRight = r.right;
      }
      if (!Number.isFinite(minLeft) || !Number.isFinite(maxRight)) {
        setScrollEdges({ atStart: true, atEnd: true });
        return;
      }
      // atStart = "no content past the right viewport edge" → right
      //           arrow disabled. atEnd = same on the left.
      setScrollEdges({
        atStart: maxRight <= cr.right + 1,
        atEnd: minLeft >= cr.left - 1,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        update();
        // Rebind the scroll listener if the actual scroll element
        // changed (DOM mutations can swap which node carries the
        // overflow).
        if (bound) {
          bound.removeEventListener('scroll', schedule);
          bound.addEventListener('scroll', schedule, { passive: true });
        }
      });
    };
    schedule();
    const obs = new ResizeObserver(schedule);
    obs.observe(outer);
    Array.from(outer.children).forEach((c) => obs.observe(c));
    return () => {
      cancelAnimationFrame(raf);
      if (bound) bound.removeEventListener('scroll', schedule);
      obs.disconnect();
    };
  }, [paged.length, visible.length]);

  const scrollByPage = (dir: 'prev' | 'next') => {
    const el = findRealScroller(scrollerRef.current);
    if (!el) return;
    const delta = el.clientWidth * 0.7;
    // Browser convention is consistent across LTR and every RTL
    // scroll model: scrollLeft += X always pans the viewport right
    // (revealing right-hidden content); scrollLeft -= X pans left.
    // What changes between models is only the valid *range* of
    // scrollLeft, not the sign convention. So we don't need any
    // model detection — the right-side arrow ("prev") wants to
    // reveal right content (+delta), the left-side arrow ("next")
    // wants to reveal left content (-delta). The browser clamps at
    // edges automatically.
    const sign = dir === 'prev' ? 1 : -1;
    el.scrollBy({ left: sign * delta, behavior: 'smooth' });
  };

  const showCol = (key: string) => visible.includes(key);
  const visibleCount = visible.length;

  const updateNumericField = (
    row: IssuanceRow,
    field: keyof PolicyPatch,
    raw: string,
  ) => {
    // Other fields stay locked for packages — use the details drawer.
    // المستحق للشركة is the one exception (handled below).
    if (row.is_grouped && field !== 'payed_for_company') return;
    const num = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(num)) return;

    if (field !== 'payed_for_company') {
      onPatch(row.id, { [field]: num });
      policyDebounced.schedule(row.main.id, { [field]: num });
      return;
    }

    // Editing المستحق للشركة implies الربح follows: by construction
    // insurance_price = profit + payed_for_company. We mirror that
    // invariant locally + on save so the user sees الربح update live.
    // from_broker rows compute profit from broker_buy_price instead —
    // skip the auto-mirror there. ELZAMI is already excluded at the cell.
    const isFromBroker = row.main.broker_direction === 'from_broker';
    const viewed = view(row);

    // Overlay reflects displayed totals so the profit cell on this row
    // updates in real time as the user types.
    const overlayPatch: IssuanceEditPatch = { payed_for_company: num };
    if (!isFromBroker) overlayPatch.profit = viewed.insurance_price - num;
    onPatch(row.id, overlayPatch);

    // The DB save targets row.main.id. For packages the displayed
    // payed_for_company is the SUM across subs (ELZAMI subs store
    // payed_for_company = insurance_price), so we subtract non-main
    // subs' contribution before writing — that way the on-disk sum
    // matches what the user typed once aggregates rebuild. الربح on
    // the main sub follows from its own insurance_price.
    const nonMainPayed = row.is_grouped
      ? row.sub_policies
          .filter((s) => s.id !== row.main.id)
          .reduce((sum, s) => sum + Number(s.payed_for_company ?? 0), 0)
      : 0;
    const mainPayedNew = num - nonMainPayed;
    const dbPatch: PolicyPatch = { payed_for_company: mainPayedNew };
    if (!isFromBroker) {
      dbPatch.profit = Number(viewed.main.insurance_price ?? 0) - mainPayedNew;
    }
    policyDebounced.schedule(row.main.id, dbPatch);
  };

  const updateDateField = (row: IssuanceRow, field: 'issue_date' | 'start_date' | 'end_date', raw: string) => {
    if (row.is_grouped) return;
    onPatch(row.id, { [field]: raw });
    policyDebounced.schedule(row.main.id, { [field]: raw || null });
  };

  const updateCarValue = (row: IssuanceRow, raw: string) => {
    if (!row.main.car_id || row.is_grouped) return;
    const num = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(num)) return;
    onPatch(row.id, { car_value: num });
    carDebounced.schedule(row.main.car_id, { car_value: num });
  };

  const view = (row: IssuanceRow): IssuanceRow => applyOverlay(row, editLocal);

  const calcCompany = useMemo(() => {
    if (!calcRow?.main.company_id) return null;
    return companies.find((c) => c.id === calcRow.main.company_id) ?? null;
  }, [calcRow, companies]);

  // The calc modal refetches pricing_rules whenever its `policy` prop
  // identity changes — recomputing this object every parent render
  // hammered Supabase. Keying off calcRow.main.id + the row's edit
  // patch is enough to refresh exactly when the inputs change.
  const calcPolicyPatch = calcRow ? editLocal[calcRow.id] : undefined;
  const calcPolicy = useMemo(() => {
    if (!calcRow) return null;
    const v = applyOverlay(calcRow, editLocal);
    return {
      id: calcRow.main.id,
      policy_type_parent: calcRow.main.policy_type_parent,
      policy_type_child: calcRow.main.policy_type_child,
      insurance_price: Number(v.insurance_price),
      payed_for_company: v.payed_for_company ?? null,
      profit: v.profit ?? null,
      is_under_24: calcRow.main.is_under_24 ?? null,
      car: calcRow.main.car_id
        ? {
            id: calcRow.main.car_id,
            car_number: calcRow.main.car_number ?? '',
            car_type: calcRow.main.car_type,
            car_value: v.main.car_value ?? null,
            year: calcRow.main.car_year,
          }
        : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcRow?.main.id, calcPolicyPatch]);

  const disabledTip = 'تعديل الحزمة من أيقونة "تفاصيل" — لكل بند قيمته الخاصة';

  return (
    <TooltipProvider delayDuration={250}>
      <div className="space-y-2.5">
        <div className="relative">
        <div className="rounded-lg border bg-card">
          <StickyHorizontalScroll ref={scrollerRef}>
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
                  {showCol('payed_for_company') && (
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
                    <TableHead className="whitespace-nowrap text-center sticky left-0 bg-slate-100/95 z-10 w-20 min-w-[80px] px-1 shadow-[1px_0_0_0_hsl(var(--border))]">
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
                    const isToBroker = row.main.broker_direction === 'to_broker';
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
                            <TableCell className="text-sm max-w-[220px]">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate" title={row.main.company_name ?? ''}>
                                  {row.main.company_name || '-'}
                                </span>
                                {mode === 'broker' && row.main.broker_direction && (
                                  <BrokerDirectionPill direction={row.main.broker_direction} />
                                )}
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

                        {showCol('payed_for_company') && (
                          <TableCell>
                            {isElzami ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : (
                              <NumberCell
                                value={row.payed_for_company ?? 0}
                                onChange={(v) => updateNumericField(rawRow, 'payed_for_company', v)}
                                tone="destructive"
                              />
                            )}
                          </TableCell>
                        )}

                        {mode === 'broker' && showCol('broker_buy_price') && (
                          <TableCell>
                            <NumberCell
                              value={row.broker_buy_price ?? 0}
                              disabled={!editable || isToBroker}
                              onChange={(v) => updateNumericField(rawRow, 'broker_buy_price', v)}
                              tone="amber"
                              tip={
                                isToBroker
                                  ? 'البوليصة مباعة للوسيط — لا يوجد سعر شراء'
                                  : disabledTip
                              }
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
                                ₪{(isToBroker
                                  ? Number(row.profit ?? 0)
                                  : Math.max(0, row.insurance_price - row.broker_buy_price)
                                ).toLocaleString('en-US')}
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
                          <TableCell className="sticky left-0 bg-slate-50/95 z-10 px-1 w-20 min-w-[80px] shadow-[1px_0_0_0_hsl(var(--border))]">
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

        {/* Side scroll arrows — render in a tall absolute lane on
            each edge so a `position: sticky` child can pin to the
            viewport while the user scrolls vertically through a long
            table. The chevrons map directly to scroll direction;
            disabled state mirrors `Math.abs(scrollLeft)` against the
            scrollWidth so this works in both LTR and RTL. */}
        <SideScrollArrow
          side="right"
          disabled={scrollEdges.atStart}
          onClick={() => scrollByPage('prev')}
        />
        <SideScrollArrow
          side="left"
          disabled={scrollEdges.atEnd}
          onClick={() => scrollByPage('next')}
        />
        </div>

        <CalculationExplanationModal
          open={calcOpen}
          onOpenChange={setCalcOpen}
          policy={calcPolicy}
          company={calcCompany}
        />

        <PolicyReceiptsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          policyIds={drawerRow?.sub_policies.map((s) => s.id) ?? []}
          policyNumber={drawerRow?.document_number ?? null}
          clientName={drawerRow?.client_name ?? null}
        />

        <PackageDetailsDrawer
          open={packageOpen}
          onOpenChange={setPackageOpen}
          row={packageRow}
          mode={mode}
          onSubPolicySaved={(id, patch) => onSubPolicySaved?.(id, patch)}
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

// Tiny chip that tells the staff at a glance whether a broker policy
// was bought FROM the broker or sold TO the broker. Drives the
// broker_buy_price input's locked-state via the same flag.
function BrokerDirectionPill({ direction }: { direction: 'from_broker' | 'to_broker' }) {
  const isFrom = direction === 'from_broker';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border shrink-0',
            isFrom
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-emerald-50 text-emerald-700 border-emerald-200',
          )}
        >
          {isFrom ? 'شراء' : 'بيع'}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="whitespace-nowrap">
        {isFrom ? 'اشترينا البوليصة من الوسيط' : 'الوسيط اشترى البوليصة منّا'}
      </TooltipContent>
    </Tooltip>
  );
}

// Floating prev/next horizontal-scroll button. The outer absolute
// lane spans the full table height; the inner `position: sticky`
// child pins around viewport-center as the user scrolls vertically
// through long tables. `pointer-events-none` on the lane prevents it
// from blocking clicks on table cells underneath, while the inner
// button re-enables them for itself.
function SideScrollArrow({
  side,
  disabled,
  onClick,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === 'right' ? ChevronRight : ChevronLeft;
  return (
    <div
      aria-hidden={disabled}
      // Pinned just inside the table edge with a high z-index so the
      // chevron always floats above row content (previous "-right-3"
      // / "-left-3" placement leaked the button outside the card and
      // got clipped by ancestor overflow). The wrapper itself stays
      // pointer-events-none so it doesn't eat clicks on table cells —
      // only the inner button is interactive.
      className={cn(
        'absolute top-0 bottom-0 w-9 pointer-events-none hidden md:flex items-start z-30',
        side === 'right' ? 'right-1' : 'left-1',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={side === 'right' ? 'تمرير لليمين' : 'تمرير لليسار'}
        className={cn(
          'sticky top-[45vh] mx-auto pointer-events-auto h-9 w-9 rounded-full bg-card/95 backdrop-blur border shadow-lg',
          'flex items-center justify-center text-foreground transition',
          'hover:bg-muted hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none',
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
    </div>
  );
}
