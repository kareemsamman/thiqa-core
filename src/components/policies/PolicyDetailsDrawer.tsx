import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import {
  User,
  Car,
  Building2,
  Pencil,
  CreditCard,
  Phone,
  Banknote,
  ImageIcon,
  FileText,
  Calendar,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Send,
  Loader2,
  Package,
  ArrowLeftRight,
  History,
  Shield,
  TrendingUp,
  ChevronLeft,
  CircleDollarSign,
  Truck,
  FileCheck,
  MapPin,
  Hash,
  Palette,
  DollarSign,
  Layers,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PolicyEditDrawer } from "./PolicyEditDrawer";
import { PolicyPaymentsSection } from "./PolicyPaymentsSection";
import { PolicyFilesSection } from "./PolicyFilesSection";
import { PackageComponentsTable } from "./PackageComponentsTable";
import { PackagePolicyEditModal } from "./PackagePolicyEditModal";

import { CancelPolicyModal } from "./CancelPolicyModal";
import { TransferPolicyModal } from "./TransferPolicyModal";
import { recalculatePolicyProfit } from "@/lib/pricingCalculator";
import { RefreshCw } from "lucide-react";

interface PolicyDetailsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string | null;
  onUpdated?: () => void;
  onViewRelatedPolicy?: (policyId: string) => void;
}

interface PolicyDetails {
  id: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  policy_number: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  payed_for_company: number | null;
  profit: number | null;
  office_commission: number | null;
  cancelled: boolean | null;
  transferred: boolean | null;
  transferred_car_number: string | null;
  is_under_24: boolean | null;
  notes: string | null;
  cancellation_note: string | null;
  cancellation_date: string | null;
  legacy_wp_id: number | null;
  created_at: string;
  updated_at: string;
  broker_id: string | null;
  created_by_admin_id: string | null;
  group_id: string | null;
  road_service_id: string | null;
  branch_id: string | null;
  clients: {
    id: string;
    full_name: string;
    phone_number: string | null;
    file_number: string | null;
    id_number: string;
    less_than_24: boolean | null;
    signature_url: string | null;
    under24_type?: 'none' | 'client' | 'additional_driver' | null;
    under24_driver_name?: string | null;
    under24_driver_id?: string | null;
  };
  cars: {
    id: string;
    car_number: string;
    manufacturer_name: string | null;
    year: number | null;
    car_type: string | null;
    car_value: number | null;
    model: string | null;
    color: string | null;
  } | null;
  insurance_companies: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  brokers?: {
    id: string;
    name: string;
  } | null;
  road_services?: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  accident_fee_services?: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
}

interface RelatedPolicy {
  id: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  insurance_price: number;
  office_commission: number | null;
  profit: number | null;
  road_service_id: string | null;
  accident_fee_service_id: string | null;
  insurance_companies: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  road_services: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  accident_fee_services: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
}

interface PaymentImage {
  id: string;
  image_url: string;
  image_type: string;
}

interface Payment {
  id: string;
  amount: number;
  payment_type: string;
  payment_date: string;
  cheque_number: string | null;
  cheque_image_url: string | null;
  cheque_status: string | null;
  refused: boolean | null;
  notes: string | null;
  images?: PaymentImage[];
}

const policyTypeLabels: Record<string, string> = {
  ELZAMI: "إلزامي",
  THIRD_FULL: "ثالث/شامل",
  ROAD_SERVICE: "خدمات الطريق",
  ACCIDENT_FEE_EXEMPTION: "إعفاء رسوم حادث",
};

const policyChildLabels: Record<string, string> = {
  THIRD: "طرف ثالث",
  FULL: "شامل",
};

// Use system primary colors for consistency with Thiqa theme
const policyTypeConfig: Record<string, { icon: React.ElementType; gradient: string; bg: string; border: string; text: string }> = {
  ELZAMI: {
    icon: Shield,
    gradient: "from-primary to-primary/80",
    bg: "bg-primary/5",
    border: "border-primary/20",
    text: "text-primary"
  },
  THIRD_FULL: {
    icon: Car,
    gradient: "from-primary/90 to-primary",
    bg: "bg-primary/5",
    border: "border-primary/20",
    text: "text-primary"
  },
  ROAD_SERVICE: {
    icon: Truck,
    gradient: "from-primary to-primary/70",
    bg: "bg-primary/5",
    border: "border-primary/20",
    text: "text-primary"
  },
  ACCIDENT_FEE_EXEMPTION: {
    icon: FileCheck,
    gradient: "from-primary/80 to-primary",
    bg: "bg-primary/5",
    border: "border-primary/20",
    text: "text-primary"
  },
};

const carTypeLabels: Record<string, string> = {
  car: "خصوصي",
  cargo: "شحن",
  small: "اوتوبس زعير",
  taxi: "تاكسي",
  tjeradown4: "تجاري (أقل من 4 طن)",
  tjeraup4: "تجاري (أكثر من 4 طن)",
};

// Section component for consistent styling
const Section = ({ title, icon: Icon, children, className }: { 
  title: string; 
  icon: React.ElementType; 
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("space-y-3", className)}>
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <h3 className="font-bold text-foreground">{title}</h3>
    </div>
    {children}
  </div>
);

export function PolicyDetailsDrawer({ open, onOpenChange, policyId, onUpdated, onViewRelatedPolicy }: PolicyDetailsDrawerProps) {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [policy, setPolicy] = useState<PolicyDetails | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'main' | 'payments' | 'files'>('main');
  const [showQuickPayment, setShowQuickPayment] = useState(false);
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [sendingSignatureSms, setSendingSignatureSms] = useState(false);
  const [relatedPolicies, setRelatedPolicies] = useState<RelatedPolicy[]>([]);
  const [transferHistory, setTransferHistory] = useState<any[]>([]);
  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [policyFilesCount, setPolicyFilesCount] = useState<number>(0);
  const [sendingPolicySms, setSendingPolicySms] = useState(false);
  const [packageTotalPaid, setPackageTotalPaid] = useState<number>(0);
  const [policyChildren, setPolicyChildren] = useState<{ id: string; child: { id: string; full_name: string; id_number: string; relation: string | null; phone: string | null } | null }[]>([]);
  const [packagePayments, setPackagePayments] = useState<Payment[]>([]);
  const [packageEditGroupId, setPackageEditGroupId] = useState<string | null>(null);
  const [syncStatuses, setSyncStatuses] = useState<Record<string, 'success' | 'failed' | 'pending' | null>>({});

  const handleSendSignatureSms = async () => {
    if (!policy || !policy.clients.phone_number) {
      toast({ title: "خطأ", description: "رقم هاتف العميل مطلوب", variant: "destructive" });
      return;
    }

    setSendingSignatureSms(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-signature-sms", {
        body: { 
          client_id: policy.clients.id,
          policy_id: policy.id 
        },
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(data.error);
      }

      toast({ 
        title: "تم الإرسال", 
        description: "تم إرسال رابط التوقيع للعميل بنجاح" 
      });
    } catch (error: any) {
      console.error("Error sending signature SMS:", error);
      const description = await extractFunctionErrorMessage(error);
      toast({
        title: "خطأ",
        description: description || "فشل في إرسال طلب التوقيع",
        variant: "destructive"
      });
    } finally {
      setSendingSignatureSms(false);
    }
  };

  const handleSendPolicySms = async () => {
    if (!policy || !policy.clients.phone_number) {
      toast({ title: "خطأ", description: "رقم هاتف العميل مطلوب", variant: "destructive" });
      return;
    }

    setSendingPolicySms(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-invoice-sms", {
        body: { 
          policy_id: policy.id,
          phone_number: policy.clients.phone_number,
          client_name: policy.clients.full_name,
          force_resend: true  // Always allow resend from drawer
        },
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(data.error);
      }

      toast({ 
        title: "تم الإرسال", 
        description: "تم إرسال ملفات الوثيقة للعميل بنجاح" 
      });
    } catch (error: any) {
      console.error("Error sending policy SMS:", error);
      const description = await extractFunctionErrorMessage(error);
      toast({
        title: "خطأ",
        description: description || "فشل في إرسال الملفات",
        variant: "destructive"
      });
    } finally {
      setSendingPolicySms(false);
    }
  };

  const fetchPolicyDetails = async () => {
    if (!policyId) return;

    // Always fetch fresh data from database - no caching
    setLoading(true);
    setCreatorName(null);
    try {
      const { data: policyData, error: policyError } = await supabase
        .from("policies")
        .select(
          `
          *,
          clients!inner(id, full_name, phone_number, file_number, id_number, less_than_24, signature_url, under24_type, under24_driver_name, under24_driver_id),
          cars(id, car_number, manufacturer_name, year, car_type, car_value, model, color),
          insurance_companies(id, name, name_ar),
          brokers(id, name),
          road_services(id, name, name_ar),
          accident_fee_services(id, name, name_ar)
        `,
        )
        .eq("id", policyId)
        .single();

      if (policyError) throw policyError;
      setPolicy(policyData as PolicyDetails);

      // Fetch related policies if part of a group
      let relatedData: RelatedPolicy[] = [];
      if (policyData.group_id) {
        const { data: fetchedRelated } = await supabase
          .from("policies")
          .select("id, policy_type_parent, policy_type_child, insurance_price, office_commission, profit, road_service_id, accident_fee_service_id, insurance_companies(id, name, name_ar), road_services(id, name, name_ar), accident_fee_services(id, name, name_ar)")
          .eq("group_id", policyData.group_id)
          .neq("id", policyId)
          .is("deleted_at", null);
        
        if (fetchedRelated) {
          relatedData = fetchedRelated as RelatedPolicy[];
          setRelatedPolicies(relatedData);
        }
      } else {
        setRelatedPolicies([]);
      }

      // Fetch transfer history
      const { data: transfersData } = await supabase
        .from("policy_transfers")
        .select(`
          id,
          from_car_id,
          to_car_id,
          transfer_date,
          note,
          adjustment_type,
          adjustment_amount,
          created_at,
          from_car:cars!policy_transfers_from_car_id_fkey(car_number, model, year),
          to_car:cars!policy_transfers_to_car_id_fkey(car_number, model, year)
        `)
        .eq("policy_id", policyId)
        .order("created_at", { ascending: false });

      setTransferHistory(transfersData || []);

      // Fetch creator name via safe directory function
      if (policyData.created_by_admin_id) {
        const { data: creatorData } = await supabase.rpc("user_directory_get_by_ids", {
          p_ids: [policyData.created_by_admin_id],
        });
        if (creatorData && creatorData.length > 0) {
          setCreatorName(creatorData[0].display_name);
        }
      }

      const { data: paymentsData, error: paymentsError } = await supabase
        .from("policy_payments")
        .select("*")
        .eq("policy_id", policyId)
        .order("payment_date", { ascending: false });

      if (paymentsError) throw paymentsError;
      
      // Fetch payment images for all payments
      let finalPayments: Payment[] = [];
      if (paymentsData && paymentsData.length > 0) {
        const paymentIds = paymentsData.map(p => p.id);
        const { data: imagesData } = await supabase
          .from("payment_images")
          .select("*")
          .in("payment_id", paymentIds)
          .order("sort_order", { ascending: true });

        // Attach images to payments
        finalPayments = paymentsData.map(payment => ({
          ...payment,
          images: imagesData?.filter(img => img.payment_id === payment.id) || []
        }));
        
        setPayments(finalPayments);
      } else {
        setPayments([]);
      }

      // For packages, fetch ALL payments across all policies in the group
      let pkgTotalPaid = 0;
      let allPkgPayments: Payment[] = [];
      if (policyData.group_id) {
        // Get all policy IDs in this package
        const allPackagePolicyIds = [policyId, ...relatedData.map(rp => rp.id)];
        
        // Fetch all payments for the entire package with full data
        const { data: allPackagePayments } = await supabase
          .from("policy_payments")
          .select("*")
          .in("policy_id", allPackagePolicyIds)
          .order("payment_date", { ascending: false });
        
        if (allPackagePayments) {
          pkgTotalPaid = allPackagePayments
            .filter(p => !p.refused && p.cheque_status !== 'returned')
            .reduce((sum, p) => sum + p.amount, 0);
          
          // Fetch payment images for all package payments
          const paymentIds = allPackagePayments.map(p => p.id);
          const { data: imagesData } = await supabase
            .from("payment_images")
            .select("*")
            .in("payment_id", paymentIds)
            .order("sort_order", { ascending: true });

          allPkgPayments = allPackagePayments.map(payment => ({
            ...payment,
            images: imagesData?.filter(img => img.payment_id === payment.id) || []
          }));
        }
        setPackageTotalPaid(pkgTotalPaid);
        setPackagePayments(allPkgPayments);
      } else {
        // For single policies, package total paid = this policy's paid
        const singlePaid = paymentsData?.filter((p: any) => !p.refused && p.cheque_status !== 'returned').reduce((sum: number, p: any) => sum + p.amount, 0) || 0;
        setPackageTotalPaid(singlePaid);
        setPackagePayments([]);
      }
      
      // Fetch refund amount for cancelled policies
      let refund = 0;
      if (policyData.cancelled) {
        const { data: refundData } = await supabase
          .from("customer_wallet_transactions")
          .select("amount")
          .eq("policy_id", policyId)
          .eq("transaction_type", "refund")
          .single();
        
        refund = refundData?.amount || 0;
        setRefundAmount(refund);
      } else {
        setRefundAmount(0);
      }

      // Fetch policy files count - check both policy_file and policy_insurance types
      // Also check related policies if it's a package (for package SMS capability)
      let totalFilesCount = 0;
      const allPolicyIdsToCheck = policyData.group_id ? [policyId, ...relatedData.map(rp => rp.id)] : [policyId];
      
      const { count: filesCount } = await supabase
        .from("media_files")
        .select("*", { count: "exact", head: true })
        .in("entity_id", allPolicyIdsToCheck)
        .in("entity_type", ["policy", "policy_insurance", "policy_file"])
        .is("deleted_at", null);
      
      totalFilesCount = filesCount || 0;
      setPolicyFilesCount(totalFilesCount);

      // Fetch policy children (additional drivers) from ALL policies in the package
      const policyIdsForChildren = policyData.group_id 
        ? [policyId, ...relatedData.map(rp => rp.id)]
        : [policyId];
      
      const { data: childrenData } = await supabase
        .from("policy_children")
        .select(`
          id,
          child:client_children(
            id, full_name, id_number, relation, phone
          )
        `)
        .in("policy_id", policyIdsForChildren);
      
      setPolicyChildren(childrenData || []);

      if (policyData.group_id) {
        setSyncStatuses({});
      }

    } catch (error) {
      console.error("Error fetching policy details:", error);
      toast({ title: "خطأ", description: "فشل في تحميل تفاصيل الوثيقة", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && policyId) {
      fetchPolicyDetails();
      setActiveSection('main');
      setShowQuickPayment(false);
    }
  }, [open, policyId]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("ar-EG");
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return "₪0";
    const isNegative = amount < 0;
    const absAmount = Math.abs(amount);
    return `${isNegative ? '-' : ''}₪${absAmount.toLocaleString("ar-EG", { maximumFractionDigits: 0 })}`;
  };

  const getStatus = () => {
    if (!policy) return { label: "-", variant: "secondary" as const, icon: Clock };
    if (policy.cancelled) return { label: "ملغاة", variant: "destructive" as const, icon: XCircle };
    if (policy.transferred) return { label: "محوّلة", variant: "warning" as const, icon: ArrowLeftRight };
    const today = new Date();
    const endDate = new Date(policy.end_date);
    if (endDate < today) return { label: "منتهية", variant: "destructive" as const, icon: XCircle };
    return { label: "نشطة", variant: "success" as const, icon: CheckCircle2 };
  };

  const getRemainingDays = () => {
    if (!policy) return 0;
    const today = new Date();
    const endDate = new Date(policy.end_date);
    const diff = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  // Payment calculations - for transferred policies, show 0 paid/remaining (payments moved to new policy)
  const isTransferred = policy?.transferred === true;
  
  // Calculate package totals first (needed for distributed payment calculation)
  const hasPackage = relatedPolicies.length > 0;
  const packageTotalPrice = hasPackage 
    ? (policy?.insurance_price || 0) + (policy?.office_commission || 0) + relatedPolicies.reduce((sum, rp) => sum + rp.insurance_price + (rp.office_commission || 0), 0)
    : 0;
  const packageTotalProfit = hasPackage 
    ? (policy?.profit || 0) + relatedPolicies.reduce((sum, rp) => sum + (rp.profit || 0), 0)
    : 0;

  // For packages, show unified totals. For single policies, use direct payments
  const calculatePaymentTotals = () => {
    if (!policy || isTransferred) return { paid: 0, remaining: 0, percentage: 100, status: 'paid' as const };
    
    if (hasPackage) {
      // Package: show unified totals
      const paid = packageTotalPaid;
      const price = packageTotalPrice;
      const rem = Math.max(0, price - paid);
      const pct = Math.min(100, Math.round((paid / price) * 100));
      const status = rem <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
      return { paid, remaining: rem, percentage: pct, status };
    }

    // Single policy - use direct payments
    const paid = payments.filter((p) => !p.refused && p.cheque_status !== 'returned').reduce((sum, p) => sum + p.amount, 0);
    const effectivePrice = policy.insurance_price + (policy.office_commission || 0);
    const rem = effectivePrice - paid;
    const pct = Math.min(100, Math.round((paid / effectivePrice) * 100));
    const status = rem <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    return { paid, remaining: rem, percentage: pct, status };
  };

  const paymentTotals = calculatePaymentTotals();
  const totalPaid = paymentTotals.paid;
  const remaining = paymentTotals.remaining;
  const percentagePaid = paymentTotals.percentage;
  const paymentStatus = paymentTotals.status;

  // Returned cheques calculation
  const returnedCheques = isTransferred ? [] : payments.filter((p) => p.payment_type === 'cheque' && (p.refused || p.cheque_status === 'returned'));
  const returnedChequesTotal = returnedCheques.reduce((sum, p) => sum + p.amount, 0);
  const hasReturnedCheques = returnedCheques.length > 0;

  // Check if ELZAMI (no profit)
  const isElzami = policy?.policy_type_parent === "ELZAMI";

  const handleEditComplete = () => {
    fetchPolicyDetails();
    onUpdated?.();
  };

  const handlePaymentsChange = () => {
    // Clear cache to force fresh fetch
    if (policyId) {
      sessionStorage.removeItem(`policy_cache_${policyId}`);
    }
    // Small delay to ensure database commit before refetch
    setTimeout(() => {
      fetchPolicyDetails();
    }, 150);
    // Notify parent to refresh wallet/summary/policies
    onUpdated?.();
  };

  const status = getStatus();
  const remainingDays = getRemainingDays();
  const StatusIcon = status.icon;
  const policyConfig = policyTypeConfig[policy?.policy_type_parent || 'ELZAMI'] || policyTypeConfig.ELZAMI;
  const PolicyIcon = policyConfig.icon;

  // Get display name for policy type with child
  const getPolicyTypeName = () => {
    if (!policy) return "";
    if (policy.policy_type_parent === 'THIRD_FULL' && policy.policy_type_child) {
      return policyChildLabels[policy.policy_type_child] || policy.policy_type_child;
    }
    return policyTypeLabels[policy.policy_type_parent] || policy.policy_type_parent;
  };

  // Get service name for display
  const getServiceName = (rp: RelatedPolicy) => {
    if (rp.policy_type_parent === 'ROAD_SERVICE' && rp.road_services) {
      return rp.road_services.name_ar || rp.road_services.name;
    }
    if (rp.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION' && rp.accident_fee_services) {
      return rp.accident_fee_services.name_ar || rp.accident_fee_services.name;
    }
    if (rp.policy_type_parent === 'THIRD_FULL' && rp.policy_type_child) {
      return policyChildLabels[rp.policy_type_child] || rp.policy_type_child;
    }
    return null;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-6xl max-h-[95vh] p-0 overflow-hidden gap-0"
          dir="rtl"
        >
          {loading ? (
            <div className="p-8 space-y-6">
              <Skeleton className="h-24 w-full rounded-xl" />
              <div className="grid grid-cols-4 gap-4">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
              <Skeleton className="h-40 w-full" />
            </div>
          ) : policy ? (
            <div className="flex flex-col h-full max-h-[95vh]">
              {/* Hero Header */}
              <div className="relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #122143 0%, #1a3260 100%)' }}
              >
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-10">
                  <div className="absolute top-0 left-0 w-32 h-32 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
                  <div className="absolute bottom-0 right-0 w-48 h-48 bg-white rounded-full translate-x-1/4 translate-y-1/4" />
                </div>
                
                <div className="relative px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    {/* Right side - Policy Type & Title */}
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <PolicyIcon className="h-7 w-7 text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h1 className="text-xl font-bold text-white">
                            {hasPackage ? "باقة تأمين" : getPolicyTypeName()}
                          </h1>
                          <Badge className={cn(
                            "border-white/30 font-medium",
                            status.variant === 'success' ? "bg-white/20 text-white" :
                            status.variant === 'destructive' ? "bg-red-100 text-red-700" :
                            status.variant === 'warning' ? "bg-amber-100 text-amber-700" :
                            "bg-white/20 text-white"
                          )}>
                            <StatusIcon className="h-3 w-3 ml-1" />
                            {status.label}
                          </Badge>
                          {hasPackage && (
                            <Badge className="bg-white/20 border-white/30 text-white font-medium">
                              <Layers className="h-3 w-3 ml-1" />
                              {relatedPolicies.length + 1} وثائق
                            </Badge>
                          )}
                        </div>
                        
                        {/* Service name for Road Service (only for single policies) */}
                        {!hasPackage && policy.policy_type_parent === 'ROAD_SERVICE' && policy.road_services && (
                          <p className="text-white/80 text-sm">
                            {policy.road_services.name_ar || policy.road_services.name}
                          </p>
                        )}
                        
                        {/* Client & Car Info */}
                        <div className="flex items-center gap-4 mt-2 text-white/80 text-sm">
                          <div className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            <span>{policy.clients.full_name}</span>
                          </div>
                          {policy.cars && (
                            <div className="flex items-center gap-1">
                              <Car className="h-3.5 w-3.5" />
                              <span className="font-mono"><bdi>{policy.cars.car_number}</bdi></span>
                            </div>
                          )}
                          {policy.insurance_companies && (
                            <div className="flex items-center gap-1">
                              <Building2 className="h-3.5 w-3.5" />
                              <span>{policy.insurance_companies.name_ar || policy.insurance_companies.name}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Left side - Actions - with spacing from close button */}
                    <div className="flex gap-2 ml-14">
                      {/* SMS Button - only show if there are files */}
                      {policyFilesCount > 0 && policy.clients.phone_number && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={handleSendPolicySms}
                          disabled={sendingPolicySms}
                          className="gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0"
                        >
                          {sendingPolicySms ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          SMS
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          if (hasPackage && policy.group_id) {
                            setPackageEditGroupId(policy.group_id);
                          } else {
                            setEditOpen(true);
                          }
                        }}
                        className="gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        تعديل
                      </Button>
                      {!policy.cancelled && !policy.transferred && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setTransferOpen(true)}
                            className="gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0"
                          >
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                            تحويل
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setCancelOpen(true)}
                            className="gap-1.5 bg-red-500/80 hover:bg-red-500 text-white border-0"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            إلغاء
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Navigation Pills */}
              <div className="px-6 py-3 border-b bg-muted/30 flex gap-2">
                <button
                  onClick={() => setActiveSection('main')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                    activeSection === 'main' 
                      ? "bg-primary text-primary-foreground shadow-sm" 
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <Shield className="h-4 w-4 inline-block ml-1.5" />
                  معلومات الوثيقة
                </button>
                <button
                  onClick={() => setActiveSection('payments')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5",
                    activeSection === 'payments' 
                      ? "bg-primary text-primary-foreground shadow-sm" 
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <CreditCard className="h-4 w-4" />
                  الدفعات
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-full text-xs",
                    activeSection === 'payments' ? "bg-white/20" : "bg-muted-foreground/20"
                  )}>
                    {hasPackage ? packagePayments.length : payments.length}
                  </span>
                </button>
                <button
                  onClick={() => setActiveSection('files')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium transition-all",
                    activeSection === 'files' 
                      ? "bg-primary text-primary-foreground shadow-sm" 
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <ImageIcon className="h-4 w-4 inline-block ml-1.5" />
                  الملفات
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-full text-xs mr-1.5",
                    activeSection === 'files' ? "bg-white/20" : "bg-muted-foreground/20"
                  )}>
                    {policyFilesCount}
                  </span>
                </button>
              </div>

              {/* Content Area */}
              <ScrollArea className="flex-1">
                {activeSection === 'main' && (
                  <div className="p-6 space-y-6">
                    {/* Signature Warning */}
                    {!policy.clients.signature_url && (
                      <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                        <span className="text-amber-800 text-sm font-medium">العميل لم يوقّع بعد</span>
                        <Button 
                          size="sm" 
                          variant="outline"
                          className="mr-auto border-amber-300 text-amber-700 hover:bg-amber-100"
                          onClick={handleSendSignatureSms}
                          disabled={sendingSignatureSms}
                        >
                          {sendingSignatureSms ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" />
                          ) : (
                            <Send className="h-3.5 w-3.5 ml-1" />
                          )}
                          إرسال طلب توقيع
                        </Button>
                      </div>
                    )}

                    {/* Financial Cards Grid */}
                    <div className="grid grid-cols-4 gap-3">
                      {/* Insurance Price */}
                      <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 border border-slate-200">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center">
                            <CircleDollarSign className="h-4 w-4 text-slate-600" />
                          </div>
                          <span className="text-xs font-medium text-slate-600">
                            {hasPackage ? "سعر الباقة" : "سعر التأمين"}
                          </span>
                        </div>
                        <p className="text-2xl font-bold text-slate-900 ltr-nums">
                          {formatCurrency(hasPackage ? packageTotalPrice : (policy.insurance_price + (policy.office_commission || 0)))}
                        </p>
                        {!hasPackage && (policy.office_commission || 0) > 0 && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            {formatCurrency(policy.insurance_price)} تأمين + {formatCurrency(policy.office_commission)} عمولة مكتب
                          </p>
                        )}
                      </div>

                      {/* Paid Amount */}
                      <div className={cn(
                        "rounded-xl p-4 border",
                        paymentStatus === 'paid' 
                          ? "bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20" 
                          : "bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200"
                      )}>
                        <div className="flex items-center gap-2 mb-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center",
                            paymentStatus === 'paid' ? "bg-primary/20" : "bg-slate-200"
                          )}>
                            <CreditCard className={cn("h-4 w-4", paymentStatus === 'paid' ? "text-primary" : "text-slate-600")} />
                          </div>
                          <span className={cn("text-xs font-medium", paymentStatus === 'paid' ? "text-primary" : "text-slate-600")}>
                            المدفوع
                          </span>
                        </div>
                        <p className={cn(
                          "text-2xl font-bold ltr-nums",
                          paymentStatus === 'paid' ? "text-primary" : "text-slate-900"
                        )}>
                          {formatCurrency(totalPaid)}
                        </p>
                      </div>

                      {/* Remaining */}
                      <div className={cn(
                        "rounded-xl p-4 border",
                        remaining > 0 ? "bg-gradient-to-br from-red-50 to-red-100 border-red-200" :
                        remaining < 0 ? "bg-gradient-to-br from-red-50 to-red-100 border-red-200" :
                        "bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20"
                      )}>
                        <div className="flex items-center gap-2 mb-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center",
                            remaining !== 0 ? "bg-red-200" : "bg-primary/20"
                          )}>
                            <Banknote className={cn("h-4 w-4", remaining !== 0 ? "text-red-600" : "text-primary")} />
                          </div>
                          <span className={cn("text-xs font-medium", remaining !== 0 ? "text-red-600" : "text-primary")}>
                            المتبقي
                          </span>
                        </div>
                        <p className={cn(
                          "text-2xl font-bold ltr-nums",
                          remaining !== 0 ? "text-red-700" : "text-primary"
                        )}>
                          {formatCurrency(remaining)}
                        </p>
                        {remaining < 0 && (
                          <span className="text-xs text-red-600">رصيد زائد</span>
                        )}
                      </div>

                      {/* Remaining Days */}
                      <div className="rounded-xl p-4 border bg-gradient-to-br from-slate-50 to-slate-100 border-slate-200">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center">
                            <Clock className="h-4 w-4 text-slate-600" />
                          </div>
                          <span className="text-xs font-medium text-slate-600">المتبقي</span>
                        </div>
                        <p className={cn(
                          "text-2xl font-bold",
                          remainingDays < 0 ? "text-red-600" :
                          remainingDays <= 30 ? "text-amber-600" : "text-slate-900"
                        )}>
                          {remainingDays < 0 ? 'منتهية' : `${remainingDays} يوم`}
                        </p>
                      </div>
                    </div>

                    {/* Profit Card - Enhanced styling for admin */}
                    {!isElzami && isAdmin && (
                      <div className={cn(
                        "rounded-xl p-4 border-2",
                        (policy.cancelled || isTransferred)
                          ? "bg-slate-50 border-slate-200"
                          : (policy.profit || 0) < 0
                            ? "bg-red-50 border-red-300"
                            : "border-[#122143]/20"
                      )} style={!(policy.cancelled || isTransferred) && (policy.profit || 0) >= 0 ? { background: 'linear-gradient(135deg, rgba(18,33,67,0.05) 0%, rgba(18,33,67,0.10) 100%)' } : undefined}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-12 h-12 rounded-xl flex items-center justify-center",
                              (policy.cancelled || isTransferred)
                                ? "bg-slate-200"
                                : (policy.profit || 0) < 0
                                  ? "bg-red-200"
                                  : ""
                            )} style={!(policy.cancelled || isTransferred) && (policy.profit || 0) >= 0 ? { background: '#122143' } : undefined}>
                              <TrendingUp className={cn(
                                "h-6 w-6",
                                (policy.cancelled || isTransferred) ? "text-slate-500" : "text-white"
                              )} />
                            </div>
                            <div>
                              <span className={cn(
                                "text-sm font-medium",
                                (policy.cancelled || isTransferred) 
                                  ? "text-slate-500" 
                                  : (packageTotalProfit) < 0
                                    ? "text-red-600"
                                    : "text-[#122143]"
                              )}>
                                {(packageTotalProfit) < 0 
                                  ? 'عمولة (خسارة)' 
                                  : hasPackage 
                                    ? 'إجمالي ربح الباقة' 
                                    : 'الربح من الوثيقة'}
                              </span>
                              {(policy.cancelled || isTransferred) && (
                                <p className="text-xs text-slate-400">ملغاة/محوّلة</p>
                              )}
                            </div>
                          </div>
                          <p className={cn(
                            "text-3xl font-bold ltr-nums",
                            (policy.cancelled || isTransferred) 
                              ? "text-slate-400 line-through" 
                              : (packageTotalProfit) < 0
                                ? "text-red-600"
                                : "text-[#122143]"
                          )}>
                            {(policy.cancelled || isTransferred) ? formatCurrency(0) : formatCurrency(packageTotalProfit)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Payment Progress */}
                    <div className="bg-muted/30 rounded-xl p-4 border">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium">حالة الدفع</span>
                        <Badge
                          variant={
                            paymentStatus === "paid" ? "success" : paymentStatus === "partial" ? "warning" : "destructive"
                          }
                        >
                          {paymentStatus === "paid"
                            ? "مدفوع بالكامل"
                            : paymentStatus === "partial"
                              ? `مدفوع ${percentagePaid}%`
                              : "غير مدفوع"}
                        </Badge>
                      </div>
                      <Progress value={percentagePaid} className="h-3" />
                    </div>

                    {/* Returned Cheques Warning */}
                    {hasReturnedCheques && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                            <AlertTriangle className="h-5 w-5 text-red-600" />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-red-800">شيكات مرتجعة ({returnedCheques.length})</p>
                            <p className="text-xs text-red-600">هذا المبلغ مخصوم من رصيد العميل</p>
                          </div>
                          <p className="text-xl font-bold text-red-700 ltr-nums">
                            {formatCurrency(returnedChequesTotal)}-
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Cancellation Info */}
                    {policy.cancelled && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                            <XCircle className="h-5 w-5 text-red-600" />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-red-800">وثيقة ملغاة</p>
                            {policy.cancellation_date && (
                              <p className="text-xs text-red-600">{formatDate(policy.cancellation_date)}</p>
                            )}
                            {policy.cancellation_note && (
                              <p className="text-sm text-red-700 mt-1">{policy.cancellation_note}</p>
                            )}
                          </div>
                          {refundAmount > 0 && (
                            <div className="text-left">
                              <p className="text-xs text-red-600">مرتجع للعميل</p>
                              <p className="text-lg font-bold text-red-700 ltr-nums">{formatCurrency(refundAmount)}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Transferred Info */}
                    {isTransferred && !policy.cancelled && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                            <ArrowLeftRight className="h-5 w-5 text-amber-600" />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-amber-800">وثيقة محوّلة</p>
                            <p className="text-xs text-amber-600">الدفعات والملفات تم نقلها للوثيقة الجديدة</p>
                          </div>
                          {policy.transferred_car_number && (
                            <Badge className="bg-amber-100 text-amber-700 border-amber-300">
                              إلى: {policy.transferred_car_number}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Policy Details - Company & Period (after prices, before package) */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Insurance Company */}
                      {(policy.insurance_companies || policy.brokers) && (
                        <Section title="شركة التأمين" icon={Building2}>
                          <div className="bg-muted/30 rounded-xl p-4 border">
                            <p className="text-lg font-bold">
                              {policy.insurance_companies?.name_ar || policy.insurance_companies?.name || policy.brokers?.name}
                            </p>
                            {policy.insurance_companies && policy.brokers && (
                              <p className="text-sm text-muted-foreground mt-1">الوسيط: {policy.brokers.name}</p>
                            )}
                          </div>
                        </Section>
                      )}

                      {/* Period */}
                      <Section title="فترة التأمين" icon={Calendar}>
                        <div className="bg-muted/30 rounded-xl p-4 border">
                          <div className={cn("grid gap-2 text-center", (policy as any).issue_date ? "grid-cols-4" : "grid-cols-3")}>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">من</p>
                              <p className="font-semibold text-sm">{formatDate(policy.start_date)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">إلى</p>
                              <p className="font-semibold text-sm">{formatDate(policy.end_date)}</p>
                            </div>
                            {(policy as any).issue_date && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">تاريخ الإصدار</p>
                                <p className="font-semibold text-sm text-primary">{formatDate((policy as any).issue_date)}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">المتبقي</p>
                              <p className={cn(
                                "font-semibold text-sm",
                                remainingDays < 0 ? "text-red-600" :
                                remainingDays <= 30 ? "text-amber-600" : "text-primary"
                              )}>
                                {remainingDays < 0 ? 'منتهية' : `${remainingDays} يوم`}
                              </p>
                            </div>
                          </div>
                        </div>
                      </Section>
                    </div>

                    {/* Package Components Table - unified view */}
                    {hasPackage && (
                      <PackageComponentsTable
                        policies={[
                          {
                            id: policy.id,
                            policy_type_parent: policy.policy_type_parent,
                            policy_type_child: policy.policy_type_child,
                            start_date: policy.start_date,
                            end_date: policy.end_date,
                            insurance_price: policy.insurance_price,
                            profit: policy.profit,
                            is_under_24: policy.is_under_24,
                            group_id: policy.group_id,
                            insurance_companies: policy.insurance_companies,
                            road_services: policy.road_services,
                            cars: policy.cars ? {
                              car_type: policy.cars.car_type,
                              car_value: policy.cars.car_value,
                              year: policy.cars.year,
                            } : undefined,
                          },
                          ...relatedPolicies.map(rp => ({
                            id: rp.id,
                            policy_type_parent: rp.policy_type_parent,
                            policy_type_child: rp.policy_type_child,
                            start_date: policy.start_date, // Use main policy dates
                            end_date: policy.end_date,
                            insurance_price: rp.insurance_price,
                            profit: rp.profit,
                            is_under_24: policy.is_under_24,
                            group_id: policy.group_id,
                            insurance_companies: rp.insurance_companies,
                            road_services: rp.road_services,
                            accident_fee_services: rp.accident_fee_services,
                            cars: policy.cars ? {
                              car_type: policy.cars.car_type,
                              car_value: policy.cars.car_value,
                              year: policy.cars.year,
                            } : undefined,
                          }))
                        ]}
                        isAdmin={isAdmin}
                        onEditPolicy={(p) => setPackageEditGroupId(p.group_id || null)}
                        syncStatuses={syncStatuses}
                      />
                    )}

                    {/* Client & Car Info */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Client */}
                      <Section title="بيانات العميل" icon={User}>
                        <div className="bg-muted/30 rounded-xl p-4 border space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">الاسم</span>
                            <span className="font-semibold">{policy.clients.full_name}</span>
                          </div>
                          <Separator />
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">رقم الهوية</span>
                            <span className="font-mono font-semibold"><bdi>{policy.clients.id_number}</bdi></span>
                          </div>
                          <Separator />
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">الهاتف</span>
                            <span className="font-mono"><bdi>{policy.clients.phone_number || '-'}</bdi></span>
                          </div>
                          {policy.clients.file_number && (
                            <>
                              <Separator />
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">رقم الملف</span>
                                <span>{policy.clients.file_number}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </Section>

                      {/* Car */}
                      <Section title="بيانات السيارة" icon={Car}>
                        {policy.cars ? (
                          <div className="bg-muted/30 rounded-xl p-4 border space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">رقم السيارة</span>
                              <span className="font-mono font-bold text-primary"><bdi>{policy.cars.car_number}</bdi></span>
                            </div>
                            <Separator />
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">الشركة المصنعة</span>
                              <span className="font-semibold">{policy.cars.manufacturer_name || '-'}</span>
                            </div>
                            <Separator />
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">سنة الصنع</span>
                              <span>{policy.cars.year || '-'}</span>
                            </div>
                            {policy.cars.car_type && (
                              <>
                                <Separator />
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-muted-foreground">النوع</span>
                                  <span>{carTypeLabels[policy.cars.car_type] || policy.cars.car_type}</span>
                                </div>
                              </>
                            )}
                            {policy.cars.car_value && (
                              <>
                                <Separator />
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-muted-foreground">قيمة السيارة</span>
                                  <span className="font-semibold ltr-nums">{formatCurrency(policy.cars.car_value)}</span>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="bg-muted/30 rounded-xl p-6 border text-center">
                            <Car className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                            <p className="text-muted-foreground">بدون سيارة</p>
                          </div>
                        )}
                      </Section>
                    </div>

                    {/* Additional Drivers / Children */}
                    {policyChildren.length > 0 && (
                      <Section title="السائقين الإضافيين" icon={Users}>
                        <div className="space-y-2">
                          {policyChildren.map((pc) => (
                            pc.child && (
                              <div key={pc.id} className="p-3 bg-muted/50 rounded-lg border flex items-center justify-between">
                                <div>
                                  <p className="font-medium">{pc.child.full_name}</p>
                                  <p className="text-sm text-muted-foreground">
                                    <bdi className="font-mono">{pc.child.id_number}</bdi>
                                    {pc.child.relation && ` • ${pc.child.relation}`}
                                  </p>
                                </div>
                                {pc.child.phone && (
                                  <span className="text-sm text-muted-foreground font-mono"><bdi>{pc.child.phone}</bdi></span>
                                )}
                              </div>
                            )
                          ))}
                        </div>
                      </Section>
                    )}

                    {/* Pricing Details - Admin only */}
                    {isAdmin && !isElzami && (
                      <Section title="تفاصيل الأسعار" icon={DollarSign}>
                        <div className="bg-muted/30 rounded-xl p-4 border">
                          <div className="grid grid-cols-3 gap-4 text-center">
                            <div className="p-3 rounded-lg bg-background">
                              <p className="text-xs text-muted-foreground mb-1">سعر التأمين</p>
                              <p className="font-bold text-lg ltr-nums">{formatCurrency(policy.insurance_price)}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-orange-50">
                              <p className="text-xs text-orange-600 mb-1">مدفوع للشركة</p>
                              <p className="font-bold text-lg text-orange-700 ltr-nums">{formatCurrency(policy.payed_for_company)}</p>
                            </div>
                            <div className="p-3 rounded-lg bg-[#122143]/5">
                              <p className="text-xs text-primary mb-1">الربح</p>
                              <p className="font-bold text-lg text-primary ltr-nums">{formatCurrency(policy.profit)}</p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full mt-3 text-xs text-muted-foreground hover:text-primary"
                            onClick={async () => {
                              if (!policyId) return;
                              const result = await recalculatePolicyProfit(policyId);
                              if (result) {
                                toast({ title: "تم", description: `الربح: ${result.profit}₪ | للشركة: ${result.companyPayment}₪` });
                                fetchPolicyDetails();
                                onUpdated?.();
                              } else {
                                toast({ title: "لا تغيير", description: "لا توجد قواعد تسعير لهذه الوثيقة" });
                              }
                            }}
                          >
                            <RefreshCw className="ml-1 h-3 w-3" />
                            إعادة حساب الربح
                          </Button>
                        </div>
                      </Section>
                    )}

                    {/* Office Commission - show for ELZAMI if > 0 */}
                    {isAdmin && policy.policy_type_parent === 'ELZAMI' && (policy.office_commission || 0) > 0 && (
                      <Section title="عمولة للمكتب" icon={CircleDollarSign}>
                        <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                          <p className="font-bold text-lg text-amber-700 ltr-nums">{formatCurrency(policy.office_commission)}</p>
                          <p className="text-xs text-amber-600 mt-1">مستحقة من العميل لصالح AB</p>
                        </div>
                      </Section>
                    )}

                    {/* Notes */}
                    {policy.notes && (
                      <Section title="ملاحظات" icon={FileText}>
                        <div className="bg-muted/30 rounded-xl p-4 border">
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{policy.notes}</p>
                        </div>
                      </Section>
                    )}

                    {/* Transfer History */}
                    {transferHistory.length > 0 && (
                      <Section title={`سجل التحويلات (${transferHistory.length})`} icon={History}>
                        <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-4 space-y-3">
                          {transferHistory.map((transfer) => (
                            <div key={transfer.id} className="flex items-center gap-4 pb-3 border-b border-amber-200 last:border-0 last:pb-0">
                              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                                <ArrowLeftRight className="h-4 w-4 text-amber-600" />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm bg-amber-100 px-2 py-0.5 rounded">
                                    {transfer.from_car?.car_number}
                                  </span>
                                  <ArrowLeftRight className="h-3 w-3 text-amber-600" />
                                  <span className="font-mono text-sm bg-primary/10 text-primary px-2 py-0.5 rounded">
                                    {transfer.to_car?.car_number}
                                  </span>
                                </div>
                                {transfer.note && (
                                  <p className="text-xs text-muted-foreground mt-1">{transfer.note}</p>
                                )}
                              </div>
                              <div className="text-left shrink-0">
                                <p className="text-xs text-muted-foreground">{formatDate(transfer.transfer_date)}</p>
                                {transfer.adjustment_type && transfer.adjustment_type !== 'none' && (
                                  <Badge variant="outline" className="text-xs mt-1">
                                    {transfer.adjustment_type === 'customer_pays' ? 'دفع' : 'مرتجع'}: ₪{transfer.adjustment_amount}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </Section>
                    )}

                    {/* Creator Info with Date/Time */}
                    <div className="text-xs text-center text-muted-foreground pt-4 border-t space-y-1">
                      <p>
                        تاريخ الإنشاء: {new Date(policy.created_at).toLocaleDateString('en-GB')} الساعة {new Date(policy.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {creatorName && <p>أنشئ بواسطة: {creatorName}</p>}
                    </div>
                  </div>
                )}

                {activeSection === 'payments' && (
                  <div className="p-6">
                    <PolicyPaymentsSection
                      policyId={policy.id}
                      payments={hasPackage ? packagePayments : payments}
                      insurancePrice={hasPackage ? packageTotalPrice : (policy.insurance_price + (policy.office_commission || 0))}
                      branchId={policy.branch_id}
                      onPaymentsChange={handlePaymentsChange}
                      autoOpenAdd={showQuickPayment}
                      onAutoOpenHandled={() => setShowQuickPayment(false)}
                      packagePolicyIds={hasPackage ? [policy.id, ...relatedPolicies.map(rp => rp.id)] : undefined}
                      packageTotalPrice={hasPackage ? packageTotalPrice : undefined}
                    />
                  </div>
                )}

                {activeSection === 'files' && (
                  <div className="p-6">
                    <PolicyFilesSection 
                      policyId={policy.id} 
                      policyNumber={policy.policy_number}
                      clientId={policy.clients.id}
                      clientPhoneNumber={policy.clients.phone_number}
                      clientName={policy.clients.full_name}
                      onPolicyNumberSaved={() => fetchPolicyDetails()}
                      packagePolicyIds={hasPackage ? [policy.id, ...relatedPolicies.map(rp => rp.id)] : undefined}
                    />
                  </div>
                )}
              </ScrollArea>
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">لم يتم العثور على الوثيقة</div>
          )}
        </DialogContent>
      </Dialog>

      {policy && (
        <>
          <PolicyEditDrawer open={editOpen} onOpenChange={setEditOpen} policy={policy} onSaved={handleEditComplete} />
          <CancelPolicyModal
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            policyId={policy.id}
            policyNumber={policy.policy_number}
            clientId={policy.clients.id}
            clientName={policy.clients.full_name}
            clientPhone={policy.clients.phone_number}
            branchId={policy.branch_id}
            insurancePrice={policy.insurance_price}
            onCancelled={handleEditComplete}
          />
          <TransferPolicyModal
            open={transferOpen}
            onOpenChange={setTransferOpen}
            policyId={policy.id}
            policyNumber={policy.policy_number}
            policyType={policy.policy_type_parent}
            groupId={policy.group_id}
            clientId={policy.clients.id}
            clientName={policy.clients.full_name}
            clientPhone={policy.clients.phone_number}
            branchId={policy.branch_id}
            currentCar={policy.cars}
            onTransferred={handleEditComplete}
          />
          <PackagePolicyEditModal
            open={!!packageEditGroupId}
            onOpenChange={(isOpen) => !isOpen && setPackageEditGroupId(null)}
            groupId={packageEditGroupId}
            onSaved={handleEditComplete}
          />
        </>
      )}
    </>
  );
}
