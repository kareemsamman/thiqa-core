import { useState, useMemo, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { toast } from 'sonner';
import { 
  PolicyRecord, 
  PolicyGroup, 
  PaymentInfo,
  getPolicyStatus 
} from './cards/types';
import { PolicyCard } from './cards/PolicyCard';

const MAIN_POLICY_TYPES = ['ELZAMI', 'THIRD_FULL'];

interface PolicyCardsViewProps {
  policies: PolicyRecord[];
  loading: boolean;
  onPolicyClick: (policyId: string) => void;
  onEditPolicy: (policy: PolicyRecord) => void;
  onDeletePolicy: (policy: PolicyRecord) => void;
}

export function PolicyCardsView({ 
  policies, 
  loading,
  onPolicyClick, 
  onEditPolicy,
  onDeletePolicy 
}: PolicyCardsViewProps) {
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo>({});
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [sendingPolicy, setSendingPolicy] = useState<string | null>(null);

  // Fetch payment info for all policies
  useEffect(() => {
    const fetchPaymentInfo = async () => {
      if (policies.length === 0) {
        setPaymentInfo({});
        setLoadingPayments(false);
        return;
      }

      setLoadingPayments(true);
      const policyIds = policies.map(p => p.id);
      
      try {
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
            remaining: p.insurance_price - paid,
          };
        });
        setPaymentInfo(info);
      } catch (error) {
        console.error('Error fetching payment info:', error);
      } finally {
        setLoadingPayments(false);
      }
    };

    fetchPaymentInfo();
  }, [policies]);

  // Group policies by group_id
  const groupedPolicies = useMemo(() => {
    const groups: Map<string, PolicyGroup> = new Map();
    
    policies.forEach(policy => {
      const isMainType = MAIN_POLICY_TYPES.includes(policy.policy_type_parent);
      const status = getPolicyStatus(policy);
      
      if (policy.group_id) {
        if (!groups.has(policy.group_id)) {
          groups.set(policy.group_id, {
            groupId: policy.group_id,
            mainPolicy: null,
            addons: [],
            isActive: status.isActive,
            newestDate: new Date(policy.start_date),
            priority: status.priority,
            client: policy.clients,
            car: policy.cars,
          });
        }
        
        const group = groups.get(policy.group_id)!;
        
        if (isMainType) {
          if (!group.mainPolicy) {
            group.mainPolicy = policy;
          } else {
            const currentMainType = group.mainPolicy.policy_type_parent;
            if (policy.policy_type_parent === 'THIRD_FULL' && currentMainType !== 'THIRD_FULL') {
              group.addons.push(group.mainPolicy);
              group.mainPolicy = policy;
            } else {
              group.addons.push(policy);
            }
          }
        } else {
          group.addons.push(policy);
        }
        
        if (status.priority < group.priority) {
          group.priority = status.priority;
          group.isActive = status.isActive;
        }
        if (new Date(policy.start_date) > group.newestDate) {
          group.newestDate = new Date(policy.start_date);
        }
      } else {
        groups.set(`standalone-${policy.id}`, {
          groupId: null,
          mainPolicy: policy,
          addons: [],
          isActive: status.isActive,
          newestDate: new Date(policy.start_date),
          priority: status.priority,
          client: policy.clients,
          car: policy.cars,
        });
      }
    });
    
    const groupArray = Array.from(groups.values());
    groupArray.sort((a, b) => b.newestDate.getTime() - a.newestDate.getTime());
    
    return groupArray;
  }, [policies]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const getPackagePaymentStatus = (group: PolicyGroup) => {
    const allPolicyIds = [
      ...(group.mainPolicy ? [group.mainPolicy.id] : []),
      ...group.addons.map(a => a.id)
    ];
    
    let totalPrice = 0;
    let debtPrice = 0;
    let totalPaid = 0;
    
    allPolicyIds.forEach(id => {
      const policy = policies.find(p => p.id === id);
      if (policy) {
        totalPrice += policy.insurance_price + (policy.office_commission || 0);
        if (policy.policy_type_parent !== 'ELZAMI') {
          debtPrice += policy.insurance_price + (policy.office_commission || 0);
        }
        totalPaid += paymentInfo[id]?.paid || 0;
      }
    });
    
    const remaining = Math.max(0, debtPrice - totalPaid);
    const isPaid = remaining <= 0;
    
    return { totalPrice, totalPaid, remaining, isPaid };
  };

  const handleSendInvoice = async (e: React.MouseEvent, policyId: string) => {
    e.stopPropagation();
    setSendingPolicy(policyId);
    try {
      const { data, error } = await supabase.functions.invoke('send-package-invoice-sms', {
        body: { policy_ids: [policyId] }
      });

      if (error) {
        const msg = (await extractFunctionErrorMessage(error)) || 'فشل في الإرسال';
        throw new Error(msg);
      }
      if (data?.success) {
        toast.success('تم إرسال الفاتورة للعميل');
      }
    } catch (err: any) {
      toast.error(err.message || 'فشل في الإرسال');
    } finally {
      setSendingPolicy(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (policies.length === 0) {
    return (
      <Card className="text-center py-12">
        <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-muted-foreground">لا توجد معاملات تأمين</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {groupedPolicies.map((group, groupIndex) => {
        const groupKey = `group-${groupIndex}`;
        const isExpanded = expandedGroups.has(groupKey);
        const hasMainPolicy = group.mainPolicy !== null;
        
        if (!hasMainPolicy) return null;
        
        const paymentStatus = getPackagePaymentStatus(group);

        return (
          <PolicyCard
            key={groupKey}
            group={group}
            paymentStatus={paymentStatus}
            isExpanded={isExpanded}
            sendingPolicy={sendingPolicy}
            onToggleExpand={() => toggleGroup(groupKey)}
            onPolicyClick={onPolicyClick}
            onSendInvoice={handleSendInvoice}
            onEditPolicy={onEditPolicy}
            onDeletePolicy={onDeletePolicy}
          />
        );
      })}
    </div>
  );
}
