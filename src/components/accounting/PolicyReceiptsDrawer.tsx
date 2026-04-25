import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Banknote, FileText, Building, CreditCard, Wallet, type LucideIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

interface Receipt {
  id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  cheque_number: string | null;
  refused: boolean | null;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string | null;
  policyNumber?: string | null;
  clientName?: string | null;
}

const PAYMENT_TYPE_META: Record<string, { label: string; Icon: LucideIcon; cls: string }> = {
  cash: { label: 'نقدي', Icon: Banknote, cls: 'text-emerald-600' },
  cheque: { label: 'شيك', Icon: FileText, cls: 'text-blue-600' },
  transfer: { label: 'تحويل بنكي', Icon: Building, cls: 'text-violet-600' },
  visa: { label: 'فيزا', Icon: CreditCard, cls: 'text-amber-600' },
  customer_cheque: { label: 'شيك عميل', Icon: Wallet, cls: 'text-fuchsia-600' },
};

export function PolicyReceiptsDrawer({
  open,
  onOpenChange,
  policyId,
  policyNumber,
  clientName,
}: Props) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !policyId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('policy_payments')
        .select('id, amount, payment_date, payment_type, cheque_number, refused, notes')
        .eq('policy_id', policyId)
        .order('payment_date', { ascending: false });
      if (!cancelled) {
        setReceipts((data ?? []) as Receipt[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, policyId]);

  const total = receipts
    .filter((r) => !r.refused)
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="space-y-1 text-right">
          <SheetTitle>سندات القبض</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {clientName ? `${clientName} — ` : ''}
            {policyNumber ? `بوليصة ${policyNumber}` : 'البوليصة'}
          </p>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : receipts.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              لا توجد سندات قبض لهذه البوليصة
            </div>
          ) : (
            <>
              <div className="rounded-lg border bg-muted/30 px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {receipts.length} سند {receipts.some((r) => r.refused) ? '(تشمل مرفوضة)' : ''}
                </span>
                <span className="text-lg font-bold tabular-nums">
                  ₪{total.toLocaleString('en-US')}
                </span>
              </div>

              {receipts.map((r) => {
                const meta = PAYMENT_TYPE_META[r.payment_type] ?? PAYMENT_TYPE_META.cash;
                const Icon = meta.Icon;
                return (
                  <div
                    key={r.id}
                    className="rounded-lg border p-3 flex items-start gap-3"
                  >
                    <div className={`h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0 ${meta.cls}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{meta.label}</span>
                        <span className="font-bold tabular-nums">
                          ₪{Number(r.amount).toLocaleString('en-US')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{format(new Date(r.payment_date), 'dd/MM/yyyy')}</span>
                        {r.cheque_number && <span>#{r.cheque_number}</span>}
                        {r.refused && (
                          <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                            مرفوض
                          </Badge>
                        )}
                      </div>
                      {r.notes && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.notes}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
