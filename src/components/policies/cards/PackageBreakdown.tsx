import { Badge } from '@/components/ui/badge';
import { PolicyRecord, policyTypeColors, getDisplayLabel } from './types';
import { formatDate, formatCurrency } from '@/lib/utils';

interface PackageBreakdownProps {
  policies: PolicyRecord[];
  onPolicyClick: (policyId: string) => void;
}

export function PackageBreakdown({ policies, onPolicyClick }: PackageBreakdownProps) {
  const totalPrice = policies.reduce(
    (sum, p) => sum + (p.insurance_price || 0) + (p.office_commission || 0),
    0,
  );
  const totalCommission = policies.reduce(
    (sum, p) => sum + (p.office_commission || 0),
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
              const commission = policy.office_commission || 0;
              return (
                <tr
                  key={policy.id}
                  className="border-t hover:bg-muted/20 cursor-pointer transition-colors"
                  onClick={() => onPolicyClick(policy.id)}
                >
                  <td className="p-2 font-semibold">
                    <div className="flex flex-col">
                      <span>{formatCurrency(policy.insurance_price)}</span>
                      {commission > 0 && (
                        <span className="text-[10px] text-amber-700 font-semibold ltr-nums">
                          + {formatCurrency(commission)} عمولة مكتب
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
                  {totalCommission > 0 && (
                    <span className="text-[10px] text-amber-700 font-semibold ltr-nums">
                      منها {formatCurrency(totalCommission)} عمولة مكتب
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
