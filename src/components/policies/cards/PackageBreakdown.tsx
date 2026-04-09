import { Badge } from '@/components/ui/badge';
import { PolicyRecord, policyTypeColors, getDisplayLabel } from './types';
import { formatDate, formatCurrency } from '@/lib/utils';

interface PackageBreakdownProps {
  policies: PolicyRecord[];
  onPolicyClick: (policyId: string) => void;
}

export function PackageBreakdown({ policies, onPolicyClick }: PackageBreakdownProps) {
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
            {policies.map((policy) => (
              <tr 
                key={policy.id} 
                className="border-t hover:bg-muted/20 cursor-pointer transition-colors"
                onClick={() => onPolicyClick(policy.id)}
              >
                <td className="p-2 font-semibold">
                  {formatCurrency(policy.insurance_price)}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
