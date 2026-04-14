import { useState, useMemo, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  ChevronDown, 
  ChevronLeft, 
  Eye, 
  Calendar,
  Building2,
  Car,
  Banknote,
  FileText,
  CheckCircle,
  XCircle,
  ArrowRightLeft,
  MoreVertical,
  Send,
  RefreshCw,
  Loader2,
  Zap,
  AlertTriangle,
  Trash2,
  Users,
  MessageSquare,
  Save,
  X,
  Pencil,
  Handshake,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PackagePaymentModal } from './PackagePaymentModal';
import { PaymentGroupDetailsDialog, type GroupedPayment } from './PaymentGroupDetailsDialog';
import { PaymentEditDialog } from './PaymentEditDialog';
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog';
import { InvoiceSendPrintDialog } from '@/components/policies/InvoiceSendPrintDialog';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

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
  transferred_car_number: string | null;
  transferred_to_car_number: string | null;
  transferred_from_policy_id: string | null;
  group_id: string | null;
  notes: string | null;
  broker_id?: string | null;
  broker_direction?: 'from_broker' | 'to_broker' | null;
  company: { name: string; name_ar: string | null } | null;
  car: { id: string; car_number: string } | null;
  creator: { full_name: string | null; email: string } | null;
  road_service?: { name: string; name_ar: string | null } | null;
  broker?: { id: string; name: string } | null;
  branch_id?: string | null;
  created_at?: string;
}

interface PolicyYearTimelineProps {
  policies: PolicyRecord[];
  paymentInfo?: Record<string, { paid: number; remaining: number }>;
  accidentInfo?: Record<string, number>;
  childrenInfo?: Record<string, number>;
  onPolicyClick: (policyId: string) => void;
  onPaymentAdded?: () => void | Promise<void>;
  onTransferPolicy?: (policyId: string) => void;
  onCancelPolicy?: (policyId: string) => void;
  onTransferPackage?: (policyIds: string[]) => void;
  onCancelPackage?: (policyIds: string[]) => void;
  onDeletePolicy?: (policyIds: string[]) => void;
  onPoliciesUpdate?: () => void;
  // Renewal handlers
  onRenewPolicy?: (policyId: string) => void;
  onRenewPackage?: (policyIds: string[]) => void;
  // Edit handlers — open the policy/package edit dialogs directly from
  // the dropdown without having to walk through the details drawer first.
  onEditPolicy?: (policyId: string) => void;
  onEditPackage?: (groupId: string) => void;
}

const policyTypeLabels: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات طريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم',
  HEALTH: 'صحي',
  LIFE: 'حياة',
  PROPERTY: 'ممتلكات',
  TRAVEL: 'سفر',
  BUSINESS: 'أعمال',
  OTHER: 'أخرى',
};

const policyTypeColors: Record<string, string> = {
  ELZAMI: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
  THIRD_FULL: 'bg-purple-500/10 text-purple-700 border-purple-500/30',
  ROAD_SERVICE: 'bg-orange-500/10 text-orange-700 border-orange-500/30',
  ACCIDENT_FEE_EXEMPTION: 'bg-green-500/10 text-green-700 border-green-500/30',
  HEALTH: 'bg-pink-500/10 text-pink-700 border-pink-500/30',
  LIFE: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/30',
  PROPERTY: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
  TRAVEL: 'bg-cyan-500/10 text-cyan-700 border-cyan-500/30',
  BUSINESS: 'bg-slate-500/10 text-slate-700 border-slate-500/30',
  OTHER: 'bg-gray-500/10 text-gray-700 border-gray-500/30',
};

// Main policy types vs add-ons
const MAIN_POLICY_TYPES = ['ELZAMI', 'THIRD_FULL', 'HEALTH', 'LIFE', 'PROPERTY', 'TRAVEL', 'BUSINESS', 'OTHER'];

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
const ADDON_POLICY_TYPES = ['ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION'];

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB');
};

type PolicyStatus = 'active' | 'ended' | 'transferred' | 'cancelled';

const getPolicyStatus = (policy: PolicyRecord): PolicyStatus => {
  if (policy.cancelled) return 'cancelled';
  if (policy.transferred) return 'transferred';
  const endDate = new Date(policy.end_date);
  const today = new Date();
  if (endDate < today) return 'ended';
  return 'active';
};

const getStatusPriority = (status: PolicyStatus): number => {
  switch (status) {
    case 'active': return 1;
    case 'ended': return 2;
    case 'transferred': return 3;
    case 'cancelled': return 4;
  }
};

// Get insurance year label (e.g., "2025 – 2026")
const getInsuranceYear = (startDate: string): string => {
  const date = new Date(startDate);
  const year = date.getFullYear();
  return `${year} – ${year + 1}`;
};

// Get sort key for insurance year (higher = newer)
const getYearSortKey = (startDate: string): number => {
  return new Date(startDate).getFullYear();
};

// Check if this is the current insurance year
const isCurrentYear = (startDate: string): boolean => {
  const policyYear = new Date(startDate).getFullYear();
  const currentYear = new Date().getFullYear();
  return policyYear === currentYear || policyYear === currentYear - 1;
};

// Check if policy was created within the last 24 hours
const isNewPolicy = (createdAt: string): boolean => {
  const created = new Date(createdAt);
  const now = new Date();
  const hoursDiff = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
  return hoursDiff < 24;
};

interface PaymentInfo {
  [policyId: string]: { paid: number; remaining: number };
}

interface PolicyPackage {
  mainPolicy: PolicyRecord | null;
  addons: PolicyRecord[];
  allPolicyIds: string[];
  status: PolicyStatus;
  totalPrice: number;
  debtPrice: number; // Excludes ELZAMI for debt calculations
}

interface YearGroup {
  yearLabel: string;
  yearSortKey: number;
  isCurrent: boolean;
  packages: PolicyPackage[];
}

export function PolicyYearTimeline({ 
  policies, 
  paymentInfo: externalPaymentInfo,
  accidentInfo: externalAccidentInfo,
  childrenInfo: externalChildrenInfo,
  onPolicyClick, 
  onPaymentAdded,
  onTransferPolicy,
  onCancelPolicy,
  onTransferPackage,
  onCancelPackage,
  onDeletePolicy,
  onEditPolicy,
  onEditPackage,
  onPoliciesUpdate,
  onRenewPolicy,
  onRenewPackage,
}: PolicyYearTimelineProps) {
  const { isAdmin, isSuperAdmin } = useAuth();
  
  // Use external data if provided (from ClientDetails), otherwise use internal state
  const hasExternalData = externalPaymentInfo !== undefined;
  const [internalPaymentInfo, setInternalPaymentInfo] = useState<PaymentInfo>({});
  const [internalAccidentInfo, setInternalAccidentInfo] = useState<Record<string, number>>({});
  const [internalChildrenInfo, setInternalChildrenInfo] = useState<Record<string, number>>({});
  const [loadingPayments, setLoadingPayments] = useState(!hasExternalData);
  
  // Use external or internal data
  const paymentInfo = externalPaymentInfo ?? internalPaymentInfo;
  const accidentInfo = externalAccidentInfo ?? internalAccidentInfo;
  const childrenInfo = externalChildrenInfo ?? internalChildrenInfo;
  const [packagePaymentOpen, setPackagePaymentOpen] = useState(false);
  const [selectedPackagePolicyIds, setSelectedPackagePolicyIds] = useState<string[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [sendingPolicy, setSendingPolicy] = useState<string | null>(null);
  
  // Invoice Send/Print Dialog state
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [invoiceDialogPolicyIds, setInvoiceDialogPolicyIds] = useState<string[]>([]);
  const [invoiceDialogClientPhone, setInvoiceDialogClientPhone] = useState<string | null>(null);

  // Payment details dialog state — shows the same PaymentGroupDetailsDialog
  // that ClientDetails opens when clicking a payment row, so the summary
  // button and the table row route to an identical popup.
  const [paymentDetailsOpen, setPaymentDetailsOpen] = useState(false);
  const [paymentDetailsGroup, setPaymentDetailsGroup] = useState<GroupedPayment | null>(null);
  const [paymentDetailsPolicyIds, setPaymentDetailsPolicyIds] = useState<string[]>([]);

  // Edit / delete a specific payment from inside the details popup.
  // reopenDetailsAfterClose is a ref (not state) so toggling it doesn't
  // cause a re-render and it's always readable from the latest closure.
  const [editPayment, setEditPayment] = useState<any | null>(null);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const reopenDetailsAfterClose = useRef(false);
  // Notes editing state
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editedNotesValue, setEditedNotesValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Handle notes update
  const handleNotesUpdate = async (policyId: string, notes: string) => {
    setSavingNotes(true);
    try {
      const { error } = await supabase
        .from('policies')
        .update({ notes: notes.trim() || null })
        .eq('id', policyId);
      
      if (error) throw error;
      
      toast.success('تم حفظ الملاحظات');
      setEditingNotesId(null);
      if (onPoliciesUpdate) onPoliciesUpdate();
    } catch (err) {
      console.error('Error updating notes:', err);
      toast.error('فشل حفظ الملاحظات');
    } finally {
      setSavingNotes(false);
    }
  };

  // Fetch payment info only if not provided externally
  useEffect(() => {
    if (hasExternalData) {
      setLoadingPayments(false);
      return;
    }

    const fetchPaymentInfo = async () => {
      if (policies.length === 0) {
        setInternalPaymentInfo({});
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
            remaining: (p.insurance_price + (p.office_commission || 0)) - paid,
          };
        });

        setInternalPaymentInfo(info);
      } catch (error) {
        console.error('Error fetching payment info:', error);
      } finally {
        setLoadingPayments(false);
      }
    };

    fetchPaymentInfo();
  }, [policies, hasExternalData]);

  // Fetch accident reports count per policy only if not provided externally
  useEffect(() => {
    if (hasExternalData) return;

    const fetchAccidentInfo = async () => {
      if (policies.length === 0) {
        setInternalAccidentInfo({});
        return;
      }

      const policyIds = policies.map(p => p.id);
      
      try {
        const { data } = await supabase
          .from('accident_reports')
          .select('policy_id')
          .in('policy_id', policyIds);

        const counts: Record<string, number> = {};
        (data || []).forEach(row => {
          counts[row.policy_id] = (counts[row.policy_id] || 0) + 1;
        });

        setInternalAccidentInfo(counts);
      } catch (error) {
        console.error('Error fetching accident info:', error);
      }
    };

    fetchAccidentInfo();
  }, [policies, hasExternalData]);

  // Fetch children/additional drivers count per policy only if not provided externally
  useEffect(() => {
    if (hasExternalData) return;

    const fetchChildrenInfo = async () => {
      if (policies.length === 0) {
        setInternalChildrenInfo({});
        return;
      }

      const policyIds = policies.map(p => p.id);
      
      try {
        const { data } = await supabase
          .from('policy_children')
          .select('policy_id')
          .in('policy_id', policyIds);

        const counts: Record<string, number> = {};
        (data || []).forEach(row => {
          counts[row.policy_id] = (counts[row.policy_id] || 0) + 1;
        });

        setInternalChildrenInfo(counts);
      } catch (error) {
        console.error('Error fetching children info:', error);
      }
    };

    fetchChildrenInfo();
  }, [policies, hasExternalData]);

  // Group policies by year, then by package
  const yearGroups = useMemo((): YearGroup[] => {
    const yearMap = new Map<string, PolicyRecord[]>();
    
    // Group by insurance year
    policies.forEach(policy => {
      const yearLabel = getInsuranceYear(policy.start_date);
      if (!yearMap.has(yearLabel)) {
        yearMap.set(yearLabel, []);
      }
      yearMap.get(yearLabel)!.push(policy);
    });

    // Convert to year groups with packages
    const groups: YearGroup[] = [];
    
    yearMap.forEach((yearPolicies, yearLabel) => {
      const packages: PolicyPackage[] = [];
      const groupedByGroupId = new Map<string, PolicyRecord[]>();
      const standalone: PolicyRecord[] = [];

      // Separate by group_id
      yearPolicies.forEach(policy => {
        if (policy.group_id) {
          if (!groupedByGroupId.has(policy.group_id)) {
            groupedByGroupId.set(policy.group_id, []);
          }
          groupedByGroupId.get(policy.group_id)!.push(policy);
        } else {
          standalone.push(policy);
        }
      });

      // Create packages from grouped policies
      groupedByGroupId.forEach((groupPolicies) => {
        // Find main policies - prioritize THIRD_FULL over ELZAMI
        const mainPolicies = groupPolicies.filter(p => MAIN_POLICY_TYPES.includes(p.policy_type_parent));
        let mainPolicy: PolicyRecord | null = null;
        const members: PolicyRecord[] = [];
        
        if (mainPolicies.length > 0) {
          // Prioritize THIRD_FULL as main, then ELZAMI, then others
          mainPolicy = mainPolicies.find(p => p.policy_type_parent === 'THIRD_FULL') 
            || mainPolicies.find(p => p.policy_type_parent === 'ELZAMI')
            || mainPolicies[0];
          
          // Other main policies become "members" (like addons but they're main types)
          mainPolicies.forEach(p => {
            if (p.id !== mainPolicy!.id) {
              members.push(p);
            }
          });
        }
        
        // Real addons (ROAD_SERVICE, ACCIDENT_FEE_EXEMPTION)
        const realAddons = groupPolicies.filter(p => ADDON_POLICY_TYPES.includes(p.policy_type_parent));
        
        // Combine members + real addons
        const addons = [...members, ...realAddons];
        const allIds = groupPolicies.map(p => p.id);
        
        // Package status is determined by main policy, or first addon
        const statusPolicy = mainPolicy || groupPolicies[0];
        const status = getPolicyStatus(statusPolicy);
        const totalPrice = groupPolicies.reduce((sum, p) => sum + p.insurance_price + (p.office_commission || 0), 0);
        // For debt calculation, include all policies (office_commission is always client debt)
        const debtPrice = groupPolicies.reduce((sum, p) => sum + p.insurance_price + (p.office_commission || 0), 0);

        packages.push({
          mainPolicy,
          addons,
          allPolicyIds: allIds,
          status,
          totalPrice,
          debtPrice
        });
      });

      // Create standalone entries
      standalone.forEach(policy => {
        const isElzami = policy.policy_type_parent === 'ELZAMI';
        packages.push({
          mainPolicy: MAIN_POLICY_TYPES.includes(policy.policy_type_parent) ? policy : null,
          addons: ADDON_POLICY_TYPES.includes(policy.policy_type_parent) ? [policy] : [],
          allPolicyIds: [policy.id],
          status: getPolicyStatus(policy),
          totalPrice: policy.insurance_price + (policy.office_commission || 0),
          debtPrice: policy.insurance_price + (policy.office_commission || 0)
        });
      });

      // Sort packages within year: 
      // 1. Newly created (last 24h) first
      // 2. Then by status: active → ended → transferred → cancelled
      // 3. Then by newest start date
      packages.sort((a, b) => {
        const policyA = a.mainPolicy || a.addons[0];
        const policyB = b.mainPolicy || b.addons[0];
        
        // New policies first (created within last 24 hours)
        const aIsNew = policyA?.created_at && isNewPolicy(policyA.created_at);
        const bIsNew = policyB?.created_at && isNewPolicy(policyB.created_at);
        if (aIsNew && !bIsNew) return -1;
        if (!aIsNew && bIsNew) return 1;
        
        // Then by status priority
        const priorityA = getStatusPriority(a.status);
        const priorityB = getStatusPriority(b.status);
        if (priorityA !== priorityB) return priorityA - priorityB;
        
        // Then by newest start date
        const dateA = policyA?.start_date || '';
        const dateB = policyB?.start_date || '';
        return new Date(dateB).getTime() - new Date(dateA).getTime();
      });

      const sampleStartDate = yearPolicies[0]?.start_date || '';
      groups.push({
        yearLabel,
        yearSortKey: getYearSortKey(sampleStartDate),
        isCurrent: isCurrentYear(sampleStartDate),
        packages
      });
    });

    // Sort years newest → oldest
    groups.sort((a, b) => b.yearSortKey - a.yearSortKey);

    return groups;
  }, [policies]);

  // Assign a global "document number" to each policy id. Walk packages in the
  // same order they render (newest year → oldest, sorted within year). Inside
  // each package: ELZAMI policies each get their own number (legally distinct
  // from non-ELZAMI), while non-ELZAMI policies from the same company share a
  // single number (an addon like خدمات طريق tucked under ثالث doesn't bump
  // the counter). Example: [ثالث+خدمات طريق same company] → #1,#1 then
  // [شامل+إلزامي same company] → #2,#3.
  const policyDocNumbers = useMemo(() => {
    const map = new Map<string, number>();
    let counter = 0;
    for (const yg of yearGroups) {
      for (const pkg of yg.packages) {
        const pkgPolicies = [pkg.mainPolicy, ...pkg.addons].filter(Boolean) as PolicyRecord[];
        const elzami = pkgPolicies.filter(p => p.policy_type_parent === 'ELZAMI');
        const nonElzami = pkgPolicies.filter(p => p.policy_type_parent !== 'ELZAMI');
        const companyToNum = new Map<string, number>();
        for (const p of nonElzami) {
          const companyKey = p.company?.name_ar || p.company?.name || `no-company:${p.id}`;
          if (!companyToNum.has(companyKey)) {
            counter += 1;
            companyToNum.set(companyKey, counter);
          }
          map.set(p.id, companyToNum.get(companyKey)!);
        }
        for (const p of elzami) {
          counter += 1;
          map.set(p.id, counter);
        }
      }
    }
    return map;
  }, [yearGroups]);

  // Track expanded years - current year is expanded by default
  const [expandedYears, setExpandedYears] = useState<Set<string>>(() => {
    const expanded = new Set<string>();
    yearGroups.forEach(group => {
      if (group.isCurrent) {
        expanded.add(group.yearLabel);
      }
    });
    // If no current year, expand the first (newest)
    if (expanded.size === 0 && yearGroups.length > 0) {
      expanded.add(yearGroups[0].yearLabel);
    }
    return expanded;
  });

  // Update expanded when yearGroups changes
  useEffect(() => {
    setExpandedYears(prev => {
      const newSet = new Set(prev);
      let hasExpanded = false;
      yearGroups.forEach(group => {
        if (group.isCurrent) {
          newSet.add(group.yearLabel);
          hasExpanded = true;
        }
      });
      if (!hasExpanded && yearGroups.length > 0 && newSet.size === 0) {
        newSet.add(yearGroups[0].yearLabel);
      }
      return newSet;
    });
  }, [yearGroups]);

  const toggleYear = (yearLabel: string) => {
    setExpandedYears(prev => {
      const next = new Set(prev);
      if (next.has(yearLabel)) {
        next.delete(yearLabel);
      } else {
        next.add(yearLabel);
      }
      return next;
    });
  };

  const handlePackagePayment = (e: React.MouseEvent, policyIds: string[], branchId: string | null) => {
    e.stopPropagation();
    setSelectedPackagePolicyIds(policyIds);
    setSelectedBranchId(branchId);
    setPackagePaymentOpen(true);
  };

  // Fetch all payments across the clicked package's policies and wrap them
  // in a single GroupedPayment so PaymentGroupDetailsDialog (the same popup
  // the ClientDetails payments table uses) can render them as-is.
  // Extra fields (policy_id, cheque_image_url, policy_type_child) are
  // selected so we can hand the raw row straight to PaymentEditDialog
  // when the user clicks the pencil icon inside the popup.
  const handleOpenPaymentDetails = async (policyIds: string[]) => {
    if (policyIds.length === 0) return;
    setPaymentDetailsPolicyIds(policyIds);
    try {
      const { data, error } = await supabase
        .from('policy_payments')
        .select(`
          id, policy_id, amount, payment_date, payment_type, cheque_number,
          cheque_image_url, card_last_four, refused, locked, notes,
          policy:policies!policy_payments_policy_id_fkey(
            id, policy_type_parent, policy_type_child, insurance_price
          )
        `)
        .in('policy_id', policyIds)
        .order('payment_date', { ascending: true });

      if (error) throw error;

      const payments = ((data as any[]) || []).map((p) => ({
        id: p.id,
        policy_id: p.policy_id,
        amount: Number(p.amount || 0),
        payment_date: p.payment_date,
        payment_type: p.payment_type,
        cheque_number: p.cheque_number,
        cheque_image_url: p.cheque_image_url,
        card_last_four: p.card_last_four,
        refused: p.refused,
        locked: p.locked,
        notes: p.notes,
        policy: Array.isArray(p.policy) ? p.policy[0] : p.policy,
      }));

      if (payments.length === 0) {
        toast.info('لا توجد دفعات مسجلة');
        return;
      }

      const accepted = payments.filter((p) => !p.refused);
      const totalAmount = accepted.reduce((sum, p) => sum + p.amount, 0);
      const paymentTypes: string[] = [];
      const policyTypes: string[] = [];
      for (const p of payments) {
        if (p.payment_type && !paymentTypes.includes(p.payment_type)) {
          paymentTypes.push(p.payment_type);
        }
        const parent = p.policy?.policy_type_parent;
        if (parent && !policyTypes.includes(parent)) policyTypes.push(parent);
      }
      const first = payments[0];

      const group: GroupedPayment = {
        id: `pkg:${policyIds.join(',')}`,
        totalAmount,
        payment_date: first.payment_date,
        payment_type: first.payment_type,
        paymentTypes,
        cheque_number: first.cheque_number ?? null,
        refused: first.refused ?? null,
        notes: first.notes ?? null,
        payments,
        policyTypes,
      };

      setPaymentDetailsGroup(group);
      setPaymentDetailsOpen(true);
    } catch (e) {
      console.error('[PolicyYearTimeline] open payment details error:', e);
      toast.error('فشل تحميل تفاصيل الدفعات');
    }
  };

  const handleDeletePaymentConfirm = async () => {
    if (!deletePaymentId) return;
    setDeletingPayment(true);
    try {
      const { error } = await supabase
        .from('policy_payments')
        .delete()
        .eq('id', deletePaymentId);
      if (error) throw error;
      toast.success('تم حذف الدفعة');
      if (onPaymentAdded) await onPaymentAdded();
      // onOpenChange will handle reopening the details popup once the
      // confirm dialog unmounts — we just flush state here.
    } catch (e: any) {
      console.error('[PolicyYearTimeline] delete payment error:', e);
      toast.error(e?.message || 'فشل حذف الدفعة');
    } finally {
      setDeletingPayment(false);
      setDeletePaymentId(null);
    }
  };

  const handleOpenInvoiceDialog = async (e: React.MouseEvent, policyIds: string[]) => {
    e.stopPropagation();
    
    // Try to get client phone number from policy
    try {
      const { data: policyData } = await supabase
        .from('policies')
        .select('clients(phone_number)')
        .eq('id', policyIds[0])
        .single();
      
      const clientPhone = (policyData?.clients as any)?.phone_number || null;
      setInvoiceDialogClientPhone(clientPhone);
    } catch {
      setInvoiceDialogClientPhone(null);
    }
    
    setInvoiceDialogPolicyIds(policyIds);
    setInvoiceDialogOpen(true);
  };

  const refreshPaymentInfo = async () => {
    // If using external data, call onPaymentAdded to refresh parent
    if (hasExternalData) {
      if (onPaymentAdded) onPaymentAdded();
      return;
    }
    
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
        remaining: p.insurance_price - paid,
      };
    });
    setInternalPaymentInfo(info);
  };

  const getPackagePaymentStatus = (pkg: PolicyPackage) => {
    // Sum total paid across all package policies
    let totalPaid = 0;
    
    pkg.allPolicyIds.forEach(id => {
      totalPaid += paymentInfo[id]?.paid || 0;
    });
    
    // Calculate remaining as package total - all payments
    // This is the correct way for packages (same as drawer)
    const remaining = Math.max(0, pkg.totalPrice - totalPaid);
    const isPaid = remaining <= 0 && pkg.totalPrice > 0;
    
    return { totalPaid, remaining, isPaid };
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
    <div className="space-y-4">
      {yearGroups.map(yearGroup => {
        const isExpanded = expandedYears.has(yearGroup.yearLabel);
        const activeCount = yearGroup.packages.filter(p => p.status === 'active').length;
        const totalCount = yearGroup.packages.length;

        return (
          <Collapsible
            key={yearGroup.yearLabel}
            open={isExpanded}
            onOpenChange={() => toggleYear(yearGroup.yearLabel)}
          >
            {/* Year Header */}
            <CollapsibleTrigger asChild>
              <div 
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-all",
                  yearGroup.isCurrent 
                    ? "bg-primary/10 border-2 border-primary/30 hover:bg-primary/15" 
                    : "bg-muted/50 border border-border hover:bg-muted"
                )}
              >
                {isExpanded ? (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronLeft className="h-5 w-5 text-muted-foreground" />
                )}
                
                <Calendar className={cn("h-5 w-5", yearGroup.isCurrent ? "text-primary" : "text-muted-foreground")} />
                
                <span className={cn(
                  "text-lg font-bold ltr-nums",
                  yearGroup.isCurrent ? "text-primary" : "text-foreground"
                )}>
                  {yearGroup.yearLabel}
                </span>

                {yearGroup.isCurrent && (
                  <Badge variant="default" className="bg-primary/20 text-primary border-0">
                    السنة الحالية
                  </Badge>
                )}

                <div className="flex-1" />

                {activeCount > 0 && (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle className="h-3 w-3" />
                    {activeCount} سارية
                  </Badge>
                )}
                
                <Badge variant="outline" className="ltr-nums">
                  {totalCount} وثيقة
                </Badge>
              </div>
            </CollapsibleTrigger>

            {/* Year Content */}
            <CollapsibleContent>
              <div className="mt-2 space-y-2 pr-4">
                {yearGroup.packages.map((pkg, pkgIndex) => {
                  const accidentCount = pkg.allPolicyIds.reduce((sum, id) => sum + (accidentInfo[id] || 0), 0);
                  const childrenCount = pkg.allPolicyIds.reduce((sum, id) => sum + (childrenInfo[id] || 0), 0);
                    const mainPolicy = pkg.mainPolicy || pkg.addons[0];
                    return (
                      <PolicyPackageCard
                        key={pkgIndex}
                        pkg={pkg}
                        paymentStatus={getPackagePaymentStatus(pkg)}
                        accidentCount={accidentCount}
                        childrenCount={childrenCount}
                        getDocNumber={(id) => policyDocNumbers.get(id)}
                        onOpenPaymentDetails={handleOpenPaymentDetails}
                        onPolicyClick={onPolicyClick}
                        onPaymentClick={(e) => handlePackagePayment(e, pkg.allPolicyIds, pkg.mainPolicy?.branch_id || pkg.addons[0]?.branch_id || null)}
                        onOpenInvoiceDialog={(e) => handleOpenInvoiceDialog(e, pkg.allPolicyIds)}
                        isPackage={pkg.allPolicyIds.length > 1}
                        onTransfer={onTransferPolicy}
                        onCancel={onCancelPolicy}
                        onTransferPackage={onTransferPackage}
                        onCancelPackage={onCancelPackage}
                        onDeletePolicy={onDeletePolicy}
                        onRenewPolicy={onRenewPolicy}
                        onRenewPackage={onRenewPackage}
                        onEditPolicy={onEditPolicy}
                        onEditPackage={onEditPackage}
                        isSuperAdmin={isSuperAdmin}
                        isAdmin={isAdmin}
                        isEditingNotes={editingNotesId === mainPolicy?.id}
                        editedNotesValue={editedNotesValue}
                        savingNotes={savingNotes}
                        onStartEditNotes={(policyId, currentNotes) => {
                          setEditingNotesId(policyId);
                          setEditedNotesValue(currentNotes || '');
                        }}
                        onCancelEditNotes={() => setEditingNotesId(null)}
                        onNotesValueChange={setEditedNotesValue}
                        onSaveNotes={(policyId) => handleNotesUpdate(policyId, editedNotesValue)}
                      />
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      <PackagePaymentModal
        open={packagePaymentOpen}
        onOpenChange={setPackagePaymentOpen}
        policyIds={selectedPackagePolicyIds}
        branchId={selectedBranchId}
        onSuccess={async () => {
          if (onPaymentAdded) await onPaymentAdded();
        }}
      />

      <InvoiceSendPrintDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        policyIds={invoiceDialogPolicyIds}
        isPackage={invoiceDialogPolicyIds.length > 1}
        clientPhone={invoiceDialogClientPhone}
      />

      <PaymentGroupDetailsDialog
        open={paymentDetailsOpen}
        onOpenChange={(o) => {
          setPaymentDetailsOpen(o);
          if (!o) setPaymentDetailsGroup(null);
        }}
        group={paymentDetailsGroup}
        onEdit={(p) => {
          reopenDetailsAfterClose.current = true;
          setEditPayment(p);
        }}
        onDelete={(p) => {
          reopenDetailsAfterClose.current = true;
          setDeletePaymentId(p.id);
        }}
      />

      <PaymentEditDialog
        open={!!editPayment}
        onOpenChange={(o) => {
          if (!o) {
            setEditPayment(null);
            // Re-open the group details popup the user came from so a
            // save/cancel/delete round-trip lands them back where they
            // were instead of on the bare page.
            if (reopenDetailsAfterClose.current && paymentDetailsPolicyIds.length > 0) {
              reopenDetailsAfterClose.current = false;
              handleOpenPaymentDetails(paymentDetailsPolicyIds);
            }
          }
        }}
        payment={editPayment}
        onSuccess={async () => {
          if (onPaymentAdded) await onPaymentAdded();
        }}
      />

      <DeleteConfirmDialog
        open={!!deletePaymentId}
        onOpenChange={(o) => {
          if (!o) {
            setDeletePaymentId(null);
            // Re-open the details popup on both confirm and cancel so
            // the user doesn't lose their drilled-in context.
            if (reopenDetailsAfterClose.current && paymentDetailsPolicyIds.length > 0) {
              reopenDetailsAfterClose.current = false;
              handleOpenPaymentDetails(paymentDetailsPolicyIds);
            }
          }
        }}
        onConfirm={handleDeletePaymentConfirm}
        title="حذف الدفعة"
        description="هل أنت متأكد من حذف هذه الدفعة؟ لا يمكن التراجع عن هذا الإجراء."
        loading={deletingPayment}
      />
    </div>
  );
}

// Simplified Policy Card Component
function PolicyPackageCard({
  pkg,
  paymentStatus,
  accidentCount = 0,
  childrenCount = 0,
  getDocNumber,
  onOpenPaymentDetails,
  onPolicyClick,
  onPaymentClick,
  onOpenInvoiceDialog,
  isPackage: isPackageProp,
  onTransfer,
  onCancel,
  onTransferPackage,
  onCancelPackage,
  onDeletePolicy,
  onRenewPolicy,
  onRenewPackage,
  onEditPolicy,
  onEditPackage,
  isSuperAdmin,
  isAdmin,
  isEditingNotes,
  editedNotesValue,
  savingNotes,
  onStartEditNotes,
  onCancelEditNotes,
  onNotesValueChange,
  onSaveNotes,
}: {
  pkg: PolicyPackage;
  paymentStatus: { totalPaid: number; remaining: number; isPaid: boolean };
  accidentCount?: number;
  childrenCount?: number;
  getDocNumber?: (policyId: string) => number | undefined;
  onOpenPaymentDetails?: (policyIds: string[]) => void;
  onPolicyClick: (id: string) => void;
  onPaymentClick: (e: React.MouseEvent) => void;
  onOpenInvoiceDialog: (e: React.MouseEvent) => void;
  isPackage: boolean;
  onTransfer?: (id: string) => void;
  onCancel?: (id: string) => void;
  onTransferPackage?: (ids: string[]) => void;
  onCancelPackage?: (ids: string[]) => void;
  onDeletePolicy?: (ids: string[]) => void;
  onRenewPolicy?: (id: string) => void;
  onRenewPackage?: (ids: string[]) => void;
  onEditPolicy?: (id: string) => void;
  onEditPackage?: (groupId: string) => void;
  isSuperAdmin?: boolean;
  isAdmin?: boolean;
  isEditingNotes?: boolean;
  editedNotesValue?: string;
  savingNotes?: boolean;
  onStartEditNotes?: (policyId: string, currentNotes: string | null) => void;
  onCancelEditNotes?: () => void;
  onNotesValueChange?: (value: string) => void;
  onSaveNotes?: (policyId: string) => void;
}) {
  const policy = pkg.mainPolicy || pkg.addons[0];
  if (!policy) return null;

  const isActive = pkg.status === 'active';
  const isTransferred = pkg.status === 'transferred';
  const isCancelled = pkg.status === 'cancelled';
  const isPkg = isPackageProp || (pkg.addons.length > 0 && pkg.mainPolicy !== null);
  const hasUnpaid = !paymentStatus.isPaid;

  // Ref on the coverage-period cell so clicking the status badge can flash
  // the date to tell the user "this is what سارية is referring to".
  const periodRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = periodRef.current;
    if (!el) return;
    el.classList.remove('highlight-pulse');
    void el.offsetWidth;
    el.classList.add('highlight-pulse');
    window.setTimeout(() => el.classList.remove('highlight-pulse'), 3100);
  };

  // Click a top-level type badge (e.g. شامل, إلزامي in the header row) to
  // pulse the matching breakdown row inside this card. Scoped to cardRef
  // so a click can't accidentally highlight a row in a sibling card.
  const pulsePolicyRow = (policyId: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const scope = cardRef.current;
    if (!scope) return;
    const row = scope.querySelector<HTMLElement>(`[data-policy-row-id="${policyId}"]`);
    if (!row) return;
    row.classList.remove('highlight-pulse');
    void row.offsetWidth;
    row.classList.add('highlight-pulse');
    window.setTimeout(() => row.classList.remove('highlight-pulse'), 3100);
  };

  // Check if this policy was created from a transfer (has transferred_car_number = FROM which car)
  const wasTransferredFrom = policy.transferred_car_number;
  // Check if this policy was transferred TO another car (has transferred_to_car_number)
  const wasTransferredTo = policy.transferred_to_car_number;

  // Build combined type label for packages
  const getTypeLabel = () => {
    if (isPkg && pkg.mainPolicy) {
      const mainLabel = getDisplayLabel(pkg.mainPolicy);
      const addonLabels = pkg.addons.map(a => getDisplayLabel(a));
      return `${mainLabel} + ${addonLabels.join(' + ')}`;
    }
    return getDisplayLabel(policy);
  };

  return (
    <Card
      ref={cardRef}
      className={cn(
        "overflow-hidden transition-all duration-200",
        // Active: Highlight and strong border
        isActive && "bg-card border-2 border-primary/40 shadow-md shadow-primary/5",
        // Ended: Neutral
        pkg.status === 'ended' && "bg-muted/20 border-border",
        // Transferred/Cancelled: Muted
        (isTransferred || isCancelled) && "bg-muted/10 border-dashed border-muted-foreground/30 opacity-70",
        // Unpaid indicator
        hasUnpaid && isActive && "border-r-4 border-r-destructive"
      )}
    >
      <div className="p-4">
        {/* Top Row: Status + Type + Actions */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {/* Status Badge */}
          {isActive && (
            <button
              type="button"
              onClick={handleStatusClick}
              className="focus:outline-none"
              title="اضغط لإبراز فترة السريان"
            >
              <Badge variant="success" className="gap-1 font-bold cursor-pointer">
                <CheckCircle className="h-3.5 w-3.5" />
                سارية
              </Badge>
            </button>
          )}
          {pkg.status === 'ended' && (
            <Badge variant="secondary" className="gap-1">
              منتهية
            </Badge>
          )}
          {isTransferred && (
            <Badge variant="warning" className="gap-1">
              <ArrowRightLeft className="h-3 w-3" />
              محولة {wasTransferredTo && <span className="font-mono ltr-nums">← {wasTransferredTo}</span>}
            </Badge>
          )}
          {isCancelled && (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              ملغاة
            </Badge>
          )}

          {/* Transfer FROM indicator - for policies created via transfer */}
          {wasTransferredFrom && !isTransferred && (
            <Badge variant="outline" className="gap-1 text-xs bg-blue-500/10 border-blue-500/30 text-blue-600">
              <ArrowRightLeft className="h-3 w-3" />
              محول من <span className="font-mono ltr-nums">{wasTransferredFrom}</span>
            </Badge>
          )}

          {/* Policy Type - show as separate badges for packages */}
          {isPkg && pkg.mainPolicy ? (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={pulsePolicyRow(pkg.mainPolicy.id)}
                className="focus:outline-none"
                title="اضغط لإبراز هذه الوثيقة في القائمة"
              >
                <Badge className={cn("border text-xs font-semibold cursor-pointer", policyTypeColors[pkg.mainPolicy.policy_type_parent])}>
                  {getDisplayLabel(pkg.mainPolicy)}
                </Badge>
              </button>
              {pkg.addons.map((addon) => (
                <span key={addon.id} className="flex items-center gap-1">
                  <span className="text-muted-foreground text-xs">+</span>
                  <button
                    type="button"
                    onClick={pulsePolicyRow(addon.id)}
                    className="focus:outline-none"
                    title="اضغط لإبراز هذه الوثيقة في القائمة"
                  >
                    <Badge className={cn("border text-xs cursor-pointer", policyTypeColors[addon.policy_type_parent])}>
                      {getDisplayLabel(addon)}
                    </Badge>
                  </button>
                </span>
              ))}
              <Badge variant="outline" className="gap-1 text-xs bg-primary/5 border-primary/20 text-primary mr-1">
                <Zap className="h-3 w-3" />
                باقة
              </Badge>
            </div>
          ) : (
            <Badge className={cn("border text-xs font-semibold", policyTypeColors[policy.policy_type_parent])}>
              {getTypeLabel()}
            </Badge>
          )}

          {/* Accident indicator */}
          {accidentCount > 0 && (
            <Badge variant="outline" className="gap-1 text-xs bg-orange-500/10 border-orange-500/30 text-orange-600">
              <AlertTriangle className="h-3 w-3" />
              {accidentCount} حادث
            </Badge>
          )}

          {/* New Policy Badge - shows for policies created within last 24 hours */}
          {policy.created_at && isNewPolicy(policy.created_at) && (
            <Badge variant="outline" className="gap-1 text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-600">
              <Zap className="h-3 w-3" />
              جديدة
            </Badge>
          )}

          {/* Additional Drivers indicator */}
          {childrenCount > 0 && (
            <Badge variant="outline" className="gap-1 text-xs bg-indigo-500/10 border-indigo-500/30 text-indigo-600">
              <Users className="h-3 w-3" />
              {childrenCount} سائق إضافي
            </Badge>
          )}

          {/* Broker indicator — shows when any policy in this card (main or
              an addon inside the package) is tied to a broker. Label flips
              to "من الوسيط" / "إلى الوسيط" based on broker_direction. */}
          {(() => {
            const policiesInCard: PolicyRecord[] = isPkg && pkg.mainPolicy
              ? [pkg.mainPolicy, ...pkg.addons]
              : [policy];
            const brokerPolicy = policiesInCard.find(p => p.broker_id && p.broker);
            if (!brokerPolicy || !brokerPolicy.broker) return null;
            const directionLabel = brokerPolicy.broker_direction === 'from_broker'
              ? 'من الوسيط'
              : brokerPolicy.broker_direction === 'to_broker'
                ? 'إلى الوسيط'
                : 'وسيط';
            return (
              <Badge
                variant="outline"
                className="gap-1 text-xs bg-amber-500/10 border-amber-500/30 text-amber-700"
                title={`${directionLabel}: ${brokerPolicy.broker.name}`}
              >
                <Handshake className="h-3 w-3" />
                {directionLabel}: {brokerPolicy.broker.name}
              </Badge>
            );
          })()}

          {/* Payment Status — amounts moved to the summary strip below the grid */}
          {paymentStatus.isPaid && (
            <Badge variant="outline" className="gap-1 text-success border-success/30 bg-success/5">
              <CheckCircle className="h-3 w-3" />
              مدفوع
            </Badge>
          )}

          <div className="flex-1" />

          {/* Quick Actions */}
          <div className="flex items-center gap-1">
            {hasUnpaid && isActive && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1 h-8 border-primary text-primary hover:bg-primary hover:text-white"
                onClick={onPaymentClick}
              >
                <Banknote className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">دفع</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="gap-1 h-8"
              onClick={onOpenInvoiceDialog}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => onPolicyClick(policy.id)}>
                  <Eye className="h-4 w-4 ml-2" />
                  عرض التفاصيل
                </DropdownMenuItem>

                {/* Edit — open the package/policy edit modal directly from
                    the dropdown so the user doesn't have to walk through
                    the details drawer first. Hidden for cancelled and
                    transferred rows since those are locked anyway. */}
                {!isCancelled && !isTransferred && (
                  <>
                    {isPkg && onEditPackage && policy.group_id && (
                      <DropdownMenuItem onClick={() => onEditPackage(policy.group_id!)}>
                        <Pencil className="h-4 w-4 ml-2" />
                        تعديل الباقة
                      </DropdownMenuItem>
                    )}
                    {!isPkg && onEditPolicy && (
                      <DropdownMenuItem onClick={() => onEditPolicy(policy.id)}>
                        <Pencil className="h-4 w-4 ml-2" />
                        تعديل الوثيقة
                      </DropdownMenuItem>
                    )}
                  </>
                )}

                {isActive && (
                  <>
                    <DropdownMenuSeparator />
                    {isPkg && onTransferPackage && (
                      <DropdownMenuItem onClick={() => onTransferPackage(pkg.allPolicyIds)}>
                        <ArrowRightLeft className="h-4 w-4 ml-2" />
                        تحويل الباقة
                      </DropdownMenuItem>
                    )}
                    {!isPkg && onTransfer && (
                      <DropdownMenuItem onClick={() => onTransfer(policy.id)}>
                        <ArrowRightLeft className="h-4 w-4 ml-2" />
                        تحويل الوثيقة
                      </DropdownMenuItem>
                    )}
                  </>
                )}

                {/* Renewal — placed BEFORE cancel so the happier paths
                    come first and destructive actions are pushed down
                    the menu. Shown for active AND ended rows (you can
                    still renew an expired policy) but not for cancelled
                    or transferred ones. */}
                {(isActive || pkg.status === 'ended') && !isTransferred && !isCancelled && (onRenewPolicy || onRenewPackage) && (
                  <>
                    <DropdownMenuSeparator />
                    {isPkg && onRenewPackage && (
                      <DropdownMenuItem onClick={() => onRenewPackage(pkg.allPolicyIds)}>
                        <RefreshCw className="h-4 w-4 ml-2" />
                        تجديد الباقة
                      </DropdownMenuItem>
                    )}
                    {!isPkg && onRenewPolicy && (
                      <DropdownMenuItem onClick={() => onRenewPolicy(policy.id)}>
                        <RefreshCw className="h-4 w-4 ml-2" />
                        تجديد الوثيقة
                      </DropdownMenuItem>
                    )}
                  </>
                )}

                {isActive && (
                  <>
                    <DropdownMenuSeparator />
                    {isPkg && onCancelPackage && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onCancelPackage(pkg.allPolicyIds)}
                      >
                        <XCircle className="h-4 w-4 ml-2" />
                        إلغاء الباقة
                      </DropdownMenuItem>
                    )}
                    {!isPkg && onCancel && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onCancel(policy.id)}
                      >
                        <XCircle className="h-4 w-4 ml-2" />
                        إلغاء الوثيقة
                      </DropdownMenuItem>
                    )}
                  </>
                )}

                {/* Admin Only: Delete Policy */}
                {isAdmin && onDeletePolicy && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      className="text-destructive focus:text-destructive focus:bg-destructive/10"
                      onClick={() => {
                        if (isPkg) {
                          onDeletePolicy(pkg.allPolicyIds);
                        } else {
                          onDeletePolicy([policy.id]);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 ml-2" />
                      {isPkg ? 'حذف الباقة نهائياً' : 'حذف الوثيقة نهائياً'}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Main Content: Key Info Grid */}
        <div 
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm cursor-pointer"
          onClick={() => onPolicyClick(policy.id)}
        >
          {/* Company */}
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">الشركة</p>
              <p className={cn("font-medium truncate", !isActive && "text-muted-foreground")}>
                {policy.company?.name_ar || policy.company?.name || '-'}
              </p>
            </div>
          </div>

          {/* Car */}
          <div className="flex items-start gap-2">
            <Car className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">السيارة</p>
              <p className={cn("font-mono font-medium ltr-nums", !isActive && "text-muted-foreground")}>
                {policy.car?.car_number || '-'}
              </p>
            </div>
          </div>

          {/* Coverage Period */}
          <div ref={periodRef} className="flex items-start gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">الفترة</p>
              <p className={cn("font-medium text-xs", !isActive && "text-muted-foreground")}>
                <span className="ltr-nums">{formatDate(policy.start_date)}</span>
                <span className="mx-1 text-muted-foreground">←</span>
                <span className="ltr-nums">{formatDate(policy.end_date)}</span>
              </p>
            </div>
          </div>

          {/* Amount */}
          <div className="flex items-start gap-2 justify-end">
            <div className="flex flex-col items-start leading-tight">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المبلغ</span>
              <span className={cn(
                "text-lg font-bold ltr-nums",
                isActive ? "text-primary" : "text-muted-foreground"
              )}>
                ₪{pkg.totalPrice.toLocaleString('en-US')}
              </span>
              {(() => {
                const totalCommission = (isPkg
                  ? [pkg.mainPolicy, ...pkg.addons].filter(Boolean) as PolicyRecord[]
                  : [policy]
                ).reduce((sum, p) => sum + (p.office_commission || 0), 0);
                return totalCommission > 0 ? (
                  <span className="text-[9px] text-amber-700 font-semibold ltr-nums mt-0.5">
                    منها ₪{totalCommission.toLocaleString('en-US')} عمولة مكتب
                  </span>
                ) : null;
              })()}
            </div>
          </div>
        </div>

        {/* Package Components Section - Shows details for each policy in the package */}
        {isPkg && pkg.mainPolicy && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              مكونات الباقة
            </div>
            <div className="rounded-lg border border-border/60 overflow-hidden bg-muted/20">
              {/* Table header */}
              <div className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40 border-b border-border/60">
                <span className="text-center">#</span>
                <span>الوثيقة</span>
                <span className="ltr-nums">الفترة</span>
                <span className="text-left min-w-[70px]">السعر</span>
              </div>
              {/* Main policy */}
              <PackageComponentRow
                policy={pkg.mainPolicy}
                isActive={isActive}
                index={getDocNumber?.(pkg.mainPolicy.id)}
              />
              {/* Addons */}
              {pkg.addons.map((addon) => (
                <PackageComponentRow
                  key={addon.id}
                  policy={addon}
                  isActive={isActive}
                  index={getDocNumber?.(addon.id)}
                />
              ))}
              {/* Totals footer row */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenPaymentDetails?.(pkg.allPolicyIds); }}
                className="w-full flex items-start justify-end gap-6 px-3 py-2 border-t border-border/60 bg-muted/30 hover:bg-muted/50 transition-colors text-right focus:outline-none focus:ring-2 focus:ring-primary/40"
                title="عرض تفاصيل الدفعات"
              >
                <div className="flex flex-col text-xs items-end text-left">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المدفوع</span>
                  <span className="font-bold text-success ltr-nums">
                    ₪{paymentStatus.totalPaid.toLocaleString('en-US')}
                  </span>
                </div>
                <div className="flex flex-col text-xs items-end text-left">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المتبقي للدفع</span>
                  <span className={cn(
                    "font-bold ltr-nums",
                    paymentStatus.remaining > 0 ? "text-destructive" : "text-success"
                  )}>
                    ₪{paymentStatus.remaining.toLocaleString('en-US')}
                  </span>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Standalone policy totals — same framed footer for single-policy cards
            (which don't render مكونات الباقة) so every card surfaces the same
            paid/remaining summary in the same place. */}
        {!isPkg && isActive && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="rounded-lg border border-border/60 bg-muted/20 overflow-hidden">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenPaymentDetails?.([policy.id]); }}
                className="w-full flex items-start justify-end gap-6 px-3 py-2 hover:bg-muted/50 transition-colors text-right focus:outline-none focus:ring-2 focus:ring-primary/40"
                title="عرض تفاصيل الدفعات"
              >
                <div className="flex flex-col text-xs items-end text-left">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المدفوع</span>
                  <span className="font-bold text-success ltr-nums">
                    ₪{paymentStatus.totalPaid.toLocaleString('en-US')}
                  </span>
                </div>
                <div className="flex flex-col text-xs items-end text-left">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المتبقي للدفع</span>
                  <span className={cn(
                    "font-bold ltr-nums",
                    paymentStatus.remaining > 0 ? "text-destructive" : "text-success"
                  )}>
                    ₪{paymentStatus.remaining.toLocaleString('en-US')}
                  </span>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Notes Section - Inline Edit */}
        <div 
          className="mt-3 pt-3 border-t border-border/50"
          onClick={(e) => e.stopPropagation()}
        >
          {isEditingNotes ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">ملاحظات الوثيقة</span>
              </div>
              <Textarea
                value={editedNotesValue || ''}
                onChange={(e) => onNotesValueChange?.(e.target.value)}
                placeholder="أدخل ملاحظات الوثيقة..."
                className="min-h-[60px] text-sm resize-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    onCancelEditNotes?.();
                  } else if (e.key === 'Enter' && e.ctrlKey) {
                    onSaveNotes?.(policy.id);
                  }
                }}
              />
              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancelEditNotes}
                  disabled={savingNotes}
                >
                  <X className="h-4 w-4 ml-1" />
                  إلغاء
                </Button>
                <Button
                  size="sm"
                  onClick={() => onSaveNotes?.(policy.id)}
                  disabled={savingNotes}
                >
                  {savingNotes ? (
                    <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 ml-1" />
                  )}
                  حفظ
                </Button>
              </div>
            </div>
          ) : (
            <div 
              className="flex items-start gap-2 cursor-pointer hover:bg-muted/50 rounded-md p-2 -m-2 transition-colors"
              onClick={() => onStartEditNotes?.(policy.id, policy.notes)}
            >
              <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">ملاحظات</p>
                {policy.notes ? (
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {policy.notes}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    لا توجد ملاحظات - اضغط للإضافة
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// Compact row component for package component details
function PackageComponentRow({
  policy,
  isActive,
  index,
}: {
  policy: PolicyRecord;
  isActive: boolean;
  index?: number;
}) {
  const typeLabel = getDisplayLabel(policy);
  const typeColor = policyTypeColors[policy.policy_type_parent];
  const commission = policy.office_commission || 0;

  // Get company/service name based on policy type
  const getProviderName = () => {
    // For road service or accident fee policies, the company field should contain the service provider
    // If not, we show the insurance company
    return policy.company?.name_ar || policy.company?.name || '-';
  };

  return (
    <div
      data-policy-row-id={policy.id}
      className={cn(
        "grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 px-3 py-2 text-xs border-b border-border/60 last:border-b-0 transition-colors hover:bg-muted/30",
        !isActive && "opacity-70"
      )}
    >
      {/* # column */}
      {index !== undefined ? (
        <span
          data-doc-number
          className="text-[10px] font-bold text-muted-foreground ltr-nums text-center"
        >
          #{index}
        </span>
      ) : (
        <span />
      )}

      {/* Policy column: type badge + service subtype + company */}
      <div className="flex items-center gap-2 min-w-0">
        <Badge className={cn("text-[10px] px-1.5 py-0 h-5 font-medium border shrink-0", typeColor)}>
          {typeLabel}
        </Badge>
        {policy.policy_type_parent === 'ROAD_SERVICE' && (policy.road_service?.name_ar || policy.road_service?.name) && (
          <span className="text-[10px] font-semibold text-orange-700 bg-orange-500/10 border border-orange-500/30 rounded px-1.5 py-0 h-5 inline-flex items-center shrink-0">
            {policy.road_service?.name_ar || policy.road_service?.name}
          </span>
        )}
        <span className={cn(
          "truncate",
          isActive ? "text-muted-foreground" : "text-muted-foreground/70"
        )}>
          {getProviderName()}
        </span>
        {policy.broker_id && policy.broker && (
          <span
            className="text-[10px] font-semibold text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0 h-5 inline-flex items-center gap-1 shrink-0"
            title={`${policy.broker_direction === 'from_broker' ? 'من الوسيط' : 'إلى الوسيط'}: ${policy.broker.name}`}
          >
            <Handshake className="h-3 w-3" />
            {policy.broker.name}
          </span>
        )}
      </div>

      {/* Period column */}
      <span className={cn(
        "ltr-nums text-[11px] shrink-0",
        isActive ? "text-muted-foreground" : "text-muted-foreground/70"
      )}>
        {formatDate(policy.end_date)} ← {formatDate(policy.start_date)}
      </span>

      {/* Price column */}
      <div className="flex flex-col items-end min-w-[70px]">
        <span className={cn(
          "font-semibold ltr-nums",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}>
          ₪{policy.insurance_price.toLocaleString('en-US')}
        </span>
        {commission > 0 && (
          <span className="text-[9px] text-amber-700 font-semibold ltr-nums">
            + ₪{commission.toLocaleString('en-US')} عمولة
          </span>
        )}
      </div>
    </div>
  );
}
