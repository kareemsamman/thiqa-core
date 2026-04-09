import { Badge } from '@/components/ui/badge';
import { PolicyRecord, PolicyGroup, PaymentStatus, policyTypeColors, getDisplayLabel } from './types';
import { formatDate, formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface PolicyCardInfoProps {
  group: PolicyGroup;
  paymentStatus: PaymentStatus;
  isExpanded: boolean;
  allPolicies: PolicyRecord[];
}

export function PolicyCardInfo({ 
  group, 
  paymentStatus, 
  isExpanded,
  allPolicies 
}: PolicyCardInfoProps) {
  const mainPolicy = group.mainPolicy!;
  const isPackage = group.addons.length > 0;
  const carNumber = group.car?.car_number || '-';
  const companyName = mainPolicy.insurance_companies?.name_ar || mainPolicy.insurance_companies?.name || '-';

  return (
    <div className="mt-3">
      {/* Main Info Row - Horizontal */}
      <div className={cn(
        "flex items-center gap-4",
        "flex-wrap sm:flex-nowrap"
      )}>
        {/* Amount - Primary, Large */}
        <span className="text-xl font-bold shrink-0">
          {formatCurrency(paymentStatus.totalPrice)}
        </span>

        {/* Remaining (if not paid and active) */}
        {!paymentStatus.isPaid && paymentStatus.remaining > 0 && (
          <Badge variant="destructive" className="shrink-0">
            متبقي {formatCurrency(paymentStatus.remaining)}
          </Badge>
        )}

        {/* Period */}
        <span className="text-sm text-muted-foreground shrink-0">
          {formatDate(mainPolicy.end_date)} ← {formatDate(mainPolicy.start_date)}
        </span>

        {/* Car Number */}
        <span className="font-mono text-sm shrink-0">{carNumber}</span>

        {/* Company */}
        <span className="text-sm truncate">{companyName}</span>
      </div>

      {/* Package Type Chips - Only in expanded mode or single policy */}
      {(isExpanded || !isPackage) && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {allPolicies.map((p) => (
            <Badge 
              key={p.id} 
              className={cn("border text-xs", policyTypeColors[p.policy_type_parent])}
            >
              {getDisplayLabel(p)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
