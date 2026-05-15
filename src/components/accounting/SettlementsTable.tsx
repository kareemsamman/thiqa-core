import { Fragment, useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Banknote,
  Building,
  ChevronDown,
  ChevronLeft,
  CreditCard,
  Eye,
  FileText,
  ImageIcon,
  Pencil,
  Trash2,
  Wallet,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { PAYMENT_METHOD_LABELS } from './accountingTypes';
import { getBank } from '@/lib/banks';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PaymentEditDialog } from '@/components/clients/PaymentEditDialog';
import { FilePreviewGallery } from '@/components/policies/FilePreviewGallery';

export interface SettlementRow {
  id: string;
  settlement_date: string;
  total_amount: number;
  payment_type: string | null;
  cheque_number: string | null;
  bank_code: string | null;
  branch_code: string | null;
  /** Multi-image attachments. Empty array == no images.
   *  Legacy rows that only have cheque_image_url get hydrated into a
   *  single-element array by useAccountingData on read. */
  cheque_image_urls: string[];
  /** Length of customer_cheque_ids. Drives the "N شيكات — اضغط للعرض"
   *  summary on the collapsed row when payment_type is customer_cheque. */
  customer_cheque_count?: number;
  status: string;
  refused: boolean | null;
  notes: string | null;
  entity_id: string | null; // company_id or broker_id
  entity_name: string | null; // company or broker name
  direction?: 'we_owe' | 'broker_owes' | 'incoming' | 'outgoing' | null;
  /** Mirror receipt (when company_settlements/broker_settlements
   *  triggered a row into `receipts`). Hydrated up-front by
   *  useAccountingData so the accounting table can render the user-
   *  facing voucher number AND feed ReceiptActionsDialog without an
   *  async lookup on click. null when no mirror exists (legacy rows). */
  voucher_number?: string | null;
  receipt_id?: string | null;
  receipt_type?: string | null;
  payment_id?: string | null;
}

interface ConsumedCheque {
  id: string;
  amount: number;
  cheque_number: string | null;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url: string | null;
  /** Every file attached to the cheque — payment_images rows plus the
   *  legacy cheque_image_url, deduped. Drives the thumbnail badge and
   *  the FilePreviewGallery opened on click. */
  files: string[];
  payment_date: string;
  client_name: string | null;
}

interface Props {
  rows: SettlementRow[];
  loading: boolean;
  /** Visual cue + icon. */
  voucherKind: 'disbursement' | 'receipt';
  /** Show a Direction column (only meaningful for brokers). */
  showDirection?: boolean;
  /** Controlled visibility — section owns the column-visibility state. */
  visible: string[];
  entityLabel: string; // "شركة التأمين" / "الوسيط"
  /** Optional row actions — when omitted, the actions column is hidden.
   *  Wired by the section so it can target the right table for delete
   *  and supply the entity context for edit. */
  onEdit?: (row: SettlementRow) => void;
  onDelete?: (row: SettlementRow) => Promise<void> | void;
  /** Click handler for the رقم السند cell — opens the shared
   *  print/SMS/WhatsApp dialog. When omitted, the voucher cell is
   *  rendered as plain text. */
  onVoucherClick?: (row: SettlementRow) => void;
  /** Deep-link target — when present, the matching row scrolls into
   *  view, gets a brief highlight, and the customer-cheque accordion
   *  auto-opens for cheque-style settlements. */
  focusSettlementId?: string | null;
  /** Called after the user removes a constituent customer cheque from a
   *  settlement so the parent can refresh its data. */
  onSettlementChanged?: () => void;
}

export function SettlementsTable({
  rows,
  loading,
  voucherKind,
  showDirection = false,
  visible,
  entityLabel,
  onEdit,
  onDelete,
  onVoucherClick,
  focusSettlementId,
  onSettlementChanged,
}: Props) {
  const showCol = (key: string) => visible.includes(key);
  const kindClass = voucherKind === 'disbursement' ? 'text-orange-600' : 'text-emerald-600';
  const showActions = !!(onEdit || onDelete);
  const colSpan = visible.length + (showActions ? 1 : 0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Auto-expand the deep-link target when it's a customer_cheque row,
  // so the user lands directly on the breakdown they were sent to.
  useEffect(() => {
    if (!focusSettlementId) return;
    const target = rows.find((r) => r.id === focusSettlementId);
    if (target && target.payment_type === 'customer_cheque') {
      setExpanded((prev) => {
        if (prev.has(focusSettlementId)) return prev;
        const next = new Set(prev);
        next.add(focusSettlementId);
        return next;
      });
    }
  }, [focusSettlementId, rows]);

  return (
    <TooltipProvider delayDuration={250}>
    <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {showCol('voucher_number') && <TableHead className="whitespace-nowrap min-w-[110px]">رقم السند</TableHead>}
              {showCol('date') && <TableHead className="whitespace-nowrap min-w-[120px]">التاريخ</TableHead>}
              {showCol('entity') && <TableHead className="whitespace-nowrap min-w-[180px]">{entityLabel}</TableHead>}
              {showCol('amount') && <TableHead className="whitespace-nowrap min-w-[120px]">المبلغ</TableHead>}
              {showCol('payment_type') && <TableHead className="whitespace-nowrap min-w-[120px]">طريقة الدفع</TableHead>}
              {showCol('cheque_number') && <TableHead className="whitespace-nowrap min-w-[200px]">رقم الشيك</TableHead>}
              {showCol('cheque_image') && <TableHead className="whitespace-nowrap text-center w-16">المرفق</TableHead>}
              {showDirection && showCol('direction') && (
                <TableHead className="whitespace-nowrap min-w-[110px]">الاتجاه</TableHead>
              )}
              {showCol('status') && <TableHead className="whitespace-nowrap min-w-[100px]">الحالة</TableHead>}
              {showCol('notes') && <TableHead className="whitespace-nowrap min-w-[180px]">ملاحظات</TableHead>}
              {showActions && <TableHead className="whitespace-nowrap text-center w-24">إجراءات</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  {Array.from({ length: colSpan }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center py-12 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">لا توجد سندات</p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const isCustomerCheque = r.payment_type === 'customer_cheque';
                const isExpanded = expanded.has(r.id);
                const toggle = () =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    return next;
                  });
                const isFocused = focusSettlementId === r.id;
                return (
                <Fragment key={r.id}>
                <TableRow
                  className={cn(
                    r.refused && 'bg-destructive/5',
                    isCustomerCheque && 'cursor-pointer hover:bg-muted/40',
                    isFocused && 'ring-2 ring-amber-400 transition',
                  )}
                  ref={(el) => {
                    if (el && isFocused) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                  onClick={(e) => {
                    if (!isCustomerCheque) return;
                    // Skip toggle when the click came from a button or
                    // link inside the row (edit / delete / image).
                    const target = e.target as HTMLElement;
                    if (target.closest('button, a')) return;
                    toggle();
                  }}
                >
                  {showCol('voucher_number') && (
                    <TableCell className="text-sm whitespace-nowrap font-mono ltr-nums">
                      {r.voucher_number && onVoucherClick ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onVoucherClick(r);
                          }}
                          className="text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
                        >
                          {r.voucher_number}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">{r.voucher_number ?? 'تسوية'}</span>
                      )}
                    </TableCell>
                  )}
                  {showCol('date') && (
                    <TableCell className="text-sm whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {isCustomerCheque ? (
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-muted-foreground transition-transform',
                              isExpanded && 'rotate-180',
                            )}
                          />
                        ) : (
                          <span className="inline-block w-3.5" />
                        )}
                        {fmtDate(r.settlement_date)}
                      </div>
                    </TableCell>
                  )}
                  {showCol('entity') && (
                    <TableCell className="text-sm max-w-[200px] truncate" title={r.entity_name ?? ''}>
                      {r.entity_name || '-'}
                    </TableCell>
                  )}
                  {showCol('amount') && (
                    <TableCell className={`tabular-nums font-semibold ${kindClass}`}>
                      ₪{Number(r.total_amount).toLocaleString('en-US')}
                    </TableCell>
                  )}
                  {showCol('payment_type') && (
                    <TableCell>
                      <PaymentBadge type={r.payment_type} />
                    </TableCell>
                  )}
                  {showCol('cheque_number') && (
                    <TableCell className="text-xs">
                      {isCustomerCheque ? (
                        <CustomerChequeSummary
                          count={r.customer_cheque_count ?? 0}
                          isExpanded={isExpanded}
                          onClick={toggle}
                        />
                      ) : (
                        <ChequeIdent
                          chequeNumber={r.cheque_number}
                          bankCode={r.bank_code}
                          branchCode={r.branch_code}
                        />
                      )}
                    </TableCell>
                  )}
                  {showCol('cheque_image') && (
                    <TableCell className="text-center">
                      <ChequeImageCell urls={r.cheque_image_urls} />
                    </TableCell>
                  )}
                  {showDirection && showCol('direction') && (
                    <TableCell>
                      {r.direction === 'we_owe' ? (
                        <Badge variant="outline" className="text-[10px] text-orange-700 border-orange-300">
                          نحن مدينون
                        </Badge>
                      ) : r.direction === 'broker_owes' ? (
                        <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300">
                          الوسيط مدين
                        </Badge>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  )}
                  {showCol('status') && (
                    <TableCell>
                      <StatusBadge status={r.status} refused={r.refused} />
                    </TableCell>
                  )}
                  {showCol('notes') && (
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={r.notes ?? ''}>
                      {r.notes || '-'}
                    </TableCell>
                  )}
                  {showActions && (
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {/* Customer-cheque vouchers are edited by managing
                            their constituent cheques inside the accordion
                            (the EditSettlementDialog can't reassign them
                            anyway), so the row-level edit button is hidden
                            to avoid leading staff into a dead end. */}
                        {onEdit && !isCustomerCheque && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 hover:bg-slate-200/60"
                                onClick={() => onEdit(r)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="whitespace-nowrap">تعديل</TooltipContent>
                          </Tooltip>
                        )}
                        {onDelete && (
                          <AlertDialog>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 hover:bg-destructive/10"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </AlertDialogTrigger>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="whitespace-nowrap">حذف</TooltipContent>
                            </Tooltip>
                            <AlertDialogContent dir="rtl">
                              <AlertDialogHeader>
                                <AlertDialogTitle>حذف السند؟</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {isCustomerCheque ? (
                                    <>
                                      سيتم حذف السند نهائياً وإزالة جميع شيكات العميل المرتبطة
                                      به ({r.customer_cheque_count ?? 0} شيك). الشيكات تبقى موجودة
                                      في صفحة الشيكات وتعود إلى الحالة "قيد الانتظار" ليُعاد
                                      استخدامها في سند آخر.
                                    </>
                                  ) : (
                                    'سيتم حذف السند نهائياً.'
                                  )}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => onDelete(r)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  حذف
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
                {isCustomerCheque && isExpanded && (
                  <ConsumedChequesRow
                    settlementId={r.id}
                    voucherKind={voucherKind}
                    colSpan={colSpan}
                    onChanged={onSettlementChanged}
                  />
                )}
                </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
    </div>
    </TooltipProvider>
  );
}

/**
 * Lazy-fetches the `customer_cheque_ids` payload for a settlement and
 * renders each consumed customer cheque as a sub-row: number, branch,
 * bank, amount, due date, image, and a "remove" button. Removal does
 * the inverse of the original write — pulls the cheque out of the
 * settlement (recomputing the total) and resets the policy_payment to
 * pending so it shows up in the available pool again.
 */
function ConsumedChequesRow({
  settlementId,
  voucherKind,
  colSpan,
  onChanged,
}: {
  settlementId: string;
  voucherKind: 'disbursement' | 'receipt';
  colSpan: number;
  onChanged?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [cheques, setCheques] = useState<ConsumedCheque[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [settlementTable, setSettlementTable] = useState<
    'company_settlements' | 'broker_settlements' | null
  >(null);
  // Edit-cheque state — reuses PaymentEditDialog so the form matches
  // what staff see editing a cheque from the policy timeline or the
  // /cheques page.
  const [editPayment, setEditPayment] = useState<PaymentEditRecord | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState<string | null>(null);

  const openEdit = async (chequeId: string) => {
    setLoadingEdit(chequeId);
    try {
      const { data, error } = await supabase
        .from('policy_payments')
        .select(
          `id, amount, payment_date, cheque_due_date, cheque_issue_date,
           payment_type, cheque_number,
           cheque_date, bank_code, branch_code, cheque_image_url,
           card_last_four, refused, notes, locked, policy_id,
           policies!policy_payments_policy_id_fkey(
             id, policy_type_parent, policy_type_child, insurance_price
           )`,
        )
        .eq('id', chequeId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        toast.error('تعذر تحميل بيانات الشيك');
        return;
      }
      const raw = data as unknown as RawPaymentForEdit;
      const policy = Array.isArray(raw.policies) ? raw.policies[0] : raw.policies;
      setEditPayment({
        id: raw.id,
        amount: raw.amount,
        payment_date: raw.payment_date,
        cheque_due_date: raw.cheque_due_date,
        cheque_issue_date: raw.cheque_issue_date,
        payment_type: raw.payment_type,
        cheque_number: raw.cheque_number,
        cheque_date: raw.cheque_date,
        bank_code: raw.bank_code,
        branch_code: raw.branch_code,
        cheque_image_url: raw.cheque_image_url,
        card_last_four: raw.card_last_four,
        refused: raw.refused,
        notes: raw.notes,
        locked: raw.locked,
        policy_id: raw.policy_id,
        policy: policy
          ? {
              id: policy.id,
              policy_type_parent: policy.policy_type_parent,
              policy_type_child: policy.policy_type_child,
              insurance_price: policy.insurance_price,
            }
          : null,
      });
      setEditOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل في تحميل الشيك';
      toast.error(message);
    } finally {
      setLoadingEdit(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Settlement might live in either company_settlements or
      // broker_settlements — probe both. company_settlements first
      // because it's the more common case in production data.
      const tables: ('company_settlements' | 'broker_settlements')[] = [
        'company_settlements',
        'broker_settlements',
      ];
      let chequeIds: string[] = [];
      let foundTable: 'company_settlements' | 'broker_settlements' | null = null;
      for (const t of tables) {
        const { data } = await supabase
          .from(t)
          .select('customer_cheque_ids')
          .eq('id', settlementId)
          .maybeSingle();
        if (data) {
          const raw = (data as { customer_cheque_ids?: string[] | null }).customer_cheque_ids;
          chequeIds = Array.isArray(raw) ? raw : [];
          foundTable = t;
          break;
        }
      }
      if (cancelled) return;
      setSettlementTable(foundTable);
      if (chequeIds.length === 0) {
        setCheques([]);
        setLoading(false);
        return;
      }
      const [{ data: pp }, { data: pi }] = await Promise.all([
        supabase
          .from('policy_payments')
          .select(
            'id, amount, payment_date, cheque_number, bank_code, branch_code, cheque_image_url, policies(clients(full_name))',
          )
          .in('id', chequeIds),
        supabase
          .from('payment_images')
          .select('payment_id, image_url, sort_order')
          .in('payment_id', chequeIds)
          .order('sort_order', { ascending: true }),
      ]);
      if (cancelled) return;
      // Bucket attachments by payment_id so we can attach them to each
      // cheque row in one pass.
      const imagesByPaymentId = new Map<string, string[]>();
      for (const row of (pi ?? []) as Array<{ payment_id: string; image_url: string }>) {
        const list = imagesByPaymentId.get(row.payment_id) ?? [];
        list.push(row.image_url);
        imagesByPaymentId.set(row.payment_id, list);
      }
      const rows = ((pp ?? []) as Array<{
        id: string;
        amount: number | null;
        payment_date: string;
        cheque_number: string | null;
        bank_code: string | null;
        branch_code: string | null;
        cheque_image_url: string | null;
        policies?: { clients?: { full_name: string } | null } | null;
      }>).map((p) => {
        // Merge payment_images rows + legacy cheque_image_url, dedup
        // because old scans tend to write the same URL into both.
        const seen = new Set<string>();
        const files: string[] = [];
        for (const url of imagesByPaymentId.get(p.id) ?? []) {
          if (seen.has(url)) continue;
          seen.add(url);
          files.push(url);
        }
        if (p.cheque_image_url && !seen.has(p.cheque_image_url)) {
          files.push(p.cheque_image_url);
        }
        return {
          id: p.id,
          amount: Number(p.amount ?? 0),
          payment_date: p.payment_date,
          cheque_number: p.cheque_number,
          bank_code: p.bank_code,
          branch_code: p.branch_code,
          cheque_image_url: p.cheque_image_url,
          files,
          client_name: p.policies?.clients?.full_name ?? null,
        };
      });
      setCheques(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [settlementId, reloadKey]);

  const handleRemove = async (cheque: ConsumedCheque) => {
    if (!settlementTable) return;
    setRemoving(cheque.id);
    try {
      // Read the current settlement state — guards against drift if
      // someone else modified the row in another tab.
      const { data: cur, error: readErr } = await supabase
        .from(settlementTable)
        .select('customer_cheque_ids, total_amount')
        .eq('id', settlementId)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!cur) throw new Error('السند غير موجود');
      const curIds = Array.isArray((cur as { customer_cheque_ids?: string[] | null }).customer_cheque_ids)
        ? ((cur as { customer_cheque_ids?: string[] | null }).customer_cheque_ids as string[])
        : [];
      const nextIds = curIds.filter((id) => id !== cheque.id);
      const nextTotal = Math.max(0, Number((cur as { total_amount: number }).total_amount) - cheque.amount);

      const { error: updErr } = await supabase
        .from(settlementTable)
        .update({ customer_cheque_ids: nextIds, total_amount: nextTotal } as never)
        .eq('id', settlementId);
      if (updErr) throw updErr;

      // Release the cheque back to the pending pool so it shows up
      // again in the customer-cheque selector.
      const { error: ppErr } = await supabase
        .from('policy_payments')
        .update({
          cheque_status: 'pending',
          transferred_to_type: null,
          transferred_to_id: null,
          transferred_payment_id: null,
          transferred_at: null,
        })
        .eq('id', cheque.id);
      if (ppErr) throw ppErr;

      toast.success('تم إزالة الشيك من السند');
      setReloadKey((k) => k + 1);
      onChanged?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل الحذف';
      toast.error(message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={colSpan} className="p-0">
        <div className="p-3 border-r-2 border-primary/40">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-2">
            <Wallet className="h-3.5 w-3.5" />
            شيكات العميل المستخدمة في هذا السند
          </div>
          {loading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : cheques.length === 0 ? (
            <p className="text-xs text-muted-foreground">لا توجد شيكات مرتبطة.</p>
          ) : (
            <div className="space-y-2">
              {cheques.map((c) => {
                const bank = c.bank_code ? getBank(c.bank_code) : null;
                const amountColor =
                  voucherKind === 'disbursement' ? 'text-orange-600' : 'text-emerald-600';
                return (
                  <div
                    key={c.id}
                    className={cn(
                      'flex items-center gap-4 rounded-lg border bg-card px-3 py-2.5 text-xs shadow-sm transition',
                      'hover:border-primary/30 hover:shadow-md',
                    )}
                  >
                    <ConsumedChequeFiles
                      paymentId={c.id}
                      files={c.files}
                      chequeNumber={c.cheque_number}
                    />
                    <div className="flex flex-col gap-0.5 leading-tight min-w-[150px]">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        رقم الشيك
                      </span>
                      <span
                        className="font-mono tabular-nums text-sm font-semibold text-foreground"
                        dir="ltr"
                      >
                        {c.cheque_number || '—'}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        {bank?.nameAr ?? c.bank_code ?? '—'}
                        {c.branch_code && (
                          <span
                            dir="ltr"
                            className="font-mono px-1 rounded bg-muted text-[10px]"
                          >
                            {c.branch_code}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="hidden md:block w-px h-9 bg-border" />
                    <div className="flex flex-col gap-0.5 leading-tight min-w-[110px]">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        العميل
                      </span>
                      <span className="text-sm text-foreground">{c.client_name ?? '—'}</span>
                    </div>
                    <div className="hidden md:block w-px h-9 bg-border" />
                    <div className="flex flex-col gap-0.5 leading-tight">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        تاريخ الاستحقاق
                      </span>
                      <span className="tabular-nums text-foreground">{fmtDate(c.payment_date)}</span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 leading-tight ms-auto">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        المبلغ
                      </span>
                      <span className={cn('font-bold tabular-nums text-base', amountColor)}>
                        ₪{c.amount.toLocaleString('en-US')}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5 ps-2 border-s">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-slate-200/60"
                            disabled={loadingEdit === c.id}
                            onClick={() => openEdit(c.id)}
                            aria-label="تعديل الشيك"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="whitespace-nowrap">تعديل</TooltipContent>
                      </Tooltip>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-destructive/10"
                            disabled={removing === c.id}
                            aria-label="إزالة الشيك"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent dir="rtl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>إزالة الشيك من السند؟</AlertDialogTitle>
                          <AlertDialogDescription>
                            سيتم تعديل إجمالي السند وإعادة الشيك إلى الشيكات المعلّقة
                            ليُستخدم في سند آخر.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleRemove(c)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            إزالة
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <PaymentEditDialog
            open={editOpen}
            onOpenChange={(o) => {
              setEditOpen(o);
              if (!o) setEditPayment(null);
            }}
            payment={editPayment}
            onSuccess={() => {
              setEditOpen(false);
              setEditPayment(null);
              setReloadKey((k) => k + 1);
              onChanged?.();
            }}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

// Thumbnail-with-viewer for a consumed cheque's attached files. Shows
// the first image as a thumb (or a PDF/file icon when the first file
// is a PDF), stacks a "+N" badge for additional files, and opens the
// shared FilePreviewGallery so staff get zoom/download/navigation.
function ConsumedChequeFiles({
  paymentId,
  files,
  chequeNumber,
}: {
  paymentId: string;
  files: string[];
  chequeNumber: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  const mediaFiles = files.map((url, i) => {
    const isPdf = url.toLowerCase().endsWith('.pdf');
    const tail = url.split('/').pop() || (isPdf ? `شيك-${chequeNumber ?? ''}.pdf` : `صورة-${i + 1}`);
    return {
      id: `${paymentId}-${i}`,
      original_name: tail,
      cdn_url: url,
      mime_type: isPdf ? 'application/pdf' : 'image/jpeg',
      size: 0,
      created_at: new Date().toISOString(),
      entity_type: null,
    };
  });
  const current = mediaFiles.find((m) => m.cdn_url === currentUrl) ?? null;

  if (files.length === 0) {
    return (
      <div
        className="h-12 w-12 rounded-md border border-dashed bg-muted/30 flex items-center justify-center shrink-0"
        title="لا توجد مرفقات"
      >
        <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
      </div>
    );
  }

  const first = files[0];
  const isFirstPdf = first.toLowerCase().endsWith('.pdf');

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCurrentUrl(first);
          setOpen(true);
        }}
        className="group relative h-12 w-12 shrink-0"
        title={files.length === 1 ? 'عرض المرفق' : `عرض ${files.length} مرفقات`}
        aria-label="عرض مرفقات الشيك"
      >
        {/* Inner wrapper handles overflow + rounded corners so the +N
            count badge can sit outside the clip area and stay visible. */}
        <div className="absolute inset-0 rounded-md border bg-muted overflow-hidden group-hover:ring-2 group-hover:ring-primary/40 transition">
          {isFirstPdf ? (
            <div className="h-full w-full flex items-center justify-center bg-rose-50">
              <FileText className="h-5 w-5 text-rose-600" />
            </div>
          ) : (
            <img
              src={first}
              alt={`صورة شيك ${chequeNumber ?? ''}`}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition">
            <Eye className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition" />
          </span>
        </div>
        {files.length > 1 && (
          <span className="absolute -top-1.5 -left-1.5 h-5 min-w-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shadow ring-2 ring-card">
            {files.length}
          </span>
        )}
      </button>
      {open && (
        <FilePreviewGallery
          file={current}
          allFiles={mediaFiles}
          onClose={() => {
            setOpen(false);
            setCurrentUrl(null);
          }}
          onNavigate={(f) => setCurrentUrl(f.cdn_url)}
        />
      )}
    </>
  );
}

interface PaymentEditRecord {
  id: string;
  amount: number;
  payment_date: string;
  cheque_due_date?: string | null;
  cheque_issue_date?: string | null;
  payment_type: string;
  cheque_number: string | null;
  cheque_date: string | null;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url: string | null;
  card_last_four: string | null;
  refused: boolean | null;
  notes: string | null;
  locked: boolean | null;
  policy_id: string;
  policy: {
    id: string;
    policy_type_parent: string;
    policy_type_child?: string | null;
    insurance_price: number;
  } | null;
}

interface RawPaymentForEdit {
  id: string;
  amount: number;
  payment_date: string;
  cheque_due_date?: string | null;
  cheque_issue_date?: string | null;
  payment_type: string;
  cheque_number: string | null;
  cheque_date: string | null;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url: string | null;
  card_last_four: string | null;
  refused: boolean | null;
  notes: string | null;
  locked: boolean | null;
  policy_id: string;
  policies:
    | {
        id: string;
        policy_type_parent: string;
        policy_type_child: string | null;
        insurance_price: number;
      }
    | Array<{
        id: string;
        policy_type_parent: string;
        policy_type_child: string | null;
        insurance_price: number;
      }>
    | null;
}

// Compact summary used inside the cheque_number cell on customer_cheque
// settlement rows. Single cheque → "1 شيك"; multiple → "N شيكات".
// In both cases the badge is clickable and toggles the accordion so
// the user can read every cheque number underneath.
function CustomerChequeSummary({
  count,
  isExpanded,
  onClick,
}: {
  count: number;
  isExpanded: boolean;
  onClick: () => void;
}) {
  if (count === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const label = count === 1 ? 'شيك واحد' : `${count} شيكات`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-primary/40 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 transition"
    >
      <Wallet className="h-3 w-3" />
      <span>{label}</span>
      <span className="text-[10px] text-muted-foreground">
        {isExpanded ? 'إخفاء' : 'اضغط للعرض'}
      </span>
      <ChevronDown
        className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')}
      />
    </button>
  );
}

// Renders the cheque-image cell. With one image we show a single clickable
// thumb; with multiple we show the first thumb stacked over a "+N" badge,
// and reveal every image on hover via a popover-ish cluster.
function ChequeImageCell({ urls }: { urls: string[] }) {
  if (!urls || urls.length === 0) {
    return <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/40 mx-auto" />;
  }
  if (urls.length === 1) {
    return (
      <a href={urls[0]} target="_blank" rel="noreferrer" className="inline-block" title="فتح الصورة">
        <img
          src={urls[0]}
          alt="صورة الشيك"
          className="h-8 w-8 rounded border object-cover hover:scale-110 transition-transform"
        />
      </a>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={urls[0]}
          target="_blank"
          rel="noreferrer"
          className="relative inline-block"
          title={`${urls.length} صور`}
        >
          <img
            src={urls[0]}
            alt="صورة الشيك"
            className="h-8 w-8 rounded border object-cover hover:scale-110 transition-transform"
          />
          <span className="absolute -bottom-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center shadow">
            +{urls.length - 1}
          </span>
        </a>
      </TooltipTrigger>
      <TooltipContent side="top" className="p-2">
        <div className="flex flex-wrap gap-1.5 max-w-[14rem]">
          {urls.map((u, i) => (
            <a key={`${u}-${i}`} href={u} target="_blank" rel="noreferrer" title={`صورة ${i + 1}`}>
              <img src={u} alt={`صورة ${i + 1}`} className="h-12 w-12 rounded border object-cover" />
            </a>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// Compact triple-line cheque identifier: number on top, then bank name +
// branch underneath in muted text. The branch displays inside a small
// rounded pill so it reads as a number-like identifier next to the bank.
function ChequeIdent({
  chequeNumber,
  bankCode,
  branchCode,
}: {
  chequeNumber: string | null;
  bankCode: string | null;
  branchCode: string | null;
}) {
  if (!chequeNumber && !bankCode && !branchCode) {
    return <span className="text-muted-foreground">-</span>;
  }
  const bank = bankCode ? getBank(bankCode) : null;
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span className="font-mono tabular-nums text-foreground">{chequeNumber || '—'}</span>
      {(bank || bankCode || branchCode) && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {bank?.nameAr ?? bankCode}
          {branchCode && (
            <span dir="ltr" className="font-mono px-1 rounded bg-muted text-[10px]">
              {branchCode}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function PaymentBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-xs text-muted-foreground">-</span>;
  const Icon =
    type === 'cash' ? Banknote : type === 'cheque' ? FileText : type === 'transfer' ? Building : CreditCard;
  return (
    <Badge variant="outline" className="text-xs gap-1">
      <Icon className="h-3 w-3" />
      {PAYMENT_METHOD_LABELS[type] ?? type}
    </Badge>
  );
}

function StatusBadge({ status, refused }: { status: string; refused: boolean | null }) {
  if (refused) {
    return <Badge variant="destructive" className="text-[10px]">مرفوض</Badge>;
  }
  if (status === 'completed') {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">مكتمل</Badge>;
  }
  if (status === 'pending') {
    return <Badge variant="secondary" className="text-[10px]">معلّق</Badge>;
  }
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

function fmtDate(date: string): string {
  try {
    return format(parseISO(date), 'dd/MM/yyyy');
  } catch {
    return date;
  }
}
