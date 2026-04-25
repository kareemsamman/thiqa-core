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
  status: string;
  refused: boolean | null;
  notes: string | null;
  entity_id: string | null; // company_id or broker_id
  entity_name: string | null; // company or broker name
  direction?: 'we_owe' | 'broker_owes' | null; // brokers only
}

interface ConsumedCheque {
  id: string;
  amount: number;
  cheque_number: string | null;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url: string | null;
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
                      <ChequeIdent
                        chequeNumber={r.cheque_number}
                        bankCode={r.bank_code}
                        branchCode={r.branch_code}
                      />
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
                        {onEdit && (
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
                                  سيتم حذف السند نهائياً. إذا كان السند يخصم شيكات عميل،
                                  سيتم إعادة تلك الشيكات إلى الحالة "قيد الانتظار".
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
      const { data: pp } = await supabase
        .from('policy_payments')
        .select(
          'id, amount, payment_date, cheque_number, bank_code, branch_code, cheque_image_url, policies(clients(full_name))',
        )
        .in('id', chequeIds);
      if (cancelled) return;
      const rows = ((pp ?? []) as Array<{
        id: string;
        amount: number | null;
        payment_date: string;
        cheque_number: string | null;
        bank_code: string | null;
        branch_code: string | null;
        cheque_image_url: string | null;
        policies?: { clients?: { full_name: string } | null } | null;
      }>).map((p) => ({
        id: p.id,
        amount: Number(p.amount ?? 0),
        payment_date: p.payment_date,
        cheque_number: p.cheque_number,
        bank_code: p.bank_code,
        branch_code: p.branch_code,
        cheque_image_url: p.cheque_image_url,
        client_name: p.policies?.clients?.full_name ?? null,
      }));
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
            <div className="space-y-1.5">
              {cheques.map((c) => {
                const bank = c.bank_code ? getBank(c.bank_code) : null;
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-xs"
                  >
                    {c.cheque_image_url ? (
                      <a
                        href={c.cheque_image_url}
                        target="_blank"
                        rel="noreferrer"
                        title="فتح صورة الشيك"
                      >
                        <img
                          src={c.cheque_image_url}
                          alt="صورة الشيك"
                          className="h-10 w-10 rounded border object-cover"
                        />
                      </a>
                    ) : (
                      <div className="h-10 w-10 rounded border bg-muted/40 flex items-center justify-center">
                        <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
                      </div>
                    )}
                    <div className="flex flex-col gap-0.5 leading-tight min-w-[140px]">
                      <span className="text-[10px] text-muted-foreground">رقم الشيك</span>
                      <span className="font-mono tabular-nums text-foreground" dir="ltr">
                        {c.cheque_number || '—'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {bank?.nameAr ?? c.bank_code ?? '—'}
                        {c.branch_code && (
                          <span dir="ltr" className="font-mono px-1 mx-1 rounded bg-muted">
                            {c.branch_code}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5 leading-tight">
                      <span className="text-[10px] text-muted-foreground">العميل</span>
                      <span>{c.client_name ?? '—'}</span>
                    </div>
                    <div className="flex flex-col gap-0.5 leading-tight">
                      <span className="text-[10px] text-muted-foreground">تاريخ الاستحقاق</span>
                      <span>{fmtDate(c.payment_date)}</span>
                    </div>
                    <div className="flex flex-col gap-0.5 leading-tight ms-auto">
                      <span className="text-[10px] text-muted-foreground">المبلغ</span>
                      <span
                        className={cn(
                          'font-semibold tabular-nums',
                          voucherKind === 'disbursement' ? 'text-orange-600' : 'text-emerald-600',
                        )}
                      >
                        ₪{c.amount.toLocaleString('en-US')}
                      </span>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 hover:bg-destructive/10"
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
                );
              })}
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
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
