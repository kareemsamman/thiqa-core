import { useState, useMemo, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  ChevronDown, 
  ChevronLeft, 
  Eye, 
  Package,
  FileText,
  Car,
  Zap,
  Calendar,
  Building2,
  ArrowUpDown,
  Hash,
  AlertCircle,
  CheckCircle,
  Banknote,
  List,
  Send,
  Loader2,
  MoreVertical,
  XCircle,
  ArrowRightLeft
} from 'lucide-react';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { PackagePaymentModal } from './PackagePaymentModal';
import { SinglePolicyPaymentModal } from './SinglePolicyPaymentModal';
import { supabase } from '@/integrations/supabase/client';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PolicyRecord {
  id: string;
  policy_number: string | null;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  office_commission: number | null;
  profit: number | null;
  cancelled: boolean | null;
  transferred: boolean | null;
  group_id: string | null;
  company: { name: string; name_ar: string | null } | null;
  car: { id: string; car_number: string } | null;
  creator: { full_name: string | null; email: string } | null;
  branch_id?: string | null;
}

interface PolicyTreeViewProps {
  policies: PolicyRecord[];
  onPolicyClick: (policyId: string) => void;
  onPaymentAdded?: () => void | Promise<void>;
  onTransferPolicy?: (policyId: string) => void;
  onCancelPolicy?: (policyId: string) => void;
  onTransferPackage?: (policyIds: string[]) => void;
  onCancelPackage?: (policyIds: string[]) => void;
}

const policyTypeLabels: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
};

const policyTypeColors: Record<string, string> = {
  ELZAMI: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  THIRD_FULL: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  ROAD_SERVICE: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  ACCIDENT_FEE_EXEMPTION: 'bg-green-500/10 text-green-600 border-green-500/20',
  HEALTH: 'bg-pink-500/10 text-pink-600 border-pink-500/20',
  LIFE: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  PROPERTY: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  TRAVEL: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  BUSINESS: 'bg-slate-500/10 text-slate-600 border-slate-500/20',
  OTHER: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

const policyTypeIcons: Record<string, string> = {
  ELZAMI: '🛡️',
  THIRD_FULL: '🚗',
  ROAD_SERVICE: '🛣️',
  ACCIDENT_FEE_EXEMPTION: '💰',
  HEALTH: '🏥',
  LIFE: '❤️',
  PROPERTY: '🏠',
  TRAVEL: '✈️',
  BUSINESS: '💼',
  OTHER: '📄',
};

// Main policy types (parents)
const MAIN_POLICY_TYPES = ['ELZAMI', 'THIRD_FULL', 'HEALTH', 'LIFE', 'PROPERTY', 'TRAVEL', 'BUSINESS', 'OTHER'];
// Add-on types (children)
const ADDON_POLICY_TYPES = ['ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION'];

// Child type labels (for THIRD_FULL)
const policyChildLabels: Record<string, string> = {
  THIRD: 'ثالث',
  FULL: 'شامل',
};

// Helper: get display label (child type if exists for THIRD_FULL, otherwise parent)
const getDisplayLabel = (policy: PolicyRecord) => {
  if (policy.policy_type_parent === 'THIRD_FULL' && policy.policy_type_child) {
    return policyChildLabels[policy.policy_type_child] || policy.policy_type_child;
  }
  return policyTypeLabels[policy.policy_type_parent] || policy.policy_type_parent;
};

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB');
};

const getPolicyStatus = (policy: PolicyRecord) => {
  if (policy.cancelled) return { label: 'ملغاة', variant: 'destructive' as const, isActive: false, priority: 4, color: 'text-destructive' };
  if (policy.transferred) return { label: 'محولة', variant: 'warning' as const, isActive: false, priority: 3, color: 'text-amber-600' };
  const endDate = new Date(policy.end_date);
  const today = new Date();
  if (endDate < today) return { label: 'منتهية', variant: 'secondary' as const, isActive: false, priority: 2, color: 'text-muted-foreground' };
  return { label: 'سارية', variant: 'success' as const, isActive: true, priority: 1, color: 'text-success' };
};

interface PolicyGroup {
  groupId: string | null;
  mainPolicy: PolicyRecord | null;
  addons: PolicyRecord[];
  isActive: boolean;
  newestDate: Date;
  priority: number; // 1=active, 2=expired, 3=transferred, 4=cancelled
}

interface PaymentInfo {
  [policyId: string]: { paid: number; remaining: number };
}

interface PolicyFilesInfo {
  [policyId: string]: boolean; // true if policy has files
}

export function PolicyTreeView({ 
  policies, 
  onPolicyClick, 
  onPaymentAdded,
  onTransferPolicy,
  onCancelPolicy,
  onTransferPackage,
  onCancelPackage
}: PolicyTreeViewProps) {
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo>({});
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [packagePaymentOpen, setPackagePaymentOpen] = useState(false);
  const [selectedPackagePolicyIds, setSelectedPackagePolicyIds] = useState<string[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [sendingPackage, setSendingPackage] = useState<string | null>(null);
  const [sendingPolicy, setSendingPolicy] = useState<string | null>(null);
  const [policyFilesInfo, setPolicyFilesInfo] = useState<PolicyFilesInfo>({});
  
  // Single policy payment modal state
  const [singlePaymentOpen, setSinglePaymentOpen] = useState(false);
  const [selectedSinglePolicy, setSelectedSinglePolicy] = useState<PolicyRecord | null>(null);

  // Fetch payment info and file info for all policies
  useEffect(() => {
    const fetchPaymentAndFilesInfo = async () => {
      if (policies.length === 0) {
        setPaymentInfo({});
        setPolicyFilesInfo({});
        setLoadingPayments(false);
        return;
      }

      setLoadingPayments(true);
      const policyIds = policies.map(p => p.id);
      
      try {
        // Fetch payments
        const { data: paymentsData } = await supabase
          .from('policy_payments')
          .select('policy_id, amount, refused')
          .in('policy_id', policyIds);

        const info: PaymentInfo = {};
        policies.forEach(p => {
          const policyPayments = (paymentsData || [])
            .filter(pay => pay.policy_id === p.id && !pay.refused);
          const paid = policyPayments.reduce((sum, pay) => sum + pay.amount, 0);
      info[p.id] = {
        paid,
        remaining: (p.insurance_price + (p.office_commission || 0)) - paid,
      };
        });
        setPaymentInfo(info);

        // Fetch files info - check which policies have files (ملفات البوليصة = insurance files only)
        const { data: filesData } = await supabase
          .from('media_files')
          .select('entity_id')
          .in('entity_id', policyIds)
          .in('entity_type', ['policy', 'policy_insurance'])
          .is('deleted_at', null);

        const filesInfo: PolicyFilesInfo = {};
        policyIds.forEach(id => {
          filesInfo[id] = (filesData || []).some(f => f.entity_id === id);
        });
        setPolicyFilesInfo(filesInfo);

      } catch (error) {
        console.error('Error fetching payment/files info:', error);
      } finally {
        setLoadingPayments(false);
      }
    };

    fetchPaymentAndFilesInfo();
  }, [policies]);

  // Group policies by group_id
  const groupedPolicies = useMemo(() => {
    const groups: Map<string, PolicyGroup> = new Map();
    const standaloneAddons: PolicyRecord[] = [];
    
    // First pass: group all policies by group_id
    policies.forEach(policy => {
      const isMainType = MAIN_POLICY_TYPES.includes(policy.policy_type_parent);
      const isAddonType = ADDON_POLICY_TYPES.includes(policy.policy_type_parent);
      const status = getPolicyStatus(policy);
      
      // If policy has a group_id, add it to that group
      if (policy.group_id) {
        if (!groups.has(policy.group_id)) {
          groups.set(policy.group_id, {
            groupId: policy.group_id,
            mainPolicy: null,
            addons: [],
            isActive: status.isActive,
            newestDate: new Date(policy.start_date),
            priority: status.priority
          });
        }
        
        const group = groups.get(policy.group_id)!;
        
        // Determine if this should be main policy or addon
        // Priority for main: THIRD_FULL > ELZAMI > others
        if (isMainType) {
          if (!group.mainPolicy) {
            group.mainPolicy = policy;
          } else {
            // Compare to decide which is main
            const currentMainType = group.mainPolicy.policy_type_parent;
            // THIRD_FULL should be main over ELZAMI
            if (policy.policy_type_parent === 'THIRD_FULL' && currentMainType !== 'THIRD_FULL') {
              group.addons.push(group.mainPolicy);
              group.mainPolicy = policy;
            } else if (currentMainType === 'THIRD_FULL') {
              // Current main is THIRD_FULL, add new as addon
              group.addons.push(policy);
            } else {
              // Both are same type or neither is THIRD_FULL, compare by date
              const existingDate = new Date(group.mainPolicy.start_date);
              const newDate = new Date(policy.start_date);
              if (newDate > existingDate) {
                group.addons.push(group.mainPolicy);
                group.mainPolicy = policy;
              } else {
                group.addons.push(policy);
              }
            }
          }
        } else {
          // Add-on type
          group.addons.push(policy);
        }
        
        // Update group status based on most important policy
        if (status.priority < group.priority) {
          group.priority = status.priority;
          group.isActive = status.isActive;
        }
        if (new Date(policy.start_date) > group.newestDate) {
          group.newestDate = new Date(policy.start_date);
        }
      } else {
        // No group_id - standalone policy
        if (isMainType) {
          groups.set(`standalone-${policy.id}`, {
            groupId: null,
            mainPolicy: policy,
            addons: [],
            isActive: status.isActive,
            newestDate: new Date(policy.start_date),
            priority: status.priority
          });
        } else if (isAddonType) {
          // Standalone add-on without a group
          standaloneAddons.push(policy);
        }
      }
    });
    
    // Convert to array and sort
    const groupArray = Array.from(groups.values());
    
    // Add standalone add-ons as their own groups
    standaloneAddons.forEach(addon => {
      const status = getPolicyStatus(addon);
      groupArray.push({
        groupId: null,
        mainPolicy: null,
        addons: [addon],
        isActive: status.isActive,
        newestDate: new Date(addon.start_date),
        priority: status.priority
      });
    });
    
    // Sort: by priority first (1=active, 2=expired, 3=transferred, 4=cancelled), then by newest date descending
    groupArray.sort((a, b) => {
      // First sort by priority (lower = higher priority)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      // Then by newest date descending
      return b.newestDate.getTime() - a.newestDate.getTime();
    });
    
    return groupArray;
  }, [policies]);

  // Track which groups are expanded - active packages collapsed by default, show summary
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Initialize expanded state when grouped policies change
  useEffect(() => {
    // Only set initial state if groups haven't been interacted with
    setExpandedGroups(prev => {
      if (prev.size > 0) return prev; // Don't reset if user has toggled
      // All packages start collapsed to show summary header only
      return new Set<string>();
    });
  }, [groupedPolicies.length]);

  const toggleGroup = (groupKey: string) => {
    // Accordion behavior: open one package at a time
    setExpandedGroups(prev => {
      if (prev.has(groupKey)) return new Set<string>();
      return new Set<string>([groupKey]);
    });
  };

  const handlePackagePayment = (e: React.MouseEvent, policyIds: string[], branchId: string | null) => {
    e.stopPropagation();
    setSelectedPackagePolicyIds(policyIds);
    setSelectedBranchId(branchId);
    setPackagePaymentOpen(true);
  };

  const handleSinglePolicyPayment = (e: React.MouseEvent, policy: PolicyRecord) => {
    e.stopPropagation();
    setSelectedSinglePolicy(policy);
    setSinglePaymentOpen(true);
  };

  const getPackagePaymentStatus = (group: PolicyGroup) => {
    const allPolicyIds = [
      ...(group.mainPolicy ? [group.mainPolicy.id] : []),
      ...group.addons.map(a => a.id)
    ];
    
    let totalPrice = 0;
    let debtPrice = 0; // For remaining calculation, excludes ELZAMI
    let totalPaid = 0;
    
    allPolicyIds.forEach(id => {
      const policy = policies.find(p => p.id === id);
      if (policy) {
        totalPrice += policy.insurance_price + (policy.office_commission || 0);
        // Include all policies in debt (office_commission is always client debt)
        debtPrice += policy.insurance_price + (policy.office_commission || 0);
        totalPaid += paymentInfo[id]?.paid || 0;
      }
    });
    
    // Use debtPrice for remaining calculation - payments on ELZAMI count toward the total
    const remaining = Math.max(0, debtPrice - totalPaid);
    const isPaid = remaining <= 0;
    const percentage = debtPrice > 0 ? Math.round((totalPaid / debtPrice) * 100) : (totalPaid > 0 ? 100 : 0);
    
    return { totalPrice, totalPaid, remaining, isPaid, percentage };
  };

  // Send package invoice/files to customer
  const handleSendPackageInvoice = async (e: React.MouseEvent, policyIds: string[], groupKey: string) => {
    e.stopPropagation();
    setSendingPackage(groupKey);
    try {
      const { data, error } = await supabase.functions.invoke('send-package-invoice-sms', {
        body: { policy_ids: policyIds }
      });

      if (error) {
        const errorMessage = (await extractFunctionErrorMessage(error)) || 'فشل في الإرسال';
        throw new Error(errorMessage);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (data?.success) {
        toast.success('تم إرسال الفواتير للعميل');
      } else {
        toast.info(data?.message || 'تم الإرسال');
      }
    } catch (err: any) {
      console.error('Error sending package invoice:', err);
      toast.error(err.message || 'فشل في الإرسال');
    } finally {
      setSendingPackage(null);
    }
  };

  // Send single policy invoice/files to customer
  const handleSendPolicyInvoice = async (e: React.MouseEvent, policyId: string) => {
    e.stopPropagation();
    setSendingPolicy(policyId);
    try {
      // Unified route — single policies go through the package
      // function with a 1-item array so they use the same printed
      // template as real packages.
      const { data, error } = await supabase.functions.invoke('send-package-invoice-sms', {
        body: { policy_ids: [policyId] }
      });

      if (error) {
        const errorMessage = (await extractFunctionErrorMessage(error)) || 'فشل في الإرسال';
        throw new Error(errorMessage);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      if (data?.success) {
        toast.success('تم إرسال الفاتورة للعميل');
      } else {
        toast.info(data?.message || 'تم الإرسال');
      }
    } catch (err: any) {
      console.error('Error sending policy invoice:', err);
      toast.error(err.message || 'فشل في الإرسال');
    } finally {
      setSendingPolicy(null);
    }
  };

  const refreshPaymentInfo = async () => {
    if (policies.length === 0) return;
    const policyIds = policies.map(p => p.id);
    const { data: paymentsData } = await supabase
      .from('policy_payments')
      .select('policy_id, amount, refused')
      .in('policy_id', policyIds);

    const info: PaymentInfo = {};
    policies.forEach(p => {
      const policyPayments = (paymentsData || [])
        .filter(pay => pay.policy_id === p.id && !pay.refused);
      const paid = policyPayments.reduce((sum, pay) => sum + pay.amount, 0);
      info[p.id] = {
        paid,
        remaining: (p.insurance_price + (p.office_commission || 0)) - paid,
      };
    });
    setPaymentInfo(info);
  };

  if (policies.length === 0) {
    return (
      <Card className="text-center py-12">
        <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-muted-foreground">لا توجد وثائق تأمين</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {groupedPolicies.map((group, groupIndex) => {
        const groupKey = `group-${groupIndex}`;
        const isExpanded = expandedGroups.has(groupKey);
        const hasAddons = group.addons.length > 0;
        const hasMainPolicy = group.mainPolicy !== null;
        const isPackage = hasMainPolicy && hasAddons;
        const totalPrice = ((group.mainPolicy?.insurance_price || 0) + (group.mainPolicy?.office_commission || 0)) + 
          group.addons.reduce((sum, a) => sum + a.insurance_price + (a.office_commission || 0), 0);
        
        // Get payment status for this package/policy
        const paymentStatus = isPackage || hasMainPolicy 
          ? getPackagePaymentStatus(group) 
          : { totalPrice: 0, totalPaid: 0, remaining: 0, isPaid: true, percentage: 100 };
        
        const allPolicyIds = [
          ...(group.mainPolicy ? [group.mainPolicy.id] : []),
          ...group.addons.map(a => a.id)
        ];
        
        // Check if any policy in this group/package has files
        const hasFilesInGroup = allPolicyIds.some(id => policyFilesInfo[id]);
        
        // For groups that only have add-ons without a main policy
        if (!hasMainPolicy && hasAddons) {
          // Render add-ons as standalone items
          return group.addons.map(addon => (
            <UnifiedPolicyCard
              key={addon.id}
              policy={addon}
              isPackage={false}
              addons={[]}
              paymentInfo={paymentInfo[addon.id]}
              onPolicyClick={onPolicyClick}
              onSendInvoice={handleSendPolicyInvoice}
              isSending={sendingPolicy === addon.id}
              onTransfer={onTransferPolicy}
              onCancel={onCancelPolicy}
              onSinglePayment={(e) => handleSinglePolicyPayment(e, addon)}
              hasFiles={policyFilesInfo[addon.id] || false}
            />
          ));
        }
        
        // Single policy without add-ons OR Package with add-ons - same card design
        return (
          <UnifiedPolicyCard
            key={groupKey}
            policy={group.mainPolicy!}
            isPackage={isPackage}
            addons={group.addons}
            paymentInfo={paymentInfo[group.mainPolicy!.id]}
            packagePaymentStatus={paymentStatus}
            allPolicyIds={allPolicyIds}
            groupKey={groupKey}
            isExpanded={isExpanded}
            onToggle={() => toggleGroup(groupKey)}
            onPolicyClick={onPolicyClick}
            onSendInvoice={handleSendPolicyInvoice}
            onSendPackageInvoice={handleSendPackageInvoice}
            isSending={sendingPolicy === group.mainPolicy!.id}
            isSendingPackage={sendingPackage === groupKey}
            onPackagePayment={(e) => handlePackagePayment(e, allPolicyIds, group.mainPolicy?.branch_id || null)}
            onSinglePayment={(e) => handleSinglePolicyPayment(e, group.mainPolicy!)}
            onCancel={onCancelPolicy}
            onTransferPackage={onTransferPackage}
            onCancelPackage={onCancelPackage}
            allPaymentInfo={paymentInfo}
            hasFiles={hasFilesInGroup}
          />
        );
      })}
      
      {/* Package Payment Modal */}
      <PackagePaymentModal
        open={packagePaymentOpen}
        onOpenChange={setPackagePaymentOpen}
        policyIds={selectedPackagePolicyIds}
        branchId={selectedBranchId}
        onSuccess={async () => {
          if (onPaymentAdded) await onPaymentAdded();
          refreshPaymentInfo();
        }}
      />

      {/* Single Policy Payment Modal */}
      {selectedSinglePolicy && (
        <SinglePolicyPaymentModal
          open={singlePaymentOpen}
          onOpenChange={setSinglePaymentOpen}
          policyId={selectedSinglePolicy.id}
          policyType={selectedSinglePolicy.policy_type_parent}
          policyTypeChild={selectedSinglePolicy.policy_type_child}
          insurancePrice={selectedSinglePolicy.insurance_price}
          officeCommission={selectedSinglePolicy.office_commission || 0}
          branchId={selectedSinglePolicy.branch_id}
          onSuccess={async () => {
            if (onPaymentAdded) await onPaymentAdded();
            refreshPaymentInfo();
          }}
        />
      )}
    </div>
  );
}

// Unified card for both standalone policies and packages
function UnifiedPolicyCard({
  policy,
  isPackage,
  addons,
  paymentInfo,
  packagePaymentStatus,
  allPolicyIds,
  groupKey,
  isExpanded,
  onToggle,
  onPolicyClick,
  onSendInvoice,
  onSendPackageInvoice,
  isSending,
  isSendingPackage,
  onPackagePayment,
  onSinglePayment,
  onTransfer,
  onCancel,
  onTransferPackage,
  onCancelPackage,
  allPaymentInfo,
  hasFiles
}: {
  policy: PolicyRecord;
  isPackage: boolean;
  addons: PolicyRecord[];
  paymentInfo?: { paid: number; remaining: number };
  packagePaymentStatus?: { totalPrice: number; totalPaid: number; remaining: number; isPaid: boolean; percentage: number };
  allPolicyIds?: string[];
  groupKey?: string;
  isExpanded?: boolean;
  onToggle?: () => void;
  onPolicyClick: (id: string) => void;
  onSendInvoice: (e: React.MouseEvent, policyId: string) => void;
  onSendPackageInvoice?: (e: React.MouseEvent, policyIds: string[], groupKey: string) => void;
  isSending?: boolean;
  isSendingPackage?: boolean;
  onPackagePayment?: (e: React.MouseEvent) => void;
  onSinglePayment?: (e: React.MouseEvent) => void;
  onTransfer?: (policyId: string) => void;
  onCancel?: (policyId: string) => void;
  onTransferPackage?: (policyIds: string[]) => void;
  onCancelPackage?: (policyIds: string[]) => void;
  allPaymentInfo?: PaymentInfo;
  hasFiles?: boolean;
}) {
  const status = getPolicyStatus(policy);
  const isPaid = isPackage 
    ? (packagePaymentStatus?.isPaid ?? true) 
    : (!paymentInfo || paymentInfo.remaining <= 0);
  const remaining = isPackage 
    ? (packagePaymentStatus?.remaining ?? 0) 
    : (paymentInfo?.remaining ?? 0);
  const totalPrice = isPackage 
    ? (packagePaymentStatus?.totalPrice ?? policy.insurance_price)
    : policy.insurance_price;
  
  const handleToggle = () => {
    onToggle?.();
  };

  return (
    <Card 
      className={cn(
        "group overflow-hidden transition-all duration-200",
        status.isActive 
          ? "bg-card hover:shadow-lg hover:shadow-primary/10 hover:border-primary/30" 
          : "bg-muted/30 hover:bg-muted/50",
        status.priority === 3 && "border-amber-500/30 bg-amber-50/50",
        status.priority === 4 && "border-destructive/30 bg-destructive/5",
        !isPaid && status.isActive && "border-l-4 border-l-destructive"
      )}
    >
      {isPackage ? (
        <div>
          {/* Package Header (click to expand/collapse) */}
          <div
            className="p-4 cursor-pointer"
            onClick={handleToggle}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleToggle();
              }
            }}
          >
            <PolicyCardHeader
              policy={policy}
              isPackage={true}
              addons={addons}
              status={status}
              isPaid={isPaid}
              remaining={remaining}
              totalPrice={totalPrice}
              percentage={packagePaymentStatus?.percentage}
              groupKey={groupKey}
              isExpanded={isExpanded}
              isSending={isSending}
              isSendingPackage={isSendingPackage}
              onPolicyClick={onPolicyClick}
              onSendInvoice={onSendInvoice}
              onSendPackageInvoice={onSendPackageInvoice}
              allPolicyIds={allPolicyIds}
              onPackagePayment={onPackagePayment}
              onTransfer={onTransfer}
              onCancel={onCancel}
              onTransferPackage={onTransferPackage}
              onCancelPackage={onCancelPackage}
              hasFiles={hasFiles}
            />
          </div>

          {/* Package Content */}
          {isExpanded && (
            <div className="border-t">
              {/* Main Policy Row */}
              <div 
                className="flex items-center gap-3 p-4 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors border-b"
                onClick={(e) => {
                  e.stopPropagation();
                  onPolicyClick(policy.id);
                }}
              >
                <div className="w-5" />
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <Badge variant="outline" className="text-xs bg-primary/5">الوثيقة الأساسية</Badge>
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
                  <div>
                    <Badge className={cn("border text-xs", policyTypeColors[policy.policy_type_parent])}>
                      {getDisplayLabel(policy)}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">من: </span>
                    {formatDate(policy.start_date)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">إلى: </span>
                    {formatDate(policy.end_date)}
                  </div>
                  <div className="font-semibold">₪{policy.insurance_price.toLocaleString()}</div>
                  <div className="text-muted-foreground text-xs">
                    {policy.creator?.full_name || policy.creator?.email || '-'}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <Eye className="h-4 w-4" />
                </Button>
              </div>

              {/* Add-on Rows */}
              {addons.map((addon, addonIndex) => (
                <div 
                  key={addon.id}
                  className={cn(
                    "flex items-center gap-3 p-4 pr-12 cursor-pointer hover:bg-muted/30 transition-colors",
                    addonIndex < addons.length - 1 && "border-b border-dashed"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPolicyClick(addon.id);
                  }}
                >
                  <div className="w-5 flex justify-center">
                    <div className="w-px h-full bg-border" />
                  </div>
                  <Zap className="h-4 w-4 text-orange-500 shrink-0" />
                  <Badge variant="outline" className="text-xs bg-orange-50 text-orange-600 border-orange-200">إضافة</Badge>
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
                    <div>
                      <Badge className={cn("border text-xs", policyTypeColors[addon.policy_type_parent])}>
                        {getDisplayLabel(addon)}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">من: </span>
                      {formatDate(addon.start_date)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">إلى: </span>
                      {formatDate(addon.end_date)}
                    </div>
                    <div className="font-semibold">₪{addon.insurance_price.toLocaleString()}</div>
                    <div className="text-muted-foreground text-xs">
                      {addon.creator?.full_name || addon.creator?.email || '-'}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="p-4">
          <PolicyCardHeader
            policy={policy}
            isPackage={false}
            addons={[]}
            status={status}
            isPaid={isPaid}
            remaining={remaining}
            totalPrice={totalPrice}
            isSending={isSending}
            onPolicyClick={onPolicyClick}
            onSendInvoice={onSendInvoice}
            onTransfer={onTransfer}
            onCancel={onCancel}
            hasFiles={hasFiles}
          />
        </div>
      )}
    </Card>
  );
}

// Shared header component for both package and standalone cards
function PolicyCardHeader({
  policy,
  isPackage,
  addons,
  status,
  isPaid,
  remaining,
  totalPrice,
  percentage,
  groupKey,
  isExpanded,
  isSending,
  isSendingPackage,
  onPolicyClick,
  onSendInvoice,
  onSendPackageInvoice,
  allPolicyIds,
  onPackagePayment,
  onSinglePayment,
  onTransfer,
  onCancel,
  onTransferPackage,
  onCancelPackage,
  hasFiles
}: {
  policy: PolicyRecord;
  isPackage: boolean;
  addons: PolicyRecord[];
  status: ReturnType<typeof getPolicyStatus>;
  isPaid: boolean;
  remaining: number;
  totalPrice: number;
  percentage?: number;
  groupKey?: string;
  isExpanded?: boolean;
  isSending?: boolean;
  isSendingPackage?: boolean;
  onPolicyClick: (id: string) => void;
  onSendInvoice: (e: React.MouseEvent, policyId: string) => void;
  onSendPackageInvoice?: (e: React.MouseEvent, policyIds: string[], groupKey: string) => void;
  allPolicyIds?: string[];
  onPackagePayment?: (e: React.MouseEvent) => void;
  onSinglePayment?: (e: React.MouseEvent) => void;
  onTransfer?: (policyId: string) => void;
  onCancel?: (policyId: string) => void;
  onTransferPackage?: (policyIds: string[]) => void;
  onCancelPackage?: (policyIds: string[]) => void;
  hasFiles?: boolean;
}) {
  return (
    <div className="space-y-3">
      {/* Top Row */}
      <div className="flex items-center flex-wrap gap-2 sm:gap-3">
        {/* Expand/Collapse for packages */}
        {isPackage && (
          <div className="shrink-0">
            {isExpanded ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronLeft className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        )}
        
        {/* Package or Policy Type Badge */}
        {isPackage ? (
          <Badge variant="outline" className="gap-1.5 bg-primary/10 text-primary border-primary/20">
            <Package className="h-3.5 w-3.5" />
            باقة
          </Badge>
        ) : (
          <span className="text-xl">{policyTypeIcons[policy.policy_type_parent] || '📄'}</span>
        )}
        
        {/* For packages: show all policy types in summary */}
        {isPackage ? (
          <div className="flex flex-wrap gap-1 items-center">
            {/* Main policy type */}
            <Badge className={cn("border text-xs", policyTypeColors[policy.policy_type_parent])}>
              {getDisplayLabel(policy)}
            </Badge>
            {/* All addon types - show as chips with + between them */}
            {addons.map((addon) => (
              <span key={addon.id} className="flex items-center gap-1">
                <span className="text-muted-foreground">+</span>
                <Badge className={cn("border text-xs", policyTypeColors[addon.policy_type_parent])}>
                  {getDisplayLabel(addon)}
                </Badge>
              </span>
            ))}
          </div>
        ) : (
          <Badge className={cn("border font-semibold", policyTypeColors[policy.policy_type_parent])}>
            {getDisplayLabel(policy)}
          </Badge>
        )}
        
        {/* Transferred Badge */}
        {policy.transferred && (
          <Badge variant="warning" className="gap-1">
            <ArrowUpDown className="h-3 w-3" />
            محولة
          </Badge>
        )}
        
        {/* Payment Status */}
        {!isPaid && status.isActive && (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            متبقي ₪{remaining.toLocaleString()}
          </Badge>
        )}
        {isPaid && (
          <Badge variant="success" className="gap-1 hidden sm:flex">
            <CheckCircle className="h-3 w-3" />
            مدفوع
          </Badge>
        )}
        
        {/* Spacer */}
        <div className="flex-1" />
        
        {/* Actions Group */}
        <div className="flex items-center gap-2">
          {/* Pay Button (Package or Single) */}
          {!isPaid && status.isActive && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
              onClick={(e) => {
                e.stopPropagation();
                if (isPackage && onPackagePayment) {
                  onPackagePayment(e);
                } else if (!isPackage && onSinglePayment) {
                  onSinglePayment(e);
                }
              }}
            >
              <Banknote className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{isPackage ? 'دفع للباقة' : 'دفع'}</span>
            </Button>
          )}
          
          {/* Send Invoice Button - only show if files exist */}
          {hasFiles && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={(e) => {
                e.stopPropagation();
                if (isPackage && onSendPackageInvoice && allPolicyIds && groupKey) {
                  onSendPackageInvoice(e, allPolicyIds, groupKey);
                } else {
                  onSendInvoice(e, policy.id);
                }
              }}
              disabled={isPackage ? isSendingPackage : isSending}
            >
              {(isPackage ? isSendingPackage : isSending) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">إرسال للعميل</span>
            </Button>
          )}
          
          {/* Status */}
          <ExpiryBadge endDate={policy.end_date} cancelled={policy.cancelled} />
          
          {/* Actions Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation();
                onPolicyClick(policy.id);
              }}>
                <Eye className="h-4 w-4 ml-2" />
                عرض التفاصيل
              </DropdownMenuItem>
              
              {status.isActive && (
                <>
                  <DropdownMenuSeparator />
                  {isPackage && onTransferPackage && allPolicyIds && (
                    <DropdownMenuItem onClick={(e) => {
                      e.stopPropagation();
                      onTransferPackage(allPolicyIds);
                    }}>
                      <ArrowRightLeft className="h-4 w-4 ml-2" />
                      تحويل الباقة كاملة
                    </DropdownMenuItem>
                  )}
                  {!isPackage && onTransfer && (
                    <DropdownMenuItem onClick={(e) => {
                      e.stopPropagation();
                      onTransfer(policy.id);
                    }}>
                      <ArrowRightLeft className="h-4 w-4 ml-2" />
                      تحويل الوثيقة
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {isPackage && onCancelPackage && allPolicyIds && (
                    <DropdownMenuItem 
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancelPackage(allPolicyIds);
                      }}
                    >
                      <XCircle className="h-4 w-4 ml-2" />
                      إلغاء الباقة كاملة
                    </DropdownMenuItem>
                  )}
                  {!isPackage && onCancel && (
                    <DropdownMenuItem 
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancel(policy.id);
                      }}
                    >
                      <XCircle className="h-4 w-4 ml-2" />
                      إلغاء الوثيقة
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      {/* Bottom Row - Details Grid */}
      <div 
        className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onPolicyClick(policy.id);
        }}
      >
        {/* Policy Number */}
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">رقم الوثيقة</p>
            <p className="font-mono font-medium ltr-nums">{policy.policy_number || '-'}</p>
          </div>
        </div>
        
        {/* Company */}
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">الشركة</p>
            <p className="font-medium truncate">{policy.company?.name_ar || policy.company?.name || '-'}</p>
          </div>
        </div>
        
        {/* Car */}
        <div className="flex items-center gap-2">
          <Car className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">السيارة</p>
            <p className="font-mono font-medium ltr-nums">{policy.car?.car_number || '-'}</p>
          </div>
        </div>
        
        {/* Dates */}
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">الفترة</p>
            <p className="font-medium text-xs">
              <span className="ltr-nums">{formatDate(policy.start_date)}</span>
              <span className="mx-1 text-muted-foreground">←</span>
              <span className="ltr-nums">{formatDate(policy.end_date)}</span>
            </p>
          </div>
        </div>
        
        {/* Price */}
        <div className="flex items-center justify-end gap-2">
          <div className="text-left">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
              {isPackage ? 'الإجمالي' : 'السعر'}
            </p>
            <p className={cn(
              "text-lg font-bold ltr-nums",
              status.isActive ? "text-primary" : "text-muted-foreground"
            )}>
              ₪{totalPrice.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
