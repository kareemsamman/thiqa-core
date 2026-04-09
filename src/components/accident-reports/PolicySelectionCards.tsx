import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  FileText, 
  Building2, 
  Calendar, 
  Package, 
  ChevronLeft,
  Car as CarIcon 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getInsuranceTypeLabel } from '@/lib/insuranceTypes';

interface PolicyRecord {
  id: string;
  policy_number: string | null;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  cancelled: boolean | null;
  transferred: boolean | null;
  group_id: string | null;
  company: { id?: string; name: string; name_ar: string | null } | null;
  car: { id: string; car_number: string } | null;
}

interface PolicySelectionCardsProps {
  policies: PolicyRecord[];
  onPolicySelect: (policyId: string) => void;
  loading?: boolean;
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
};

// Types eligible for accident reports (exclude ELZAMI)
const ACCIDENT_ELIGIBLE_TYPES = ['THIRD_FULL', 'ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION'];

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB');
};

const getPolicyStatus = (policy: PolicyRecord) => {
  if (policy.cancelled) return { label: 'ملغاة', isActive: false, color: 'text-destructive' };
  if (policy.transferred) return { label: 'محولة', isActive: false, color: 'text-amber-600' };
  const endDate = new Date(policy.end_date);
  const today = new Date();
  if (endDate < today) return { label: 'منتهية', isActive: false, color: 'text-muted-foreground' };
  return { label: 'سارية', isActive: true, color: 'text-success' };
};

interface PolicyGroup {
  groupId: string | null;
  policies: PolicyRecord[];
  isPackage: boolean;
  isActive: boolean;
}

export function PolicySelectionCards({ 
  policies, 
  onPolicySelect, 
  loading = false 
}: PolicySelectionCardsProps) {
  const [selectedPackagePolicy, setSelectedPackagePolicy] = useState<string | null>(null);

  // Filter policies to only eligible types and group them
  const groupedPolicies = useMemo(() => {
    // First filter to eligible types only
    const eligiblePolicies = policies.filter(p => 
      !p.cancelled && 
      !p.transferred &&
      ACCIDENT_ELIGIBLE_TYPES.includes(p.policy_type_parent)
    );

    // Group by group_id
    const groups: Map<string, PolicyGroup> = new Map();
    const standalone: PolicyRecord[] = [];

    eligiblePolicies.forEach(policy => {
      if (policy.group_id) {
        if (!groups.has(policy.group_id)) {
          groups.set(policy.group_id, {
            groupId: policy.group_id,
            policies: [],
            isPackage: true,
            isActive: true,
          });
        }
        groups.get(policy.group_id)!.policies.push(policy);
      } else {
        standalone.push(policy);
      }
    });

    // Check for packages that have ELZAMI in them but show the eligible ones
    // Get all policies with their group_ids to check packages
    const allPoliciesWithGroups = policies.filter(p => !p.cancelled && !p.transferred);
    
    // Check each group for package policies (might have ELZAMI + others)
    allPoliciesWithGroups.forEach(policy => {
      if (policy.group_id && !groups.has(policy.group_id)) {
        // Check if this group has eligible policies
        const groupPolicies = allPoliciesWithGroups.filter(
          p => p.group_id === policy.group_id && ACCIDENT_ELIGIBLE_TYPES.includes(p.policy_type_parent)
        );
        if (groupPolicies.length > 0) {
          groups.set(policy.group_id, {
            groupId: policy.group_id,
            policies: groupPolicies,
            isPackage: true,
            isActive: true,
          });
        }
      }
    });

    const groupArray = Array.from(groups.values());
    
    // Add standalone policies as single-item groups
    standalone.forEach(policy => {
      groupArray.push({
        groupId: null,
        policies: [policy],
        isPackage: false,
        isActive: getPolicyStatus(policy).isActive,
      });
    });

    // Sort by active status and date
    groupArray.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      const aDate = new Date(a.policies[0]?.start_date || 0);
      const bDate = new Date(b.policies[0]?.start_date || 0);
      return bDate.getTime() - aDate.getTime();
    });

    return groupArray;
  }, [policies]);

  const handlePackageSelect = (group: PolicyGroup) => {
    if (group.policies.length === 1) {
      // Single policy - select directly
      onPolicySelect(group.policies[0].id);
    } else {
      // Multiple policies - show dropdown
      setSelectedPackagePolicy(group.groupId);
    }
  };

  const handleSubPolicySelect = (policyId: string) => {
    onPolicySelect(policyId);
    setSelectedPackagePolicy(null);
  };

  if (loading) {
    return (
      <div className="grid gap-3">
        {[1, 2, 3].map(i => (
          <Card key={i} className="p-4 animate-pulse bg-muted/50">
            <div className="h-16" />
          </Card>
        ))}
      </div>
    );
  }

  if (groupedPolicies.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>لا توجد وثائق مؤهلة لإنشاء بلاغ حادث</p>
        <p className="text-sm mt-2">يجب أن تكون الوثيقة من نوع ثالث/شامل أو خدمات طريق أو إعفاء رسوم</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {groupedPolicies.map((group, idx) => {
        const mainPolicy = group.policies[0];
        const status = getPolicyStatus(mainPolicy);
        const isExpanded = selectedPackagePolicy === group.groupId;

        return (
          <Card 
            key={group.groupId || `standalone-${idx}`}
            className={cn(
              "p-4 cursor-pointer transition-all hover:shadow-md",
              !status.isActive && "opacity-60",
              isExpanded && "ring-2 ring-primary"
            )}
            onClick={() => handlePackageSelect(group)}
          >
            {/* Main card content */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                {/* Type badges */}
                <div className="flex flex-wrap gap-2">
                  {group.isPackage && (
                    <Badge variant="secondary" className="gap-1">
                      <Package className="h-3 w-3" />
                      باقة
                    </Badge>
                  )}
                  {group.policies.map(p => (
                    <Badge 
                      key={p.id} 
                      className={cn("text-xs", policyTypeColors[p.policy_type_parent])}
                    >
                      {getInsuranceTypeLabel(p.policy_type_parent as any, p.policy_type_child as any)}
                    </Badge>
                  ))}
                </div>

                {/* Company & Car */}
                <div className="flex flex-wrap gap-4 text-sm">
                  {mainPolicy.company && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                      {mainPolicy.company.name_ar || mainPolicy.company.name}
                    </span>
                  )}
                  {mainPolicy.car && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <CarIcon className="h-4 w-4" />
                      {mainPolicy.car.car_number}
                    </span>
                  )}
                </div>

                {/* Dates */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>{formatDate(mainPolicy.start_date)} - {formatDate(mainPolicy.end_date)}</span>
                </div>
              </div>

              {/* Action arrow */}
              <div className="flex items-center">
                <Badge variant={status.isActive ? 'default' : 'secondary'} className="ml-2">
                  {status.label}
                </Badge>
                <ChevronLeft className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>

            {/* Package sub-policy selection */}
            {isExpanded && group.policies.length > 1 && (
              <div className="mt-4 pt-4 border-t space-y-2" onClick={e => e.stopPropagation()}>
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  اختر الوثيقة لإنشاء البلاغ:
                </p>
                <Select onValueChange={handleSubPolicySelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر نوع الوثيقة..." />
                  </SelectTrigger>
                  <SelectContent>
                    {group.policies.map(policy => (
                      <SelectItem key={policy.id} value={policy.id}>
                        <div className="flex items-center gap-2">
                          <span>{getInsuranceTypeLabel(policy.policy_type_parent as any, policy.policy_type_child as any)}</span>
                          {policy.company && (
                            <span className="text-muted-foreground text-xs">
                              - {policy.company.name_ar || policy.company.name}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
