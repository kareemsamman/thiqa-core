import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowDownRight, ArrowUpRight, Banknote, Building, CreditCard, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useTableColumnVisibility } from '@/hooks/useTableColumnVisibility';
import { ManageColumnsDropdown, ColumnOption } from './ManageColumnsDropdown';
import { PAYMENT_METHOD_LABELS } from './accountingTypes';

export interface SettlementRow {
  id: string;
  settlement_date: string;
  total_amount: number;
  payment_type: string | null;
  cheque_number: string | null;
  status: string;
  refused: boolean | null;
  notes: string | null;
  entity_id: string | null; // company_id or broker_id
  entity_name: string | null; // company or broker name
  direction?: 'we_owe' | 'broker_owes' | null; // brokers only
}

const COLUMNS: ColumnOption[] = [
  { key: 'date', label: 'التاريخ', required: true },
  { key: 'entity', label: 'الجهة', required: true },
  { key: 'amount', label: 'المبلغ', required: true },
  { key: 'payment_type', label: 'طريقة الدفع' },
  { key: 'cheque_number', label: 'رقم الشيك' },
  { key: 'direction', label: 'الاتجاه' },
  { key: 'status', label: 'الحالة' },
  { key: 'notes', label: 'ملاحظات' },
];

const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.key !== 'notes').map((c) => c.key);

interface Props {
  rows: SettlementRow[];
  loading: boolean;
  /** Visual cue + icon. */
  voucherKind: 'disbursement' | 'receipt';
  /** Show a Direction column (only meaningful for brokers). */
  showDirection?: boolean;
  storageId: string;
  entityLabel: string; // "شركة التأمين" / "الوسيط"
}

export function SettlementsTable({
  rows,
  loading,
  voucherKind,
  showDirection = false,
  storageId,
  entityLabel,
}: Props) {
  const defaults = showDirection ? DEFAULT_VISIBLE : DEFAULT_VISIBLE.filter((k) => k !== 'direction');
  const { visible, toggle, reset } = useTableColumnVisibility(storageId, defaults);

  const showCol = (key: string) => visible.includes(key);
  const KindIcon = voucherKind === 'disbursement' ? ArrowUpRight : ArrowDownRight;
  const kindClass = voucherKind === 'disbursement' ? 'text-orange-600' : 'text-emerald-600';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2 px-1">
        <span className="text-xs text-muted-foreground ml-auto inline-flex items-center gap-1.5">
          <KindIcon className={`h-3.5 w-3.5 ${kindClass}`} />
          {loading ? '...' : `${rows.length} سند`}
        </span>
        <ManageColumnsDropdown
          columns={showDirection ? COLUMNS : COLUMNS.filter((c) => c.key !== 'direction')}
          visible={visible}
          onToggle={toggle}
          onReset={reset}
        />
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              {showCol('date') && <TableHead className="whitespace-nowrap min-w-[120px]">التاريخ</TableHead>}
              {showCol('entity') && <TableHead className="whitespace-nowrap min-w-[180px]">{entityLabel}</TableHead>}
              {showCol('amount') && <TableHead className="whitespace-nowrap min-w-[120px]">المبلغ</TableHead>}
              {showCol('payment_type') && <TableHead className="whitespace-nowrap min-w-[120px]">طريقة الدفع</TableHead>}
              {showCol('cheque_number') && <TableHead className="whitespace-nowrap min-w-[120px]">رقم الشيك</TableHead>}
              {showDirection && showCol('direction') && (
                <TableHead className="whitespace-nowrap min-w-[110px]">الاتجاه</TableHead>
              )}
              {showCol('status') && <TableHead className="whitespace-nowrap min-w-[100px]">الحالة</TableHead>}
              {showCol('notes') && <TableHead className="whitespace-nowrap min-w-[180px]">ملاحظات</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  {Array.from({ length: visible.length }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visible.length} className="text-center py-12 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">لا توجد سندات</p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className={r.refused ? 'bg-destructive/5' : ''}>
                  {showCol('date') && (
                    <TableCell className="text-sm whitespace-nowrap">
                      {fmtDate(r.settlement_date)}
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
                    <TableCell className="font-mono text-xs">{r.cheque_number || '-'}</TableCell>
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
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
