import { useState, useMemo, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  ChevronDown,
  ChevronLeft,
  Calendar,
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
  Printer,
  Copy,
  Hash,
  Baby,
} from 'lucide-react';

// WhatsApp brand glyph (lucide ships no brand icons). Single-color so it
// inherits `currentColor` from the surrounding button.
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.885 3.488" />
  </svg>
);
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
import { Lock } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { pickPackageDocumentNumber } from '@/lib/packageDocumentNumber';
import { toast } from 'sonner';
import { toastFunctionError } from '@/lib/functionError';
import { useSmsLock } from '@/hooks/useSmsLock';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';

interface PolicyRecord {
  id: string;
  policy_number: string | null;
  document_number: string | null;
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
  broker_buy_price?: number | null;
  company: { name: string; name_ar: string | null } | null;
  car: { id: string; car_number: string } | null;
  creator: { full_name: string | null; email: string } | null;
  road_service?: { name: string; name_ar: string | null } | null;
  broker?: { id: string; name: string } | null;
  branch_id?: string | null;
  created_at?: string;
  is_under_24?: boolean | null;
}

interface TransferAdjustment {
  amount: number;
  customerNote: string | null;
  officeNote: string | null;
  adjustmentNote: string | null;
}

interface PolicyYearTimelineProps {
  policies: PolicyRecord[];
  /** Used in the SMS hover card on every policy row so staff can see
      which number the invoice link will go to before they click. */
  clientPhone?: string | null;
  paymentInfo?: Record<string, { paid: number; remaining: number }>;
  accidentInfo?: Record<string, number>;
  childrenInfo?: Record<string, number>;
  /** Per-policy file count keyed by policy.id (entity_id in media_files).
   *  Drives the "ملفات (N)" button on each card. */
  fileCounts?: Record<string, number>;
  /** Click handler for the ملفات button — opens the details drawer
   *  pre-positioned to the files tab. Distinct from onPolicyClick. */
  onOpenPolicyFiles?: (policyId: string) => void;
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
  // True when this is the most recently-added non-transfer package in its
  // year — drives the "جديدة" badge and the top-of-year sort position.
  // Stays put when a sibling is cancelled or transferred (those don't
  // create a fresh package); only shifts when a brand-new معاملة is added.
  isNewest: boolean;
}

interface YearGroup {
  yearLabel: string;
  yearSortKey: number;
  isCurrent: boolean;
  packages: PolicyPackage[];
}

export function PolicyYearTimeline({
  policies,
  clientPhone,
  paymentInfo: externalPaymentInfo,
  accidentInfo: externalAccidentInfo,
  childrenInfo: externalChildrenInfo,
  fileCounts,
  onOpenPolicyFiles,
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
  const { can } = usePermissions();
  // Profit / commission / debt numbers are gated by the cross-cut
  // view_financial flag (admins always pass). Computed once here and
  // passed down so PolicyPackageCard doesn't need to re-subscribe.
  const canSeeFinancials = isAdmin || isSuperAdmin || can('view_financial');

  // O(1) policy lookup so getPackagePaymentStatus can sum profit per
  // package without re-walking the policies array on every render.
  const policyById = useMemo(
    () => new Map(policies.map((p) => [p.id, p])),
    [policies],
  );

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

  // Transfer adjustment map — keyed by new_policy_id, value is the
  // customer-pays adjustment amount carried on policy_transfers. Used
  // below so the package breakdown can split the policy's
  // office_commission into the original office portion (stays in the
  // policy row) and the transfer portion (rendered as its own row
  // after all policy components). Only queried when any visible
  // policy has transferred_from_policy_id set, so non-transfer clients
  // don't pay a round-trip cost.
  const [transferAdjustments, setTransferAdjustments] = useState<Record<string, TransferAdjustment>>({});
  // Source-side notes — the same office_note / adjustment_note / note
  // that already render on the target card need to surface on the
  // transferred-OUT source card too, so staff reviewing the old
  // transaction can see the reason without opening the target. Keyed
  // by the source policy_id.
  const [sourceTransferNotes, setSourceTransferNotes] = useState<Record<string, TransferAdjustment>>({});
  useEffect(() => {
    const sourceIds = policies.filter(p => p.transferred).map(p => p.id);
    const targetIds = policies.filter(p => p.transferred_from_policy_id).map(p => p.id);
    if (sourceIds.length === 0 && targetIds.length === 0) {
      setTransferAdjustments({});
      setSourceTransferNotes({});
      return;
    }
    let cancelled = false;
    (async () => {
      // Fetch every transfer row where either end matches a policy in
      // the current view. Most transfers have both ends visible (same
      // year), but cross-year transfers are also handled — we just ask
      // for both directions in one round-trip.
      const orFilters: string[] = [];
      if (sourceIds.length > 0) {
        orFilters.push(`policy_id.in.(${sourceIds.join(',')})`);
      }
      if (targetIds.length > 0) {
        orFilters.push(`new_policy_id.in.(${targetIds.join(',')})`);
      }
      let query = supabase
        .from('policy_transfers')
        .select('policy_id, new_policy_id, adjustment_amount, adjustment_type, note, office_note, adjustment_note');
      if (orFilters.length === 1) {
        const [col, , raw] = orFilters[0].split('.');
        query = query.in(col, raw.slice(1, -1).split(','));
      } else {
        query = query.or(orFilters.join(','));
      }
      const { data } = await query;
      if (cancelled) return;
      const targetMap: Record<string, TransferAdjustment> = {};
      const sourceMap: Record<string, TransferAdjustment> = {};
      (data || []).forEach((row: any) => {
        const info: TransferAdjustment = {
          amount: Number(row.adjustment_amount || 0),
          customerNote: typeof row.note === 'string' && row.note.trim() ? row.note.trim() : null,
          officeNote: typeof row.office_note === 'string' && row.office_note.trim() ? row.office_note.trim() : null,
          adjustmentNote: typeof row.adjustment_note === 'string' && row.adjustment_note.trim() ? row.adjustment_note.trim() : null,
        };
        // Target side keeps its existing rule — only "customer_pays"
        // with a positive amount renders as a "عمولة التحويل" charge
        // row on the new card.
        if (
          row?.new_policy_id &&
          row?.adjustment_type === 'customer_pays' &&
          info.amount > 0
        ) {
          targetMap[row.new_policy_id] = info;
        }
        // Source side surfaces whenever there is any note — office,
        // adjustment, or customer-facing reason. Lets the agent see
        // why the transfer happened by looking at the transferred-out
        // row alone.
        if (
          row?.policy_id &&
          (info.officeNote || info.adjustmentNote || info.customerNote)
        ) {
          sourceMap[row.policy_id] = info;
        }
      });
      setTransferAdjustments(targetMap);
      setSourceTransferNotes(sourceMap);
    })();
    return () => {
      cancelled = true;
    };
  }, [policies.map(p => p.id).join('|')]);

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
          debtPrice,
          isNewest: false,
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
          debtPrice: policy.insurance_price + (policy.office_commission || 0),
          isNewest: false,
        });
      });

      // Mark the newest non-transfer-created package in this year. The
      // candidate is the package whose latest policy.created_at is the
      // greatest, ignoring any package where at least one policy was
      // created by a transfer (transferred_from_policy_id IS NOT NULL).
      // Excluding transfer-created packages is what keeps the "جديدة"
      // badge anchored when a policy is transferred — the transfer
      // makes a new row, but the user has been clear it shouldn't
      // claim the badge.
      let newestPkgIndex = -1;
      let newestCreatedAt = '';
      packages.forEach((p, idx) => {
        const polys = [p.mainPolicy, ...p.addons].filter((x): x is PolicyRecord => !!x);
        if (polys.length === 0) return;
        if (polys.some(x => x.transferred_from_policy_id)) return;
        const maxCreated = polys.reduce((acc, x) => {
          const c = x.created_at || '';
          return c > acc ? c : acc;
        }, '');
        if (maxCreated && maxCreated > newestCreatedAt) {
          newestCreatedAt = maxCreated;
          newestPkgIndex = idx;
        }
      });
      if (newestPkgIndex >= 0) {
        packages[newestPkgIndex].isNewest = true;
      }

      // Sort packages within year:
      // 1. Status first: active → ended → transferred → cancelled.
      //    After a تحويل the freshly-created target package is active
      //    while the source flips to transferred — surfacing the
      //    active one at the top so the agent sees the current state
      //    without scrolling. "isNewest" used to come first here,
      //    which let the transferred-out source keep the top slot
      //    just because it had the older created_at among
      //    non-transfer-target packages.
      // 2. Then by "isNewest" (the جديدة flag, fresh-creation hint)
      // 3. Then by newest start date
      packages.sort((a, b) => {
        const priorityA = getStatusPriority(a.status);
        const priorityB = getStatusPriority(b.status);
        if (priorityA !== priorityB) return priorityA - priorityB;

        if (a.isNewest && !b.isNewest) return -1;
        if (!a.isNewest && b.isNewest) return 1;

        const policyA = a.mainPolicy || a.addons[0];
        const policyB = b.mainPolicy || b.addons[0];
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
          id, policy_id, amount, payment_date, payment_type, cheque_number, cheque_date,
          bank_code, branch_code, cheque_image_url, card_last_four, refused, locked, notes,
          policy:policies!policy_payments_policy_id_fkey(
            id, policy_type_parent, policy_type_child, insurance_price, office_commission
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
        // Bank/branch/cheque_date were being dropped here, so opening
        // the edit dialog from the timeline always showed an empty
        // bank field even after the user had saved one. Pass them
        // through so PaymentEditDialog's formData init sees them.
        cheque_date: p.cheque_date,
        bank_code: p.bank_code,
        branch_code: p.branch_code,
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

  // Direct invoice actions triggered by the per-card hover buttons
  // (no popup). Both single policies and packages now go through
  // `send-package-invoice-sms` with a policy_ids array so they share
  // one printed template — a single policy is just a 1-item array.
  // The old `send-invoice-sms` route rendered the legacy single-
  // policy invoice layout, which looked different from packages and
  // surprised users when they printed a plain non-package row.
  // isPackage is still passed in for the SMS-button copy below.
  const handleCardPrintInvoice = async (policyIds: string[], _isPackage: boolean): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('send-package-invoice-sms', {
        body: { policy_ids: policyIds, skip_sms: true },
      });
      if (error) {
        await toastFunctionError(error, 'فشل في تحميل المعاملة');
        return false;
      }
      if (data?.error) {
        toast.error(data.error);
        return false;
      }
      const invoiceUrl = data?.package_invoice_url || data?.ab_invoice_url || data?.invoice_url;
      if (invoiceUrl) {
        window.open(invoiceUrl, '_blank');
        return true;
      }
      toast.error('لم يتم إنشاء رابط المعاملة');
      return false;
    } catch (err: any) {
      toast.error(err?.message || 'فشل في تحميل المعاملة');
      return false;
    }
  };

  const handleCardSendInvoiceSms = async (policyIds: string[], isPackage: boolean): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('send-package-invoice-sms', {
        body: { policy_ids: policyIds },
      });
      if (error) {
        await toastFunctionError(error, 'فشل في الإرسال');
        return false;
      }
      if (data?.error) {
        toast.error(data.error);
        return false;
      }
      toast.success(isPackage ? 'تم إرسال المعاملات للعميل' : 'تم إرسال المعاملة للعميل');
      return true;
    } catch (err: any) {
      toast.error(err?.message || 'فشل في الإرسال');
      return false;
    }
  };

  // WhatsApp variant: ask the same edge function to assemble the SMS
  // body (so the customer gets the same text), then open a wa.me URL
  // prefilled with that text. No SMS is sent and no quota consumed.
  const handleCardSendInvoiceWhatsapp = async (policyIds: string[]): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('send-package-invoice-sms', {
        body: { policy_ids: policyIds, whatsapp_mode: true },
      });
      if (error) {
        await toastFunctionError(error, 'فشل في تجهيز رسالة WhatsApp');
        return false;
      }
      if (data?.error) {
        toast.error(data.error);
        return false;
      }
      const phone = data?.whatsapp_phone as string | undefined;
      const text = data?.message_text as string | undefined;
      if (!phone || !text) {
        toast.error('فشل في تجهيز رسالة WhatsApp');
        return false;
      }
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    } catch (err: any) {
      toast.error(err?.message || 'فشل في تجهيز رسالة WhatsApp');
      return false;
    }
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
    let profit = 0;

    pkg.allPolicyIds.forEach(id => {
      totalPaid += paymentInfo[id]?.paid || 0;
      profit += policyById.get(id)?.profit || 0;
    });

    // Calculate remaining as package total - all payments
    // This is the correct way for packages (same as drawer)
    const remaining = Math.max(0, pkg.totalPrice - totalPaid);
    const isPaid = remaining <= 0 && pkg.totalPrice > 0;

    return { totalPaid, remaining, isPaid, profit };
  };

  if (policies.length === 0) {
    return (
      <Card className="text-center py-12">
        <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-muted-foreground">لا توجد معاملات تأمين</p>
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
                  {totalCount} معاملة
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
                        sequence={pkgIndex + 1}
                        transferAdjustments={transferAdjustments}
                        sourceTransferNotes={sourceTransferNotes}
                        paymentStatus={getPackagePaymentStatus(pkg)}
                        accidentCount={accidentCount}
                        childrenCount={childrenCount}
                        clientPhone={clientPhone}
                        getDocNumber={(id) => policyDocNumbers.get(id)}
                        onOpenPaymentDetails={handleOpenPaymentDetails}
                        fileCount={pkg.allPolicyIds.reduce(
                          (s, id) => s + (fileCounts?.[id] || 0),
                          0,
                        )}
                        onOpenFiles={onOpenPolicyFiles
                          ? () => onOpenPolicyFiles(mainPolicy?.id || pkg.allPolicyIds[0])
                          : undefined}
                        onPolicyClick={onPolicyClick}
                        onPaymentClick={(e) => handlePackagePayment(e, pkg.allPolicyIds, pkg.mainPolicy?.branch_id || pkg.addons[0]?.branch_id || null)}
                        onPrintInvoice={() => handleCardPrintInvoice(pkg.allPolicyIds, pkg.allPolicyIds.length > 1)}
                        onSendInvoiceSms={() => handleCardSendInvoiceSms(pkg.allPolicyIds, pkg.allPolicyIds.length > 1)}
                        onSendInvoiceWhatsapp={() => handleCardSendInvoiceWhatsapp(pkg.allPolicyIds)}
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
                        canSeeFinancials={canSeeFinancials}
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
                        onPoliciesUpdate={onPoliciesUpdate}
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
  sequence,
  transferAdjustments,
  sourceTransferNotes,
  paymentStatus,
  accidentCount = 0,
  childrenCount = 0,
  clientPhone,
  getDocNumber,
  onOpenPaymentDetails,
  fileCount = 0,
  onOpenFiles,
  onPolicyClick,
  onPaymentClick,
  onPrintInvoice,
  onSendInvoiceSms,
  onSendInvoiceWhatsapp,
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
  canSeeFinancials,
  isEditingNotes,
  editedNotesValue,
  savingNotes,
  onStartEditNotes,
  onCancelEditNotes,
  onNotesValueChange,
  onSaveNotes,
  onPoliciesUpdate,
}: {
  pkg: PolicyPackage;
  /** 1-based sibling index within the current year — shown as "#N" prefix
   *  on the doc-number chip so staff can refer to cards by position
   *  without leaning on the server-assigned document number. */
  sequence?: number;
  /** new_policy_id → customer-pays transfer adjustment (amount + the
   *  three transfer notes), so the breakdown can surface a standalone
   *  'عمولة التحويل' row and attach the transfer reason + office note
   *  + financial-adjustment note underneath it. Populated by the parent
   *  PolicyYearTimeline from policy_transfers. */
  transferAdjustments: Record<string, TransferAdjustment>;
  /** source policy_id → the same three transfer notes, rendered as a
   *  small footer block on the transferred-OUT card so staff reviewing
   *  the old transaction see the reason without opening the target.
   *  Amount lives only on the target side. */
  sourceTransferNotes: Record<string, TransferAdjustment>;
  paymentStatus: { totalPaid: number; remaining: number; isPaid: boolean; profit: number };
  accidentCount?: number;
  childrenCount?: number;
  clientPhone?: string | null;
  getDocNumber?: (policyId: string) => number | undefined;
  onOpenPaymentDetails?: (policyIds: string[]) => void;
  /** Total media_files attached to any policy in the package — drives
   *  the "ملفات (N)" button. */
  fileCount?: number;
  /** Click handler for the ملفات button — opens the details drawer
   *  pre-positioned to the files tab. */
  onOpenFiles?: () => void;
  onPolicyClick: (id: string) => void;
  onPaymentClick: (e: React.MouseEvent) => void;
  onPrintInvoice: () => Promise<boolean>;
  onSendInvoiceSms: () => Promise<boolean>;
  onSendInvoiceWhatsapp: () => Promise<boolean>;
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
  /** True when the viewer is allowed to see profit / commission /
   *  debt numbers — admin/super admin always pass; workers need the
   *  view_financial cross-cut permission. Drives whether the profit
   *  column is rendered in the totals footer. */
  canSeeFinancials?: boolean;
  isEditingNotes?: boolean;
  editedNotesValue?: string;
  savingNotes?: boolean;
  onStartEditNotes?: (policyId: string, currentNotes: string | null) => void;
  onCancelEditNotes?: () => void;
  onNotesValueChange?: (value: string) => void;
  onSaveNotes?: (policyId: string) => void;
  onPoliciesUpdate?: () => void;
}) {
  const { locked: smsLocked, loading: smsLoading, openUpgradeDialog: openSmsUpgrade } = useSmsLock();
  const policy = pkg.mainPolicy || pkg.addons[0];
  if (!policy) return null;

  const isActive = pkg.status === 'active';
  const isTransferred = pkg.status === 'transferred';
  const isCancelled = pkg.status === 'cancelled';
  const isPkg = isPackageProp || (pkg.addons.length > 0 && pkg.mainPolicy !== null);
  const hasUnpaid = !paymentStatus.isPaid;
  // Broker-involved packages: the money is tracked against the broker,
  // not the customer. Suppress the customer-debt surface (red "remaining"
  // totals and the "دفع" button) and show a neutral notice instead. The
  // value itself still lives in the package → broker accounting will be
  // reconciled elsewhere.
  const brokerCardPolicy = (isPkg && pkg.mainPolicy
    ? [pkg.mainPolicy, ...pkg.addons]
    : [policy]
  ).find(p => p.broker_id && p.broker);
  const hasBroker = !!brokerCardPolicy;
  const brokerNoteText = brokerCardPolicy
    ? (brokerCardPolicy.broker_direction === 'to_broker'
        ? `صُدرت هذه المعاملة للوسيط ${brokerCardPolicy.broker?.name ?? ''} — المبلغ يُتابع في حساب الوسيط`
        : `تمت هذه المعاملة عبر الوسيط ${brokerCardPolicy.broker?.name ?? ''} — المبلغ يُتابع في حساب الوسيط`)
    : '';
  const [invoiceBusy, setInvoiceBusy] = useState<'print' | 'sms' | 'whatsapp' | null>(null);

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

  // Whole-card click → was wired to open the policy-details drawer
  // (PolicyDetailsDrawer). Disabled at the user's request — the drawer
  // still mounts when triggered explicitly (e.g. the dedicated Files
  // button below, or kebab-menu "تفاصيل المعاملة"), but a stray click
  // anywhere on the card no longer pops it. Keeping the function
  // around as a no-op so re-enabling later is just deleting one line.
  const handleCardClick = (_e: React.MouseEvent<HTMLDivElement>) => {
    // intentionally empty — drawer entry was hidden
  };

  return (
    <Card
      ref={cardRef}
      data-policy-ids={pkg.allPolicyIds.join(' ')}
      onClick={handleCardClick}
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
          {/* The top-row policy_number copy chip was removed — the row-level
              PolicyNumberInlineEdit already exposes (and lets you edit) the
              same value, and duplicating it in the card header added noise
              without unique information. */}
          {/* Status badges (سارية / منتهية / محولة / ملغاة) moved after
              flex-1 so they sit with the action cluster on the left. Kept
              here as no-op markers to preserve surrounding logic. */}

          {/* Policy Type — for packages: 'باقة' badge first (rightmost in
              RTL), then the main + addon type chips. For singles: the single
              type chip. The transfer-from / broker badges are rendered AFTER
              the types so they appear to the LEFT of them in RTL. */}
          {(() => {
            // رقم المعاملة chip — one per معاملة. The value comes from
            // pickPackageDocumentNumber so the card, the payments log
            // and the printed invoice/report all land on the same
            // بوليصة's document_number (THIRD_FULL > ELZAMI > addons).
            const policiesInCard: PolicyRecord[] = isPkg && pkg.mainPolicy
              ? [pkg.mainPolicy, ...pkg.addons]
              : [policy];
            const docNumber = pickPackageDocumentNumber(policiesInCard);
            if (!docNumber) return null;
            return <CardLevelPolicyNumberChip value={docNumber} sequence={sequence} />;
          })()}

          {isPkg && pkg.mainPolicy ? (
            <div className="flex flex-wrap items-center gap-1">
              <Badge variant="outline" className="gap-1 text-xs bg-primary/5 border-primary/20 text-primary">
                <Zap className="h-3 w-3" />
                باقة
              </Badge>
              <PolicyTypeChip
                policy={pkg.mainPolicy}
                onPulse={pulsePolicyRow(pkg.mainPolicy.id)}
              />
              {pkg.addons.map((addon) => (
                <span key={addon.id} className="flex items-center gap-1">
                  <span className="text-muted-foreground text-xs">+</span>
                  <PolicyTypeChip
                    policy={addon}
                    onPulse={pulsePolicyRow(addon.id)}
                    bold={false}
                  />
                </span>
              ))}
            </div>
          ) : (
            <PolicyTypeChip
              policy={policy}
              onPulse={pulsePolicyRow(policy.id)}
              asButton={false}
            />
          )}

          {/* Transfer FROM indicator — for policies created via transfer.
              Sits after the type cluster so it lands to the LEFT of the
              types in RTL, alongside the broker badge below. */}
          {wasTransferredFrom && !isTransferred && (
            <Badge variant="outline" className="gap-1 text-xs bg-blue-500/10 border-blue-500/30 text-blue-600">
              <ArrowRightLeft className="h-3 w-3" />
              محولة من سيارة <span className="font-mono ltr-nums">{wasTransferredFrom}</span>
            </Badge>
          )}

          {/* Accident indicator */}
          {accidentCount > 0 && (
            <Badge variant="outline" className="gap-1 text-xs bg-orange-500/10 border-orange-500/30 text-orange-600">
              <AlertTriangle className="h-3 w-3" />
              {accidentCount} حادث
            </Badge>
          )}

          {/* "جديدة" badge — marks the most recently-added non-transfer
              package in this year. Stays anchored across status changes
              (cancel/transfer), and only moves when a brand-new معاملة is
              added. Computed once in the parent useMemo. */}
          {pkg.isNewest && (
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

          {/* Under-24 indicator — true if any policy in the card was
              flagged as is_under_24 (set by the under-24 toggle in the
              edit modal / wizard). Mirrors the chip the printed invoice
              now stamps on the customer info table. */}
          {(() => {
            const policiesInCard: PolicyRecord[] = isPkg && pkg.mainPolicy
              ? [pkg.mainPolicy, ...pkg.addons]
              : [policy];
            const isUnder24 = policiesInCard.some((p) => p.is_under_24);
            if (!isUnder24) return null;
            return (
              <Badge variant="outline" className="gap-1 text-xs bg-amber-500/10 border-amber-500/30 text-amber-700">
                <Baby className="h-3 w-3" />
                أقل من 24
              </Badge>
            );
          })()}

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

          {/* Payment status badge also moved to the left cluster below. */}

          <div className="flex-1" />

          {/* Left cluster — status badges first, then quick actions. In
              RTL flex this visually lands to the left of the spacer. */}
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
              {wasTransferredTo ? (
                <>محولة إلى رقم سيارة <span className="font-mono ltr-nums">{wasTransferredTo}</span></>
              ) : (
                <>محولة</>
              )}
            </Badge>
          )}
          {isCancelled && (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              ملغاة
            </Badge>
          )}
          {paymentStatus.isPaid && (
            <Badge variant="outline" className="gap-1 text-success border-success/30 bg-success/5">
              <CheckCircle className="h-3 w-3" />
              مدفوع
            </Badge>
          )}

          {/* Quick Actions */}
          <div className="flex items-center gap-1">
            {hasUnpaid && isActive && !hasBroker && (
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

            {/* Files shortcut — replaces the previous whole-card click
                to open the details drawer. Compact button with the
                file count badge; click opens the drawer pre-positioned
                to the ملفات tab. Always rendered (even when count=0)
                so the user has a visible entry point to upload the
                first file. */}
            {onOpenFiles && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1 h-8 px-2.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFiles();
                }}
                title="عرض / إضافة ملفات هذه المعاملة"
              >
                <FileText className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">ملفات</span>
                <span className="font-mono ltr-nums text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-px">
                  {fileCount}
                </span>
              </Button>
            )}

            {/* Print invoice — hover reveals a card with the action title
                and a short description. Click triggers the print flow. */}
            <HoverCard openDelay={120} closeDelay={80}>
              <HoverCardTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                  disabled={invoiceBusy !== null}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (invoiceBusy) return;
                    setInvoiceBusy('print');
                    try {
                      await onPrintInvoice();
                    } finally {
                      setInvoiceBusy(null);
                    }
                  }}
                  aria-label="طباعة المعاملة"
                >
                  {invoiceBusy === 'print' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="h-4 w-4" />
                  )}
                </Button>
              </HoverCardTrigger>
              <HoverCardContent
                side="top"
                align="end"
                className="w-auto min-w-[220px] p-3 border-primary/20 shadow-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Printer className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">طباعة المعاملة</p>
                    <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                      فتح المعاملة في نافذة جديدة للطباعة
                    </p>
                  </div>
                </div>
              </HoverCardContent>
            </HoverCard>

            {/* Send SMS — same pattern, richer hover card showing the exact
                number the link will go to so staff can double-check before
                clicking. */}
            <HoverCard openDelay={120} closeDelay={80}>
              <HoverCardTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="relative h-8 w-8 p-0 text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                  disabled={invoiceBusy !== null || smsLoading || (!smsLocked && !clientPhone)}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (invoiceBusy || smsLoading) return;
                    if (smsLocked) {
                      openSmsUpgrade();
                      return;
                    }
                    if (!clientPhone) {
                      toast.error('لا يوجد رقم هاتف للعميل');
                      return;
                    }
                    setInvoiceBusy('sms');
                    try {
                      await onSendInvoiceSms();
                    } finally {
                      setInvoiceBusy(null);
                    }
                  }}
                  aria-label="إرسال SMS للعميل"
                >
                  {invoiceBusy === 'sms' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {smsLocked && (
                    <span className="absolute -top-1 -left-1 h-4 w-4 rounded-full bg-white text-amber-600 flex items-center justify-center ring-2 ring-amber-500">
                      <Lock className="h-2.5 w-2.5" weight="fill" />
                    </span>
                  )}
                </Button>
              </HoverCardTrigger>
              <HoverCardContent
                side="top"
                align="end"
                className="w-auto min-w-[260px] p-3 border-emerald-500/20 shadow-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                    <Send className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">إرسال SMS للعميل</p>
                    {clientPhone ? (
                      <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                        سيتم إرسال رابط المعاملة للرقم{' '}
                        <span className="font-mono font-semibold text-foreground ltr-nums">
                          {clientPhone}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-destructive leading-tight mt-0.5">
                        لا يوجد رقم هاتف للعميل
                      </p>
                    )}
                  </div>
                </div>
              </HoverCardContent>
            </HoverCard>

            {/* Send via WhatsApp — opens wa.me with the same message body
                the SMS would carry. No SMS quota is consumed; the user
                still has to tap "send" inside WhatsApp. */}
            <HoverCard openDelay={120} closeDelay={80}>
              <HoverCardTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="relative h-8 w-8 p-0 text-muted-foreground hover:text-green-600 hover:bg-green-500/10 transition-colors"
                  disabled={invoiceBusy !== null || !clientPhone}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (invoiceBusy) return;
                    if (!clientPhone) {
                      toast.error('لا يوجد رقم هاتف للعميل');
                      return;
                    }
                    setInvoiceBusy('whatsapp');
                    try {
                      await onSendInvoiceWhatsapp();
                    } finally {
                      setInvoiceBusy(null);
                    }
                  }}
                  aria-label="إرسال WhatsApp للعميل"
                >
                  {invoiceBusy === 'whatsapp' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <WhatsAppIcon className="h-4 w-4" />
                  )}
                </Button>
              </HoverCardTrigger>
              <HoverCardContent
                side="top"
                align="end"
                className="w-auto min-w-[260px] p-3 border-green-500/20 shadow-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-green-500/10 text-green-600 flex items-center justify-center shrink-0">
                    <WhatsAppIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">إرسال WhatsApp للعميل</p>
                    {clientPhone ? (
                      <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                        سيتم فتح WhatsApp للرقم{' '}
                        <span className="font-mono font-semibold text-foreground ltr-nums">
                          {clientPhone}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-destructive leading-tight mt-0.5">
                        لا يوجد رقم هاتف للعميل
                      </p>
                    )}
                  </div>
                </div>
              </HoverCardContent>
            </HoverCard>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {/* Edit — open the package/policy edit modal directly from
                    the dropdown so the user doesn't have to walk through
                    the details drawer first. Hidden for cancelled and
                    transferred rows since those are locked anyway. */}
                {!isCancelled && !isTransferred && (
                  <>
                    {isPkg && onEditPackage && policy.group_id && (
                      <DropdownMenuItem onClick={() => onEditPackage(policy.group_id!)}>
                        <Pencil className="h-4 w-4 ml-2" />
                        تعديل المعاملة
                      </DropdownMenuItem>
                    )}
                    {!isPkg && onEditPolicy && (
                      <DropdownMenuItem onClick={() => onEditPolicy(policy.id)}>
                        <Pencil className="h-4 w-4 ml-2" />
                        تعديل المعاملة
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
                        تحويل المعاملة
                      </DropdownMenuItem>
                    )}
                    {!isPkg && onTransfer && (
                      <DropdownMenuItem onClick={() => onTransfer(policy.id)}>
                        <ArrowRightLeft className="h-4 w-4 ml-2" />
                        تحويل المعاملة
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
                        تجديد المعاملة
                      </DropdownMenuItem>
                    )}
                    {!isPkg && onRenewPolicy && (
                      <DropdownMenuItem onClick={() => onRenewPolicy(policy.id)}>
                        <RefreshCw className="h-4 w-4 ml-2" />
                        تجديد المعاملة
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
                        إلغاء المعاملة
                      </DropdownMenuItem>
                    )}
                    {!isPkg && onCancel && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onCancel(policy.id)}
                      >
                        <XCircle className="h-4 w-4 ml-2" />
                        إلغاء المعاملة
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
                      حذف المعاملة نهائياً
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Main Content: Key Info Grid — company column removed since the
            insurer name is already visible inside the مكونات rows below;
            period column likewise lives in those rows.
            Click handler was wired to open the policy-details drawer;
            removed alongside the whole-card handler above. */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {/* Car */}
          <div ref={periodRef} className="flex items-start gap-2">
            <Car className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">السيارة</p>
              <p className={cn("font-mono font-medium ltr-nums", !isActive && "text-muted-foreground")}>
                {policy.car?.car_number || '-'}
              </p>
            </div>
          </div>

          {/* Amount. Split out إلزامي onto its own line so the
              bookkeeper sees "package price (without إلزامي)" + a
              separate "إلزامي: X" — the إلزامي portion goes straight
              to the insurer and is tracked apart from what the
              office actually collects. */}
          {(() => {
            const rowPoliciesForAmount = (isPkg
              ? [pkg.mainPolicy, ...pkg.addons].filter(Boolean) as PolicyRecord[]
              : [policy]
            );
            const elzamiTotal = rowPoliciesForAmount
              .filter((p) => p.policy_type_parent === 'ELZAMI')
              .reduce((s, p) => s + p.insurance_price + (p.office_commission || 0), 0);
            const packageTotal = pkg.totalPrice - elzamiTotal;
            return (
              <div className="flex items-start gap-2 justify-end">
                <div className="flex flex-col items-start leading-tight">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المبلغ</span>
                  <span className={cn(
                    "text-lg font-bold ltr-nums",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}>
                    ₪{packageTotal.toLocaleString('en-US')}
                  </span>
                  {elzamiTotal > 0 && (
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      <span className="text-muted-foreground/70">+ </span>إلزامي: <span className="font-semibold ltr-nums">₪{elzamiTotal.toLocaleString('en-US')}</span>
                    </span>
                  )}
                  {(() => {
                    const rowPolicies = rowPoliciesForAmount;
                const totalCommission = rowPolicies.reduce(
                  (sum, p) => sum + (p.office_commission || 0),
                  0,
                );
                const totalTransferPortion = rowPolicies.reduce(
                  (sum, p) => sum + (transferAdjustments[p.id]?.amount || 0),
                  0,
                );
                const officeOnly = Math.max(0, totalCommission - totalTransferPortion);
                if (totalCommission <= 0) return null;
                return (
                  <>
                    {officeOnly > 0 && (
                      <span className="text-[9px] text-amber-700 font-semibold ltr-nums mt-0.5">
                        منها ₪{officeOnly.toLocaleString('en-US')} عمولة مكتب
                      </span>
                    )}
                    {totalTransferPortion > 0 && (
                      <span className="text-[9px] text-sky-700 font-semibold ltr-nums">
                        منها ₪{totalTransferPortion.toLocaleString('en-US')} عمولة تحويل
                      </span>
                    )}
                  </>
                );
              })()}
              {/* Broker buy-price line — when this policy/package was
                  brought in by a broker (broker_direction = 'from_broker'),
                  surface what we paid the broker and the resulting profit
                  so staff can see margin at a glance instead of opening
                  the broker page. */}
              {(() => {
                const rowPolicies = (isPkg
                  ? [pkg.mainPolicy, ...pkg.addons].filter(Boolean) as PolicyRecord[]
                  : [policy]
                );
                const buyTotal = rowPolicies.reduce(
                  (sum, p) =>
                    sum +
                    (p.broker_direction === 'from_broker'
                      ? Number(p.broker_buy_price ?? 0)
                      : 0),
                  0,
                );
                if (buyTotal <= 0) return null;
                const sellTotal = rowPolicies.reduce(
                  (sum, p) =>
                    sum +
                    (p.broker_direction === 'from_broker'
                      ? Number(p.insurance_price ?? 0)
                      : 0),
                  0,
                );
                const profit = sellTotal - buyTotal;
                return (
                  <>
                    <span className="text-[9px] text-orange-700 font-semibold ltr-nums mt-0.5">
                      شراء من الوسيط ₪{buyTotal.toLocaleString('en-US')}
                    </span>
                    {profit !== 0 && (
                      <span className={cn(
                        "text-[9px] font-semibold ltr-nums",
                        profit > 0 ? "text-emerald-700" : "text-red-700",
                      )}>
                        {profit > 0 ? "ربح" : "خسارة"} ₪{Math.abs(profit).toLocaleString('en-US')}
                      </span>
                    )}
                  </>
                );
              })()}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Package Components Section - Shows details for each policy in the package */}
        {isPkg && pkg.mainPolicy && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              مكونات الباقة
            </div>
            <div className="rounded-lg border border-border/60 overflow-hidden bg-muted/20">
              {/* Table header — each row is a بوليصة, not a standalone معاملة. */}
              <div className="grid grid-cols-[minmax(80px,auto)_1fr_auto_auto] items-center gap-3 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40 border-b border-border/60">
                <span>رقم البوليصة</span>
                <span>البوليصة</span>
                <span className="text-center min-w-[110px]">المدة</span>
                <span className="text-left min-w-[70px]">السعر</span>
              </div>
              {/* Main policy */}
              <PackageComponentRow
                policy={pkg.mainPolicy}
                isActive={isActive}
                onPoliciesUpdate={onPoliciesUpdate}
                transferPortion={transferAdjustments[pkg.mainPolicy.id]?.amount || 0}
              />
              {/* Addons */}
              {pkg.addons.map((addon) => (
                <PackageComponentRow
                  key={addon.id}
                  policy={addon}
                  isActive={isActive}
                  onPoliciesUpdate={onPoliciesUpdate}
                  transferPortion={transferAdjustments[addon.id]?.amount || 0}
                />
              ))}
              {/* Standalone 'عمولة التحويل' row — aggregated across the
                  whole package. The fee is a transfer-level charge, not
                  tied to any one بوليصة, so we collapse all affected
                  policies into a single row (sum of amounts) with the
                  three transfer notes (customer / office / financial
                  adjustment) rendered underneath — deduped in case the
                  same note was persisted on multiple transfer rows. */}
              {(() => {
                const affected = [pkg.mainPolicy, ...pkg.addons]
                  .filter((p): p is PolicyRecord => !!p)
                  .map(p => transferAdjustments[p.id])
                  .filter((a): a is TransferAdjustment => !!a && a.amount > 0);
                if (affected.length === 0) return null;
                const totalPortion = affected.reduce((s, a) => s + a.amount, 0);
                const dedupe = (vals: (string | null)[]) =>
                  Array.from(new Set(vals.filter((v): v is string => !!v)));
                const customerNotes = dedupe(affected.map(a => a.customerNote));
                const officeNotes = dedupe(affected.map(a => a.officeNote));
                const adjustmentNotes = dedupe(affected.map(a => a.adjustmentNote));
                const hasAnyNote = customerNotes.length + officeNotes.length + adjustmentNotes.length > 0;
                return (
                  <div
                    key="transfer-fee-aggregate"
                    className={cn(
                      "border-b border-border/60 last:border-b-0 transition-colors",
                      "bg-sky-50/60 hover:bg-sky-50 dark:bg-sky-500/5 dark:hover:bg-sky-500/10",
                      !isActive && "opacity-70",
                    )}
                  >
                    <div className="grid grid-cols-[minmax(80px,auto)_1fr_auto] items-center gap-3 px-3 py-2 text-xs">
                      <span className="text-[10px] text-muted-foreground">—</span>
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge className="text-[10px] px-1.5 py-0 h-5 font-medium border shrink-0 bg-sky-100 text-sky-800 border-sky-200 hover:bg-sky-100">
                          عمولة التحويل
                        </Badge>
                      </div>
                      <div className="flex flex-col items-end min-w-[70px]">
                        <span className="font-semibold ltr-nums text-sky-900 dark:text-sky-100">
                          ₪{totalPortion.toLocaleString('en-US')}
                        </span>
                      </div>
                    </div>
                    {hasAnyNote && (
                      <div className="px-3 pb-2 pr-6 text-[11px] text-muted-foreground space-y-0.5">
                        {customerNotes.map((n, i) => (
                          <div key={`c-${i}`} className="flex gap-1.5">
                            <span className="font-semibold text-foreground/80 shrink-0">ملاحظة التحويل:</span>
                            <span className="line-clamp-2">{n}</span>
                          </div>
                        ))}
                        {officeNotes.map((n, i) => (
                          <div key={`o-${i}`} className="flex gap-1.5">
                            <span className="font-semibold text-foreground/80 shrink-0">ملاحظات المكتب:</span>
                            <span className="line-clamp-2">{n}</span>
                          </div>
                        ))}
                        {adjustmentNotes.map((n, i) => (
                          <div key={`a-${i}`} className="flex gap-1.5">
                            <span className="font-semibold text-foreground/80 shrink-0">ملاحظة التعديل المالي:</span>
                            <span className="line-clamp-2">{n}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Totals footer row — non-interactive. The previous
                  click-to-open-details flow was removed at the user's
                  request: the totals are read-only summary info and
                  the dedicated سجل الدفعات tab already provides the
                  detailed breakdown. The wrapper stays a flex row so
                  the layout / hover affordance for the broker banner
                  doesn't change visually. */}
              <div
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 border-t border-border/60",
                  hasBroker
                    ? "justify-start bg-amber-50/60 dark:bg-amber-500/5 text-right"
                    : "justify-end bg-muted/30 text-right",
                )}
                title={hasBroker ? brokerNoteText : undefined}
              >
                {hasBroker ? (
                  <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                    <Handshake className="h-3.5 w-3.5 shrink-0" />
                    <span>{brokerNoteText}</span>
                  </div>
                ) : (
                  <>
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
                    {canSeeFinancials && (
                      <div className="flex flex-col text-xs items-end text-left">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">الربح</span>
                        <span className={cn(
                          "font-bold ltr-nums",
                          paymentStatus.profit > 0 ? "text-emerald-700 dark:text-emerald-400"
                          : paymentStatus.profit < 0 ? "text-red-700 dark:text-red-400"
                          : "text-muted-foreground",
                        )}>
                          ₪{paymentStatus.profit.toLocaleString('en-US')}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            {/* Creator + creation timestamp — "أنشأها: <name> · <date>
                <time>". Name falls back to email-username when
                profiles.full_name is null. Date renders in dd/MM/yyyy
                + HH:mm (en-GB locale) to match the rest of the app.
                Both halves render only when their source is non-null
                so old rows without a creator / created_at degrade
                cleanly. */}
            {(() => {
              const c = pkg.mainPolicy?.creator;
              const who = c?.full_name?.trim() || c?.email?.split('@')[0] || null;
              const when = pkg.mainPolicy?.created_at;
              if (!who && !when) return null;
              const ts = when ? new Date(when) : null;
              return (
                <div className="text-[10px] text-muted-foreground mt-1.5 px-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {who && (
                    <span>أنشأها: <span className="font-medium">{who}</span></span>
                  )}
                  {ts && (
                    <span className="ltr-nums">
                      · {ts.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      <span className="mx-1">·</span>
                      {ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Standalone policy — single-row "المعاملة" section so staff can
            still edit the policy number inline and the paid/remaining
            totals live in the same framed footer the package cards use. */}
        {!isPkg && isActive && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              المعاملة
            </div>
            <div className="rounded-lg border border-border/60 overflow-hidden bg-muted/20 mb-2">
              <div className="grid grid-cols-[minmax(80px,auto)_1fr_auto_auto] items-center gap-3 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40 border-b border-border/60">
                <span>رقم البوليصة</span>
                <span>البوليصة</span>
                <span className="text-center min-w-[110px]">المدة</span>
                <span className="text-left min-w-[70px]">السعر</span>
              </div>
              <PackageComponentRow
                policy={policy}
                isActive={isActive}
                onPoliciesUpdate={onPoliciesUpdate}
              />
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 overflow-hidden">
              {/* Standalone-policy totals footer — non-interactive,
                  same change as the package version. */}
              <div
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2",
                  hasBroker
                    ? "justify-start bg-amber-50/60 dark:bg-amber-500/5 text-right"
                    : "justify-end text-right",
                )}
                title={hasBroker ? brokerNoteText : undefined}
              >
                {hasBroker ? (
                  <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                    <Handshake className="h-3.5 w-3.5 shrink-0" />
                    <span>{brokerNoteText}</span>
                  </div>
                ) : (
                  <>
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
                    {canSeeFinancials && (
                      <div className="flex flex-col text-xs items-end text-left">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">الربح</span>
                        <span className={cn(
                          "font-bold ltr-nums",
                          paymentStatus.profit > 0 ? "text-emerald-700 dark:text-emerald-400"
                          : paymentStatus.profit < 0 ? "text-red-700 dark:text-red-400"
                          : "text-muted-foreground",
                        )}>
                          ₪{paymentStatus.profit.toLocaleString('en-US')}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            {/* Same caption as the package version — creator name with
                email fallback plus the creation date+time. */}
            {(() => {
              const c = policy.creator;
              const who = c?.full_name?.trim() || c?.email?.split('@')[0] || null;
              const when = policy.created_at;
              if (!who && !when) return null;
              const ts = when ? new Date(when) : null;
              return (
                <div className="text-[10px] text-muted-foreground mt-1.5 px-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {who && (
                    <span>أنشأها: <span className="font-medium">{who}</span></span>
                  )}
                  {ts && (
                    <span className="ltr-nums">
                      · {ts.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      <span className="mx-1">·</span>
                      {ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Transfer notes recap — only on transferred-out cards.
            Aggregates the three notes recorded at تحويل time (سبب
            التحويل / ملاحظات المكتب / سبب الفرق) so the agent can
            review the old transaction without opening the target.
            Deduped across siblings so an identical office note set
            on every add-on in a package only renders once. */}
        {(() => {
          const transferredPolicies = isPkg
            ? [pkg.mainPolicy, ...pkg.addons].filter(
                (p): p is PolicyRecord => !!p && !!p.transferred,
              )
            : policy.transferred
              ? [policy]
              : [];
          if (transferredPolicies.length === 0) return null;
          const collected = transferredPolicies
            .map((p) => sourceTransferNotes[p.id])
            .filter((a): a is TransferAdjustment => !!a);
          if (collected.length === 0) return null;
          const dedupe = (vals: (string | null)[]) =>
            Array.from(new Set(vals.filter((v): v is string => !!v)));
          const customerNotes = dedupe(collected.map((a) => a.customerNote));
          const officeNotes = dedupe(collected.map((a) => a.officeNote));
          const adjustmentNotes = dedupe(collected.map((a) => a.adjustmentNote));
          if (
            customerNotes.length + officeNotes.length + adjustmentNotes.length === 0
          ) {
            return null;
          }
          return (
            <div className="mt-3 pt-3 border-t border-border/50 space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <ArrowRightLeft className="h-3 w-3" />
                تفاصيل التحويل
              </p>
              {customerNotes.map((n, i) => (
                <div key={`c-${i}`} className="flex gap-1.5 text-[11px]">
                  <span className="font-semibold text-foreground/80 shrink-0">
                    سبب التحويل:
                  </span>
                  <span className="break-words">{n}</span>
                </div>
              ))}
              {officeNotes.map((n, i) => (
                <div key={`o-${i}`} className="flex gap-1.5 text-[11px]">
                  <span className="font-semibold text-foreground/80 shrink-0">
                    ملاحظات المكتب:
                  </span>
                  <span className="break-words">{n}</span>
                </div>
              ))}
              {adjustmentNotes.map((n, i) => (
                <div key={`a-${i}`} className="flex gap-1.5 text-[11px]">
                  <span className="font-semibold text-foreground/80 shrink-0">
                    سبب الفرق:
                  </span>
                  <span className="break-words">{n}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Notes Section - Inline Edit */}
        <div
          className="mt-3 pt-3 border-t border-border/50"
          onClick={(e) => e.stopPropagation()}
        >
          {isEditingNotes ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">ملاحظات المعاملة</span>
              </div>
              <Textarea
                value={editedNotesValue || ''}
                onChange={(e) => onNotesValueChange?.(e.target.value)}
                placeholder="أدخل ملاحظات المعاملة..."
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

// Single type chip used in the card header. Renders the type label
// inside its colored badge; clicking pulses the matching row in the
// body table. Does NOT carry per-chip index / policy_number stamps —
// each chip represents a بوليصة, not its own معاملة.
function PolicyTypeChip({
  policy,
  onPulse,
  bold = true,
  asButton = true,
}: {
  policy: PolicyRecord;
  onPulse: (e: React.MouseEvent) => void;
  bold?: boolean;
  asButton?: boolean;
}) {
  const label = getDisplayLabel(policy);
  const color = policyTypeColors[policy.policy_type_parent];
  const badgeContent = (
    <Badge
      className={cn(
        "border text-xs cursor-pointer",
        bold && "font-semibold",
        color,
      )}
    >
      {label}
    </Badge>
  );
  if (!asButton) return badgeContent;
  return (
    <button
      type="button"
      onClick={onPulse}
      className="focus:outline-none"
      title="اضغط لإبراز هذه البوليصة في القائمة"
    >
      {badgeContent}
    </button>
  );
}

// Compact row component for package component details
function PackageComponentRow({
  policy,
  isActive,
  onPoliciesUpdate,
  transferPortion = 0,
}: {
  policy: PolicyRecord;
  isActive: boolean;
  onPoliciesUpdate?: () => void;
  /** Slice of office_commission that came from a customer-pays
   *  transfer adjustment. Subtracted from the inline "+ X عمولة"
   *  line here so it can be rendered as its own standalone row
   *  below the policy list. */
  transferPortion?: number;
}) {
  const typeLabel = getDisplayLabel(policy);
  const typeColor = policyTypeColors[policy.policy_type_parent];
  const totalCommission = policy.office_commission || 0;
  const commission = Math.max(0, totalCommission - transferPortion);

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
        "grid grid-cols-[minmax(80px,auto)_1fr_auto_auto] items-center gap-3 px-3 py-2 text-xs border-b border-border/60 last:border-b-0 transition-colors hover:bg-muted/30",
        !isActive && "opacity-70"
      )}
    >
      {/* رقم البوليصة column (inline-editable). */}
      <PolicyNumberInlineEdit
        policyId={policy.id}
        policyNumber={policy.policy_number ?? null}
        onSaved={onPoliciesUpdate}
      />

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
          "truncate text-sm font-medium",
          isActive ? "text-foreground" : "text-muted-foreground"
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

      {/* Coverage period — start → end. Kept compact (font-mono, small)
          so a long provider name in the previous column doesn't force
          the row to wrap. */}
      <div className="flex items-center gap-1.5 min-w-[110px] justify-center text-[10px] font-mono ltr-nums text-muted-foreground whitespace-nowrap">
        <span>{formatDate(policy.end_date)}</span>
        <span aria-hidden="true">←</span>
        <span>{formatDate(policy.start_date)}</span>
      </div>

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

// Card-level رقم المعاملة chip. Read-only — the value comes from
// policies.document_number, which is auto-assigned by a DB trigger
// (format 'NN/YYYY'). Click copies the number to the clipboard so
// staff can paste it elsewhere quickly.
//
// `sequence` is a 1-based position within the current year group so
// staff can say "open #3" without leaning on the doc number; it's
// rendered as a subtle "#N" prefix before the "رقم المعاملة" label.
function CardLevelPolicyNumberChip({ value, sequence }: { value: string; sequence?: number }) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success(`تم نسخ رقم المعاملة: ${value}`))
      .catch(() => toast.error("فشل نسخ رقم المعاملة"));
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      title={`رقم المعاملة: ${value} — اضغط للنسخ`}
      data-doc-number={value}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/15 hover:border-emerald-500/50 transition-colors"
    >
      {sequence !== undefined && (
        <span className="font-mono ltr-nums font-bold text-emerald-600/80">#{sequence}</span>
      )}
      <span>رقم المعاملة :</span>
      <span className="font-mono ltr-nums font-semibold tracking-tight">{value}</span>
    </button>
  );
}

// Inline editor for a policy's issued number. Shows the number as a
// clickable chip; clicking swaps to a compact input that commits on
// Enter/blur and rolls back on Escape. When no number exists yet, a
// pale "+ رقم" affordance invites the user to add one.
function PolicyNumberInlineEdit({
  policyId,
  policyNumber,
  onSaved,
}: {
  policyId: string;
  policyNumber: string | null;
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // `displayValue` is what we render in the non-editing chip. It starts
  // from the prop, absorbs the user's saved value after commit, and only
  // snaps back to the prop when the prop itself actually changes. This
  // stops the chip from flashing the pre-save value during the commit
  // → setEditing(false) round-trip (no parent refetch needed).
  const [displayValue, setDisplayValue] = useState(policyNumber ?? "");
  const [value, setValue] = useState(policyNumber ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayValue(policyNumber ?? "");
    if (!editing) setValue(policyNumber ?? "");
    // Deliberately omit `editing` — we only want to sync from the prop
    // when the prop itself changes, not when the edit state flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyNumber]);

  const beginEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setValue(displayValue);
    setEditing(true);
  };

  const commit = async () => {
    const next = value.trim();
    const prev = displayValue;
    if (next === prev) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("policies")
      .update({ policy_number: next || null })
      .eq("id", policyId);
    setSaving(false);
    setEditing(false);
    if (error) {
      toast.error("فشل حفظ رقم البوليصة");
      setValue(prev);
      return;
    }
    // Reflect the new value locally. We deliberately do NOT call
    // onSaved here — the user asked for "write and save and that's
    // it", no parent refetch / card refresh after a number edit. The
    // prop can still drive a later sync if something else refreshes
    // the card.
    setDisplayValue(next);
    toast.success(next ? "تم حفظ رقم البوليصة" : "تم مسح رقم البوليصة");
  };

  if (editing) {
    return (
      <input
        autoFocus
        disabled={saving}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setValue(displayValue);
            setEditing(false);
          }
        }}
        placeholder="36/2026"
        className="w-[90px] h-6 rounded border border-primary/40 bg-background px-1.5 text-[11px] font-mono ltr-nums focus:outline-none focus:ring-1 focus:ring-primary"
      />
    );
  }

  if (displayValue) {
    return (
      <button
        type="button"
        onClick={beginEdit}
        title="اضغط لتعديل رقم البوليصة"
        className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold ltr-nums text-foreground bg-background border border-border/60 rounded px-1.5 h-6 hover:border-primary/40 transition-colors"
      >
        <Hash className="h-2.5 w-2.5 text-muted-foreground" />
        {displayValue}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={beginEdit}
      title="إضافة رقم البوليصة"
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary border border-dashed border-border/60 hover:border-primary/40 rounded px-1.5 h-6 transition-colors"
    >
      <Pencil className="h-2.5 w-2.5" />
      رقم
    </button>
  );
}
