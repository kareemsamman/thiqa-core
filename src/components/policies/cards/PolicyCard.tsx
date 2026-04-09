import { Card } from '@/components/ui/card';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PolicyRecord, PolicyGroup, PaymentStatus, getPolicyStatus } from './types';
import { PolicyCardHeader } from './PolicyCardHeader';
import { PolicyCardInfo } from './PolicyCardInfo';
import { PackageBreakdown } from './PackageBreakdown';

interface PolicyCardProps {
  group: PolicyGroup;
  paymentStatus: PaymentStatus;
  isExpanded: boolean;
  sendingPolicy: string | null;
  onToggleExpand: () => void;
  onPolicyClick: (policyId: string) => void;
  onSendInvoice: (e: React.MouseEvent, policyId: string) => void;
  onEditPolicy: (policy: PolicyRecord) => void;
  onDeletePolicy: (policy: PolicyRecord) => void;
}

export function PolicyCard({
  group,
  paymentStatus,
  isExpanded,
  sendingPolicy,
  onToggleExpand,
  onPolicyClick,
  onSendInvoice,
  onEditPolicy,
  onDeletePolicy,
}: PolicyCardProps) {
  const mainPolicy = group.mainPolicy!;
  const isPackage = group.addons.length > 0;
  const allPolicies = [mainPolicy, ...group.addons];
  const status = getPolicyStatus(mainPolicy);
  const notes = mainPolicy.notes;

  const handleCardClick = () => {
    if (isPackage) {
      onToggleExpand();
    } else {
      onPolicyClick(mainPolicy.id);
    }
  };

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all duration-200 cursor-pointer",
        status.isActive 
          ? "bg-card hover:shadow-lg hover:shadow-primary/10 hover:border-primary/30" 
          : "bg-muted/30 hover:bg-muted/50",
        status.priority === 3 && "border-warning/30 bg-warning/5",
        status.priority === 4 && "border-destructive/30 bg-destructive/5",
        !paymentStatus.isPaid && status.isActive && "border-r-4 border-r-destructive"
      )}
      onClick={handleCardClick}
    >
      <div className="p-4">
        {/* Header: Status chips + Actions */}
        <PolicyCardHeader
          mainPolicy={mainPolicy}
          paymentStatus={paymentStatus}
          isPackage={isPackage}
          sendingPolicy={sendingPolicy}
          onSendInvoice={onSendInvoice}
          onPolicyClick={onPolicyClick}
          onEditPolicy={onEditPolicy}
          onDeletePolicy={onDeletePolicy}
        />

        {/* Main Info Row */}
        <PolicyCardInfo
          group={group}
          paymentStatus={paymentStatus}
          isExpanded={isExpanded}
          allPolicies={allPolicies}
        />

        {/* Expand indicator for packages */}
        {isPackage && !isExpanded && (
          <div className="flex items-center justify-center mt-2 text-muted-foreground">
            <ChevronDown className="h-4 w-4" />
            <span className="text-xs mr-1">عرض التفاصيل ({allPolicies.length} وثائق)</span>
          </div>
        )}
      </div>

      {/* Package Mode: Breakdown Table */}
      {isPackage && isExpanded && (
        <PackageBreakdown 
          policies={allPolicies} 
          onPolicyClick={(id) => {
            // Stop propagation to prevent card click
            onPolicyClick(id);
          }}
        />
      )}

      {/* Notes Footer */}
      {notes && (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground bg-muted/5">
          <span className="line-clamp-1">📝 {notes}</span>
        </div>
      )}
    </Card>
  );
}
