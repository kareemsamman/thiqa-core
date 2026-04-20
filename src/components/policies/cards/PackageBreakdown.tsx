import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { PolicyRecord, policyTypeColors, getDisplayLabel } from './types';
import { formatDate, formatCurrency } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface PackageBreakdownProps {
  policies: PolicyRecord[];
  onPolicyClick: (policyId: string) => void;
}

interface TransferAdjustment {
  amount: number;
  customerNote: string | null;
  officeNote: string | null;
  adjustmentNote: string | null;
}

export function PackageBreakdown({ policies, onPolicyClick }: PackageBreakdownProps) {
  // Fetch per-policy transfer adjustment so we can split the "عمولة"
  // line into "عمولة مكتب" (original) and "عمولة التحويل" (transfer fee)
  // whenever a policy in this package was created by a customer-pays
  // transfer. The three transfer notes ride along so the standalone
  // "عمولة التحويل" row can surface them underneath.
  const [transferAdjustments, setTransferAdjustments] = useState<Record<string, TransferAdjustment>>({});
  useEffect(() => {
    const transferredIds = policies
      .filter(p => (p as any).transferred_from_policy_id)
      .map(p => p.id);
    if (transferredIds.length === 0) {
      setTransferAdjustments({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('policy_transfers')
        .select('new_policy_id, adjustment_amount, adjustment_type, note, office_note, adjustment_note')
        .in('new_policy_id', transferredIds);
      if (cancelled) return;
      const map: Record<string, TransferAdjustment> = {};
      (data || []).forEach((row: any) => {
        if (
          row?.new_policy_id &&
          row?.adjustment_type === 'customer_pays' &&
          Number(row?.adjustment_amount) > 0
        ) {
          map[row.new_policy_id] = {
            amount: Number(row.adjustment_amount),
            customerNote: typeof row.note === 'string' && row.note.trim() ? row.note.trim() : null,
            officeNote: typeof row.office_note === 'string' && row.office_note.trim() ? row.office_note.trim() : null,
            adjustmentNote: typeof row.adjustment_note === 'string' && row.adjustment_note.trim() ? row.adjustment_note.trim() : null,
          };
        }
      });
      setTransferAdjustments(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [policies]);

  const totalPrice = policies.reduce(
    (sum, p) => sum + (p.insurance_price || 0) + (p.office_commission || 0),
    0,
  );
  const totalOfficeCommission = policies.reduce(
    (sum, p) => sum + Math.max(0, (p.office_commission || 0) - (transferAdjustments[p.id]?.amount || 0)),
    0,
  );
  const totalTransferCommission = policies.reduce(
    (sum, p) => sum + (transferAdjustments[p.id]?.amount || 0),
    0,
  );
  const affectedAdjustments = policies
    .map(p => transferAdjustments[p.id])
    .filter((a): a is TransferAdjustment => !!a && a.amount > 0);
  const dedupe = (vals: (string | null)[]) =>
    Array.from(new Set(vals.filter((v): v is string => !!v)));
  const transferCustomerNotes = dedupe(affectedAdjustments.map(a => a.customerNote));
  const transferOfficeNotes = dedupe(affectedAdjustments.map(a => a.officeNote));
  const transferAdjustmentNotes = dedupe(affectedAdjustments.map(a => a.adjustmentNote));
  const hasAnyTransferNote =
    transferCustomerNotes.length +
    transferOfficeNotes.length +
    transferAdjustmentNotes.length > 0;

  return (
    <div className="border-t bg-muted/10 mt-3">
      <div className="p-2 text-xs font-medium text-muted-foreground">
        مكونات الباقة ({policies.length})
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-right p-2 font-medium">المبلغ</th>
              <th className="text-right p-2 font-medium">الفترة</th>
              <th className="text-right p-2 font-medium">النوع</th>
              <th className="text-right p-2 font-medium">الشركة</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => {
              const totalCommission = policy.office_commission || 0;
              const transferPortion = transferAdjustments[policy.id]?.amount || 0;
              // Strip the transfer portion out of this row — it shows
              // up as its own standalone line below the policy rows,
              // so the policy row only surfaces the original office
              // commission (if any).
              const officePortion = Math.max(0, totalCommission - transferPortion);
              return (
                <tr
                  key={policy.id}
                  className="border-t hover:bg-muted/20 cursor-pointer transition-colors"
                  onClick={() => onPolicyClick(policy.id)}
                >
                  <td className="p-2 font-semibold">
                    <div className="flex flex-col">
                      <span>{formatCurrency(policy.insurance_price)}</span>
                      {officePortion > 0 && (
                        <span className="text-[10px] text-amber-700 font-semibold ltr-nums">
                          + {formatCurrency(officePortion)} عمولة مكتب
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {formatDate(policy.end_date)} ← {formatDate(policy.start_date)}
                  </td>
                  <td className="p-2">
                    <Badge className={policyTypeColors[policy.policy_type_parent]}>
                      {getDisplayLabel(policy)}
                    </Badge>
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {policy.insurance_companies?.name_ar || policy.insurance_companies?.name || '-'}
                  </td>
                </tr>
              );
            })}
            {/* Standalone 'عمولة التحويل' row — aggregated across the
                package (the fee is a transfer-level charge, not tied
                to a specific بوليصة). The three transfer notes appear
                in a footer row underneath so the breakdown reads:
                [component, ..., transfer fee, transfer notes] →
                الإجمالي. */}
            {totalTransferCommission > 0 && (
              <tr className="border-t bg-sky-50/40">
                <td className="p-2 font-semibold text-sky-800">
                  {formatCurrency(totalTransferCommission)}
                </td>
                <td className="p-2 text-xs text-muted-foreground" />
                <td className="p-2">
                  <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100 border-sky-200">
                    عمولة التحويل
                  </Badge>
                </td>
                <td className="p-2 text-muted-foreground text-xs" />
              </tr>
            )}
            {hasAnyTransferNote && (
              <tr className="bg-sky-50/20">
                <td colSpan={4} className="px-3 pb-2 pt-1 text-[11px] text-muted-foreground space-y-0.5">
                  {transferCustomerNotes.map((n, i) => (
                    <div key={`c-${i}`} className="flex gap-1.5">
                      <span className="font-semibold text-foreground/80 shrink-0">ملاحظة التحويل:</span>
                      <span className="line-clamp-2">{n}</span>
                    </div>
                  ))}
                  {transferOfficeNotes.map((n, i) => (
                    <div key={`o-${i}`} className="flex gap-1.5">
                      <span className="font-semibold text-foreground/80 shrink-0">ملاحظات المكتب:</span>
                      <span className="line-clamp-2">{n}</span>
                    </div>
                  ))}
                  {transferAdjustmentNotes.map((n, i) => (
                    <div key={`a-${i}`} className="flex gap-1.5">
                      <span className="font-semibold text-foreground/80 shrink-0">ملاحظة التعديل المالي:</span>
                      <span className="line-clamp-2">{n}</span>
                    </div>
                  ))}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-bold">
              <td className="p-2">
                <div className="flex flex-col">
                  <span className="text-primary">{formatCurrency(totalPrice)}</span>
                  {totalOfficeCommission > 0 && (
                    <span className="text-[10px] text-amber-700 font-semibold ltr-nums">
                      منها {formatCurrency(totalOfficeCommission)} عمولة مكتب
                    </span>
                  )}
                  {totalTransferCommission > 0 && (
                    <span className="text-[10px] text-sky-700 font-semibold ltr-nums">
                      منها {formatCurrency(totalTransferCommission)} عمولة تحويل
                    </span>
                  )}
                </div>
              </td>
              <td className="p-2 text-xs text-muted-foreground" colSpan={3}>
                الإجمالي
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
