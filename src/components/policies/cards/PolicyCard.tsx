import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PolicyRecord, PolicyGroup, PaymentStatus, getPolicyStatus } from './types';
import { PolicyCardHeader } from './PolicyCardHeader';
import { PolicyCardInfo } from './PolicyCardInfo';
import { PackageBreakdown } from './PackageBreakdown';
import { supabase } from '@/integrations/supabase/client';

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
  // policies.notes is reused as the office-only note on transferred
  // packages (see TransferPolicyModal), so we keep it as the office
  // note here and pull the two other transfer-specific notes
  // (customer + financial adjustment) from policy_transfers below.
  const officeNote = mainPolicy.notes;
  const transferredPolicyIds = allPolicies
    .filter(p => (p as any).transferred_from_policy_id)
    .map(p => p.id);
  const [customerNote, setCustomerNote] = useState<string | null>(null);
  const [adjustmentNote, setAdjustmentNote] = useState<string | null>(null);
  useEffect(() => {
    if (transferredPolicyIds.length === 0) {
      setCustomerNote(null);
      setAdjustmentNote(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('policy_transfers')
        .select('note, adjustment_note')
        .in('new_policy_id', transferredPolicyIds);
      if (cancelled) return;
      const firstCustomerNote = (data || [])
        .map((r: any) => r?.note)
        .find((n: string | null | undefined) => typeof n === 'string' && n.trim().length > 0) || null;
      const firstAdjustmentNote = (data || [])
        .map((r: any) => r?.adjustment_note)
        .find((n: string | null | undefined) => typeof n === 'string' && n.trim().length > 0) || null;
      setCustomerNote(firstCustomerNote);
      setAdjustmentNote(firstAdjustmentNote);
    })();
    return () => {
      cancelled = true;
    };
  }, [transferredPolicyIds.join('|')]);
  const hasAnyNote = !!(officeNote || customerNote || adjustmentNote);

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
            <span className="text-xs mr-1">عرض التفاصيل ({allPolicies.length} معاملات)</span>
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

      {/* Notes Footer — up to three labeled lines. Each is internal-
          only (office note + adjustment note) except for the customer
          note, which is the one the customer sees on the printed
          invoice. We still show it here so staff can see everything
          in one place. Each line is skipped when its value is empty. */}
      {hasAnyNote && (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground bg-muted/5 space-y-1">
          {officeNote && (
            <div className="flex gap-1.5">
              <span className="font-semibold text-foreground/80 shrink-0">ملاحظات المكتب:</span>
              <span className="line-clamp-2">{officeNote}</span>
            </div>
          )}
          {customerNote && (
            <div className="flex gap-1.5">
              <span className="font-semibold text-foreground/80 shrink-0">ملاحظات الزبون:</span>
              <span className="line-clamp-2">{customerNote}</span>
            </div>
          )}
          {adjustmentNote && (
            <div className="flex gap-1.5">
              <span className="font-semibold text-foreground/80 shrink-0">ملاحظة التعديل المالي:</span>
              <span className="line-clamp-2">{adjustmentNote}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
