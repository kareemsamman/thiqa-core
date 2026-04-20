import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { PolicyRecord, policyTypeColors, getDisplayLabel } from './types';
import { formatDate, formatCurrency } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface PackageBreakdownProps {
  policies: PolicyRecord[];
  onPolicyClick: (policyId: string) => void;
}

export function PackageBreakdown({ policies, onPolicyClick }: PackageBreakdownProps) {
  // Fetch per-policy transfer adjustment so we can split the "عمولة"
  // line into "عمولة مكتب" (original) and "عمولة تحويل" (transfer fee)
  // whenever a policy in this package was created by a customer-pays
  // transfer. Transfer adjustments live on policy_transfers, not on
  // policies itself, so they need their own lookup.
  const [transferAdjustments, setTransferAdjustments] = useState<Record<string, number>>({});
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
        .select('new_policy_id, adjustment_amount, adjustment_type')
        .in('new_policy_id', transferredIds);
      if (cancelled) return;
      const map: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        if (
          row?.new_policy_id &&
          row?.adjustment_type === 'customer_pays' &&
          Number(row?.adjustment_amount) > 0
        ) {
          map[row.new_policy_id] = Number(row.adjustment_amount);
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
    (sum, p) => sum + Math.max(0, (p.office_commission || 0) - (transferAdjustments[p.id] || 0)),
    0,
  );
  const totalTransferCommission = policies.reduce(
    (sum, p) => sum + (transferAdjustments[p.id] || 0),
    0,
  );

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
              const transferPortion = transferAdjustments[policy.id] || 0;
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
                      {transferPortion > 0 && (
                        <span className="text-[10px] text-sky-700 font-semibold ltr-nums">
                          + {formatCurrency(transferPortion)} عمولة تحويل
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
