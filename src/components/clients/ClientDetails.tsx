import { useState, useEffect, useMemo, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { useRecentClient } from '@/hooks/useRecentClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowRight,
  Edit,
  User,
  Phone,
  Car,
  FileText,
  Plus,
  Calendar,
  Hash,
  Banknote,
  Users,
  Save,
  X,
  Search,
  Eye,
  Wallet,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  CreditCard,
  Building2,
  Trash2,
  MoreHorizontal,
  FileImage,
  DollarSign,
  MessageSquare,
  Loader2,
  Receipt,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CarDrawer } from '@/components/cars/CarDrawer';
import { PolicyDetailsDrawer } from '@/components/policies/PolicyDetailsDrawer';
import { TransferPolicyModal } from '@/components/policies/TransferPolicyModal';
import { CancelPolicyModal } from '@/components/policies/CancelPolicyModal';
import { PolicyWizard } from '@/components/policies/PolicyWizard';
import { PolicyEditDrawer } from '@/components/policies/PolicyEditDrawer';
import { PackagePolicyEditModal } from '@/components/policies/PackagePolicyEditModal';
import { ClientDrawer } from '@/components/clients/ClientDrawer';
import { ClientSignatureSection } from '@/components/clients/ClientSignatureSection';
import { PolicyYearTimeline } from '@/components/clients/PolicyYearTimeline';
import { ClientReportModal } from '@/components/clients/ClientReportModal';
import { CarFilterChips } from '@/components/clients/CarFilterChips';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { ClickablePhone } from '@/components/shared/ClickablePhone';
import { DebtIndicator } from '@/components/shared/DebtIndicator';
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog';
import { DebtPaymentModal } from '@/components/debt/DebtPaymentModal';
import { ClientNotesSection } from '@/components/clients/ClientNotesSection';
import { PaymentEditDialog } from '@/components/clients/PaymentEditDialog';
import { PaymentGroupDetailsDialog } from '@/components/clients/PaymentGroupDetailsDialog';
import { getCombinedPaymentTypeLabel, getPaymentTypeLabel } from '@/lib/paymentLabels';
import { RefundsTab } from '@/components/clients/RefundsTab';
import { AccidentReportWizard } from '@/components/accident-reports/AccidentReportWizard';
import { ClientAccidentsTab } from '@/components/clients/ClientAccidentsTab';
import { useClientAccidentInfo } from '@/hooks/useClientAccidentInfo';
import { cn } from '@/lib/utils';
import { getInsuranceTypeLabel } from '@/lib/insuranceTypes';
import { ChequeImageGallery } from '@/components/shared/ChequeImageGallery';
import { useBranches } from '@/hooks/useBranches';
import { useAuth } from '@/hooks/useAuth';
import type { RenewalData } from '@/components/policies/wizard/types';

interface Client {
  id: string;
  full_name: string;
  id_number: string;
  file_number: string | null;
  phone_number: string | null;
  phone_number_2: string | null;
  birth_date: string | null;
  date_joined: string | null;
  less_than_24: boolean | null;
  under24_type: 'none' | 'client' | 'additional_driver' | null;
  under24_driver_name: string | null;
  under24_driver_id: string | null;
  notes: string | null;
  accident_notes: string | null;
  image_url: string | null;
  signature_url: string | null;
  created_at: string;
  broker_id: string | null;
  branch_id: string | null;
}

interface Broker {
  id: string;
  name: string;
  phone: string | null;
}

interface CarRecord {
  id: string;
  car_number: string;
  client_id: string;
  manufacturer_name: string | null;
  model: string | null;
  model_number: string | null;
  year: number | null;
  color: string | null;
  car_type: string | null;
  car_value: number | null;
  license_type: string | null;
  license_expiry: string | null;
  last_license: string | null;
}

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
  broker_id: string | null;
  broker_direction: 'from_broker' | 'to_broker' | null;
  company: { name: string; name_ar: string | null } | null;
  car: { id: string; car_number: string } | null;
  creator: { full_name: string | null; email: string } | null;
  road_service: { name: string; name_ar: string | null } | null;
  broker: { id: string; name: string } | null;
}

interface PaymentSummary {
  total_paid: number;
  total_remaining: number;
  total_profit: number;
}

interface WalletBalance {
  total_refunds: number;
  transaction_count: number;
}

interface PaymentRecord {
  id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  cheque_number: string | null;
  cheque_date?: string | null;
  bank_code?: string | null;
  branch_code?: string | null;
  cheque_image_url: string | null;
  card_last_four: string | null;
  refused: boolean | null;
  notes: string | null;
  locked: boolean | null;
  policy_id: string;
  batch_id: string | null;
  policy: {
    id: string;
    policy_type_parent: string;
    policy_type_child?: string | null;
    insurance_price: number;
    group_id?: string | null;
  } | null;
}

// Grouped payment for display (combines payments with same batch_id)
interface GroupedPayment {
  id: string; // batch_id or individual payment id
  groupId: string | null; // policies.group_id when the row collapses a package
  totalAmount: number;
  payment_date: string;
  payment_type: string; // first type, kept for filter compat
  paymentTypes: string[]; // unique payment types across the batch
  cheque_number: string | null;
  cheque_image_url: string | null;
  card_last_four: string | null;
  refused: boolean | null;
  notes: string | null;
  locked: boolean | null;
  payments: PaymentRecord[]; // Individual payments in this group
  policyTypes: string[]; // Unique policy types in this group
  // Every policy that belongs to this package (resolved via group_id on
  // policies). Auto-generated ELZAMI and user-entered payments are always
  // attached to the main policy_id on the DB side, so without this we'd
  // only ever see one policy type per row. When the row is a standalone
  // payment (no group_id) this falls back to just the attached policy.
  packagePolicies: { id: string; policy_type_parent: string; policy_type_child: string | null }[];
}

interface ClientDetailsProps {
  client: Client;
  onBack: () => void;
  onRefresh: () => void;
  initialCarFilter?: string | null;
  /** Path to return to (e.g., '/reports/policies') */
  returnPath?: string | null;
  /** Tab to restore when returning */
  returnTab?: string | null;
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

const carTypeLabels: Record<string, string> = {
  car: 'خصوصي',
  cargo: 'شحن',
  small: 'اوتوبس زعير',
  taxi: 'تاكسي',
  tjeradown4: 'تجاري (أقل من 4 طن)',
  tjeraup4: 'تجاري (أكثر من 4 طن)',
};

export function ClientDetails({ client, onBack, onRefresh, initialCarFilter, returnPath, returnTab }: ClientDetailsProps) {
  const { getBranchName } = useBranches();
  const { isAdmin, isSuperAdmin, profile, user } = useAuth();
  const { setRecentClient } = useRecentClient();
  const { count: accidentCount, hasActiveReports } = useClientAccidentInfo(client.id);
  const [cars, setCars] = useState<CarRecord[]>([]);
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const policiesHeaderRef = useRef<HTMLDivElement>(null);

  // Scroll to the policies section and run a 3-second attention pulse on
  // every #N document-number chip so the user can see which concrete rows
  // the "الوثائق" stat is counting. Re-clicks restart the animation via a
  // forced reflow between remove/add.
  const handleRevealDocs = () => {
    policiesHeaderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      const targets = document.querySelectorAll<HTMLElement>('[data-doc-number]');
      targets.forEach((el) => {
        el.classList.remove('highlight-pulse');
        void el.offsetWidth;
        el.classList.add('highlight-pulse');
      });
      window.setTimeout(() => {
        targets.forEach((el) => el.classList.remove('highlight-pulse'));
      }, 3100);
    }, 350);
  };
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [broker, setBroker] = useState<Broker | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary>({ total_paid: 0, total_remaining: 0, total_profit: 0 });
  const [walletBalance, setWalletBalance] = useState<WalletBalance>({ total_refunds: 0, transaction_count: 0 });
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingCars, setLoadingCars] = useState(true);
  const [loadingPolicies, setLoadingPolicies] = useState(true);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [carDrawerOpen, setCarDrawerOpen] = useState(false);
  const [policyDetailsOpen, setPolicyDetailsOpen] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [policyWizardOpen, setPolicyWizardOpen] = useState(false);
  const [clientDrawerOpen, setClientDrawerOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [debtPaymentModalOpen, setDebtPaymentModalOpen] = useState(false);
  // Cancel policy/package modal — opened directly from the dropdown on
  // PolicyYearTimeline instead of going through the details drawer.
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelPolicyIds, setCancelPolicyIds] = useState<string[]>([]);
  const [cancelInsurancePrice, setCancelInsurancePrice] = useState(0);
  const [cancelPolicyNumber, setCancelPolicyNumber] = useState<string | null>(null);

  // Edit policy/package modals — opened directly from the dropdown so
  // the user skips the "open drawer, find edit button" dance. Single
  // policies go through PolicyEditDrawer (needs a fully hydrated row,
  // so we fetch on demand) and package edits go through
  // PackagePolicyEditModal which already fetches by group_id.
  const [editPolicyOpen, setEditPolicyOpen] = useState(false);
  const [editPolicyData, setEditPolicyData] = useState<any | null>(null);
  const [editPackageGroupId, setEditPackageGroupId] = useState<string | null>(null);
  
  // Delete policy state (Super Admin only)
  const [deletePolicyIds, setDeletePolicyIds] = useState<string[]>([]);
  const [deletePolicyDialogOpen, setDeletePolicyDialogOpen] = useState(false);
  const [deletingPolicy, setDeletingPolicy] = useState(false);
  
  // Car edit/delete state
  const [editingCar, setEditingCar] = useState<CarRecord | null>(null);
  const [deleteCarId, setDeleteCarId] = useState<string | null>(null);
  const [deleteCarDialogOpen, setDeleteCarDialogOpen] = useState(false);
  const [deletingCar, setDeletingCar] = useState(false);
  const [carPolicyCounts, setCarPolicyCounts] = useState<Record<string, number>>({});
  
  // Policy metadata - fetched once, used for instant filtering
  const [policyPaymentInfo, setPolicyPaymentInfo] = useState<Record<string, { paid: number; remaining: number }>>({});
  const [policyAccidentCounts, setPolicyAccidentCounts] = useState<Record<string, number>>({});
  const [policyChildrenCounts, setPolicyChildrenCounts] = useState<Record<string, number>>({});
  
  // Payment delete state
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [deletePaymentDialogOpen, setDeletePaymentDialogOpen] = useState(false);
  const [groupDetailsOpen, setGroupDetailsOpen] = useState(false);
  const [groupDetailsGroup, setGroupDetailsGroup] = useState<GroupedPayment | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);
  // Group key to re-open the PaymentGroupDetailsDialog with after an
  // edit/delete round-trip. Set to the current group's id when the user
  // clicks pencil/trash inside the popup, then consumed by the effect
  // below once the inner dialog has closed.
  const [pendingReopenGroupKey, setPendingReopenGroupKey] = useState<string | null>(null);
  
  // Payment edit state
  const [editPaymentDialogOpen, setEditPaymentDialogOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentRecord | null>(null);
  // When a payment edit is opened from a grouped row we also pass the
  // full package context so the dialog can show the right policies at
  // the top instead of whichever single policy the row was attached to.
  const [editingGroupPolicies, setEditingGroupPolicies] = useState<
    { id: string; policy_type_parent: string; policy_type_child: string | null; insurance_price: number; company_name: string | null }[] | undefined
  >(undefined);
  
  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(client.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  
  // Policy filters
  const [policySearch, setPolicySearch] = useState('');
  const [policyTypeFilter, setPolicyTypeFilter] = useState<string>('all');
  const [policyStatusFilter, setPolicyStatusFilter] = useState<string>('all');
  const [policyCarFilter, setPolicyCarFilter] = useState<string>(initialCarFilter || 'all');

  // Sync car filter when initialCarFilter prop changes (e.g. navigating between clients)
  useEffect(() => {
    setPolicyCarFilter(initialCarFilter || 'all');
  }, [initialCarFilter]);

  // Payment filters
  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<string>('all');
  
  // Comprehensive invoice state
  
  // Individual payment receipt state
  const [generatingReceipt, setGeneratingReceipt] = useState<string | null>(null);
  
  // Accident report wizard state
  const [accidentWizardOpen, setAccidentWizardOpen] = useState(false);

  // Renewal state
  const [renewalData, setRenewalData] = useState<RenewalData | null>(null);

  const fetchBroker = async () => {
    if (!client.broker_id) {
      setBroker(null);
      return;
    }
    try {
      const { data } = await supabase
        .from('brokers')
        .select('id, name, phone')
        .eq('id', client.broker_id)
        .single();
      if (data) setBroker(data);
      else setBroker(null);
    } catch (error) {
      console.error('Error fetching broker:', error);
      setBroker(null);
    }
  };

  const fetchCars = async () => {
    setLoadingCars(true);
    try {
      const { data, error } = await supabase
        .from('cars')
        .select('id, car_number, client_id, manufacturer_name, model, model_number, year, color, car_type, car_value, license_type, license_expiry, last_license')
        .eq('client_id', client.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCars(data || []);
    } catch (error) {
      console.error('Error fetching cars:', error);
    } finally {
      setLoadingCars(false);
    }
  };

  // Fetch policy metadata (payments, accidents, children) - called once after policies load
  const fetchPolicyMetadata = async (policyIds: string[], policiesData: PolicyRecord[]) => {
    if (policyIds.length === 0) {
      setPolicyPaymentInfo({});
      setPolicyAccidentCounts({});
      setPolicyChildrenCounts({});
      return;
    }

    try {
      // Fetch all three in parallel
      const [paymentsRes, accidentsRes, childrenRes] = await Promise.all([
        supabase
          .from('policy_payments')
          .select('policy_id, amount, refused')
          .in('policy_id', policyIds),
        supabase
          .from('accident_reports')
          .select('policy_id')
          .in('policy_id', policyIds),
        supabase
          .from('policy_children')
          .select('policy_id')
          .in('policy_id', policyIds),
      ]);

      // Process payment info
      const paymentInfo: Record<string, { paid: number; remaining: number }> = {};
      policiesData.forEach(p => {
        const policyPayments = (paymentsRes.data || [])
          .filter(pay => pay.policy_id === p.id && !pay.refused);
        const paid = policyPayments.reduce((sum, pay) => sum + pay.amount, 0);
        paymentInfo[p.id] = {
          paid,
          remaining: (p.insurance_price + ((p as any).office_commission || 0)) - paid,
        };
      });
      setPolicyPaymentInfo(paymentInfo);

      // Process accident counts
      const accCounts: Record<string, number> = {};
      (accidentsRes.data || []).forEach(row => {
        accCounts[row.policy_id] = (accCounts[row.policy_id] || 0) + 1;
      });
      setPolicyAccidentCounts(accCounts);

      // Process children counts
      const childCounts: Record<string, number> = {};
      (childrenRes.data || []).forEach(row => {
        childCounts[row.policy_id] = (childCounts[row.policy_id] || 0) + 1;
      });
      setPolicyChildrenCounts(childCounts);
    } catch (error) {
      console.error('Error fetching policy metadata:', error);
    }
  };

  const fetchPolicies = async () => {
    setLoadingPolicies(true);
    try {
      const { data, error } = await supabase
        .from('policies')
        .select(`
          id, policy_number, policy_type_parent, policy_type_child, start_date, end_date,
          insurance_price, office_commission, profit, cancelled, transferred, group_id,
          transferred_car_number, transferred_to_car_number, transferred_from_policy_id,
          created_at, branch_id, notes,
          broker_id, broker_direction,
          company:insurance_companies(name, name_ar),
          car:cars(id, car_number),
          creator:profiles!policies_created_by_admin_id_fkey(full_name, email),
          road_service:road_services(name, name_ar),
          broker:brokers(id, name)
        `)
        .eq('client_id', client.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPolicies(data || []);
      
      // Fetch metadata once for all policies
      if (data && data.length > 0) {
        fetchPolicyMetadata(data.map(p => p.id), data);
      } else {
        setPolicyPaymentInfo({});
        setPolicyAccidentCounts({});
        setPolicyChildrenCounts({});
      }
    } catch (error) {
      console.error('Error fetching policies:', error);
    } finally {
      setLoadingPolicies(false);
    }
  };

  const fetchPaymentSummary = async () => {
    try {
      // Debt math (owed / paid / remaining) comes from get_client_balance
      // so the card matches the debt modal and the DebtTracking RPCs.
      // That function knows how to: exclude broker-only debt from the
      // client's owed amount, pool payments across broker siblings within
      // a package, and cap broker overpayment so it can't erase debt in
      // other groups. Profit still needs a raw policies query since the
      // RPC doesn't return it.
      const [balanceResult, profitResult] = await Promise.all([
        supabase.rpc('get_client_balance', { p_client_id: client.id }),
        supabase
          .from('policies')
          .select('profit')
          .eq('client_id', client.id)
          .eq('cancelled', false)
          .eq('transferred', false)
          .is('deleted_at', null),
      ]);

      if (balanceResult.error) throw balanceResult.error;

      const balance = balanceResult.data?.[0];
      const totalInsurance = Number(balance?.total_insurance || 0);
      const totalPaid = Number(balance?.total_paid || 0);
      const totalProfit = (profitResult.data || [])
        .reduce((sum, p) => sum + (Number(p.profit) || 0), 0);

      // Keep total_remaining as the pre-refund figure so the existing
      // "المطلوب / المرتجع" breakdown on the card still works — wallet
      // credit is applied on top via walletBalance.total_refunds.
      setPaymentSummary({
        total_paid: totalPaid,
        total_remaining: Math.max(0, totalInsurance - totalPaid),
        total_profit: totalProfit,
      });
    } catch (error) {
      console.error('Error fetching payment summary:', error);
    }
  };

  const fetchWalletBalance = async () => {
    try {
      const { data, error } = await supabase
        .from('customer_wallet_transactions')
        .select('amount, transaction_type')
        .eq('client_id', client.id);

      if (error) throw error;

      // "refund" and "transfer_refund_owed" = We owe customer
      // "transfer_adjustment_due" = Customer owes us
      // "refund", "transfer_refund_owed", "manual_refund" = We owe customer
      const weOweCustomer = (data || [])
        .filter(t => 
          t.transaction_type === 'refund' || 
          t.transaction_type === 'transfer_refund_owed' ||
          t.transaction_type === 'manual_refund'
        )
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      const customerOwesUs = (data || [])
        .filter(t => t.transaction_type === 'transfer_adjustment_due')
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      setWalletBalance({
        total_refunds: weOweCustomer - customerOwesUs, // Net amount we owe
        transaction_count: data?.length || 0,
      });
    } catch (error) {
      console.error('Error fetching wallet balance:', error);
    }
  };

  const fetchPayments = async () => {
    setLoadingPayments(true);
    try {
      // Get all policies for this client first — include group_id so the
      // payments tab can collapse every payment that belongs to the same
      // package into one row.
      const { data: policiesData } = await supabase
        .from('policies')
        .select('id, policy_type_parent, policy_type_child, insurance_price, office_commission, group_id')
        .eq('client_id', client.id)
        .is('deleted_at', null);

      if (!policiesData || policiesData.length === 0) {
        setPayments([]);
        return;
      }

      const policyIds = policiesData.map(p => p.id);

      // Get all payments for these policies (include batch_id for grouping)
      const { data: paymentsData, error } = await supabase
        .from('policy_payments')
        .select('id, amount, payment_date, payment_type, cheque_number, cheque_date, bank_code, branch_code, cheque_image_url, card_last_four, refused, notes, policy_id, locked, batch_id')
        .in('policy_id', policyIds)
        .order('payment_date', { ascending: false });

      if (error) throw error;

      // Map payments with policy info
      const paymentsWithPolicy = (paymentsData || []).map(payment => ({
        ...payment,
        policy: policiesData.find(p => p.id === payment.policy_id) || null,
      }));

      setPayments(paymentsWithPolicy);
    } catch (error) {
      console.error('Error fetching payments:', error);
    } finally {
      setLoadingPayments(false);
    }
  };

  // Set this client as the recent client for quick navigation
  useEffect(() => {
    setRecentClient({
      id: client.id,
      name: client.full_name,
      initial: client.full_name.charAt(0),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  useEffect(() => {
    const loadInitialData = async () => {
      setInitialLoading(true);
      await Promise.all([
        fetchCars(),
        fetchPolicies(),
        fetchBroker(),
        fetchPaymentSummary(),
        fetchPayments(),
        fetchWalletBalance(),
        fetchCarPolicyCounts(),
      ]);
      setNotesValue(client.notes || '');
      setInitialLoading(false);
    };
    loadInitialData();
  }, [client.id]);

  // Watch for broker_id changes and refetch broker
  useEffect(() => {
    fetchBroker();
  }, [client.broker_id]);


  // Export functionality
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB');
  };

  const handleCarSaved = () => {
    setCarDrawerOpen(false);
    setEditingCar(null);
    fetchCars();
    fetchCarPolicyCounts();
    onRefresh();
  };

  // Fetch policy count per car
  const fetchCarPolicyCounts = async () => {
    try {
      const { data } = await supabase
        .from('policies')
        .select('car_id')
        .eq('client_id', client.id)
        .is('deleted_at', null)
        .eq('cancelled', false);
      
      const counts: Record<string, number> = {};
      (data || []).forEach(p => {
        if (p.car_id) {
          counts[p.car_id] = (counts[p.car_id] || 0) + 1;
        }
      });
      setCarPolicyCounts(counts);
    } catch (error) {
      console.error('Error fetching car policy counts:', error);
    }
  };

  // Delete car handler
  const handleDeleteCar = async () => {
    if (!deleteCarId) return;
    
    // Check if car has policies
    if (carPolicyCounts[deleteCarId] > 0) {
      toast.error('لا يمكن حذف السيارة لوجود وثائق مرتبطة بها');
      setDeleteCarDialogOpen(false);
      setDeleteCarId(null);
      return;
    }
    
    setDeletingCar(true);
    try {
      const { error } = await supabase
        .from('cars')
        .delete()
        .eq('id', deleteCarId);
      
      if (error) throw error;
      toast.success('تم حذف السيارة بنجاح');
      fetchCars();
      fetchCarPolicyCounts();
    } catch (error) {
      console.error('Error deleting car:', error);
      toast.error('فشل حذف السيارة');
    } finally {
      setDeletingCar(false);
      setDeleteCarDialogOpen(false);
      setDeleteCarId(null);
    }
  };

  // Delete payment handler
  const handleDeletePayment = async () => {
    if (!deletePaymentId) return;

    setDeletingPayment(true);
    try {
      const { error } = await supabase
        .from('policy_payments')
        .delete()
        .eq('id', deletePaymentId);

      if (error) throw error;
      toast.success('تم حذف الدفعة بنجاح');
      // Refresh every surface that reads from payments so the policy
      // cards' paid/remaining numbers stay in sync without a full reload.
      await Promise.all([
        fetchPayments(),
        fetchPaymentSummary(),
        fetchPolicies(),
      ]);
    } catch (error) {
      console.error('Error deleting payment:', error);
      toast.error('فشل حذف الدفعة');
    } finally {
      setDeletingPayment(false);
      setDeletePaymentDialogOpen(false);
      setDeletePaymentId(null);
    }
  };

  // Open payment edit dialog directly
  const handleEditPayment = (payment: PaymentRecord, group?: GroupedPayment) => {
    setEditingPayment(payment);
    // If the payment belongs to a package (has group_id + >1 policy),
    // expand the package policies so the dialog can render every row
    // of the package at the top instead of just the attached policy.
    if (group && group.packagePolicies.length > 1) {
      const enriched = group.packagePolicies
        .map((pp) => {
          const full = policies.find((pol) => pol.id === pp.id);
          return {
            id: pp.id,
            policy_type_parent: pp.policy_type_parent,
            policy_type_child: pp.policy_type_child,
            insurance_price: Number(full?.insurance_price || 0),
            company_name: full?.company?.name_ar || full?.company?.name || null,
          };
        });
      setEditingGroupPolicies(enriched);
    } else {
      setEditingGroupPolicies(undefined);
    }
    setEditPaymentDialogOpen(true);
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ notes: notesValue || null, updated_at: new Date().toISOString() })
        .eq('id', client.id);

      if (error) throw error;
      toast.success('تم حفظ الملاحظات');
      setEditingNotes(false);
      onRefresh();
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error('فشل في حفظ الملاحظات');
    } finally {
      setSavingNotes(false);
    }
  };

  const handlePolicyClick = (policyId: string) => {
    setSelectedPolicyId(policyId);
    setPolicyDetailsOpen(true);
  };

  // Super Admin: Handle policy deletion
  const handleDeletePolicy = async () => {
    if (!isAdmin || deletePolicyIds.length === 0) return;

    setDeletingPolicy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        toast.error('يرجى تسجيل الدخول مرة أخرى');
        return;
      }

      // Capture policy details before deletion for activity log
      const { data: policyDetails } = await supabase
        .from('policies')
        .select('id, policy_number, policy_type_parent, insurance_price, client_id, agent_id, branch_id, insurance_companies(name_ar)')
        .in('id', deletePolicyIds);

      const response = await supabase.functions.invoke('delete-policy', {
        body: { policyIds: deletePolicyIds },
      });

      if (response.error) {
        let msg = response.error.message || 'فشل في حذف الوثيقة';
        try {
          const ctx: any = (response.error as any).context;
          if (ctx?.body) {
            const parsed = JSON.parse(ctx.body);
            msg = parsed?.details || parsed?.error || msg;
          }
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      const result = response.data;

      if (result.success) {
        // Log delete activity as notifications for audit trail
        if (policyDetails && policyDetails.length > 0) {
          const userName = profile?.full_name || profile?.email || 'مستخدم';
          for (const pol of policyDetails) {
            const companyName = (pol.insurance_companies as any)?.name_ar || '';
            await supabase.from('notifications').insert({
              user_id: user?.id,
              agent_id: pol.agent_id,
              type: 'policy_deleted',
              title: 'حذف وثيقة',
              message: `تم حذف وثيقة ${pol.policy_number || pol.id.slice(0, 8)} (${companyName}) بواسطة ${userName}`,
              entity_type: 'policy',
              entity_id: pol.id,
              metadata: {
                policy_number: pol.policy_number,
                policy_type: pol.policy_type_parent,
                insurance_price: pol.insurance_price,
                company_name: companyName,
                deleted_by: userName,
                client_name: client?.full_name,
              },
            }).then(() => {});
          }
        }

        toast.success(`تم حذف ${result.deletedCount} وثيقة نهائياً`);
        setDeletePolicyDialogOpen(false);
        setDeletePolicyIds([]);
        // Refresh all data
        fetchPolicies();
        fetchPayments();
        fetchPaymentSummary();
        fetchWalletBalance();
      } else {
        throw new Error(result.error || 'فشل في حذف الوثيقة');
      }
    } catch (error: any) {
      console.error('Delete policy error:', error);
      toast.error(error.message || 'فشل في حذف الوثيقة');
    } finally {
      setDeletingPolicy(false);
    }
  };

  // Handle policy renewal - single policy
  const handleRenewPolicy = async (policyId: string) => {
    try {
      // Fetch policy details with children
      const { data: policy, error } = await supabase
        .from('policies')
        .select(`
          *,
          policy_children(child_id)
        `)
        .eq('id', policyId)
        .single();
      
      if (error || !policy) {
        toast.error('فشل في جلب بيانات الوثيقة');
        return;
      }
      
      // Determine category slug
      let categorySlug = policy.policy_type_parent;
      if (policy.policy_type_parent === 'ELZAMI' || policy.policy_type_parent === 'THIRD_FULL') {
        categorySlug = 'THIRD_FULL';
      }
      
      setRenewalData({
        clientId: policy.client_id,
        carId: policy.car_id,
        categorySlug,
        policyTypeParent: policy.policy_type_parent,
        policyTypeChild: policy.policy_type_child,
        companyId: policy.company_id,
        insurancePrice: policy.insurance_price,
        brokerBuyPrice: policy.broker_buy_price,
        notes: policy.notes,
        childrenIds: policy.policy_children?.map((pc: any) => pc.child_id) || [],
        originalEndDate: policy.end_date,
      });
      
      setPolicyWizardOpen(true);
    } catch (error) {
      console.error('Error fetching policy for renewal:', error);
      toast.error('فشل في جلب بيانات الوثيقة');
    }
  };

  // Handle package renewal - multiple policies
  const handleRenewPackage = async (policyIds: string[]) => {
    try {
      // Fetch all policies in the package
      const { data: policiesData, error } = await supabase
        .from('policies')
        .select('*, policy_children(child_id)')
        .in('id', policyIds);
      
      if (error || !policiesData?.length) {
        toast.error('فشل في جلب بيانات الباقة');
        return;
      }
      
      // Find main policy (THIRD_FULL first, then ELZAMI, then others)
      const mainPolicy = policiesData.find(p => p.policy_type_parent === 'THIRD_FULL') 
        || policiesData.find(p => p.policy_type_parent === 'ELZAMI')
        || policiesData[0];
      
      // Build addons from other policies
      const addons = policiesData
        .filter(p => p.id !== mainPolicy.id)
        .map(p => ({
          type: p.policy_type_parent.toLowerCase() as 'elzami' | 'third_full' | 'road_service' | 'accident_fee_exemption',
          companyId: p.company_id,
          insurancePrice: p.insurance_price,
          roadServiceId: p.road_service_id,
          accidentFeeServiceId: p.accident_fee_service_id,
          policyTypeChild: p.policy_type_child,
          brokerBuyPrice: p.broker_buy_price,
        }));
      
      // Collect all children IDs (deduplicated)
      const allChildrenIds = [...new Set(
        policiesData.flatMap(p => p.policy_children?.map((pc: any) => pc.child_id) || [])
      )];
      
      setRenewalData({
        clientId: mainPolicy.client_id,
        carId: mainPolicy.car_id,
        categorySlug: 'THIRD_FULL',
        policyTypeParent: mainPolicy.policy_type_parent,
        policyTypeChild: mainPolicy.policy_type_child,
        companyId: mainPolicy.company_id,
        insurancePrice: mainPolicy.insurance_price,
        brokerBuyPrice: mainPolicy.broker_buy_price,
        notes: mainPolicy.notes,
        packageAddons: addons,
        childrenIds: allChildrenIds,
        originalEndDate: mainPolicy.end_date,
      });
      
      setPolicyWizardOpen(true);
    } catch (error) {
      console.error('Error fetching package for renewal:', error);
      toast.error('فشل في جلب بيانات الباقة');
    }
  };

  const handleGeneratePaymentReceipt = async (paymentId: string) => {
    setGeneratingReceipt(paymentId);
    try {
      const { data, error } = await supabase.functions.invoke('generate-payment-receipt', {
        body: { payment_id: paymentId }
      });

      if (error) throw error;

      if (data?.receipt_url) {
        window.open(data.receipt_url, '_blank');
      } else {
        toast.error("لم يتم العثور على رابط الإيصال");
      }
    } catch (error) {
      console.error('Generate receipt error:', error);
      toast.error("فشل في توليد الإيصال");
    } finally {
      setGeneratingReceipt(null);
    }
  };

  // Print every سند قبض in a grouped row as a single combined page. Uses
  // the bulk endpoint when there's more than one payment; for a single
  // payment it falls back to the per-payment endpoint.
  const handlePrintGroupReceipts = async (groupKey: string, paymentIds: string[]) => {
    if (paymentIds.length === 0) return;
    setGeneratingReceipt(groupKey);
    try {
      if (paymentIds.length === 1) {
        const { data, error } = await supabase.functions.invoke('generate-payment-receipt', {
          body: { payment_id: paymentIds[0] },
        });
        if (error) throw error;
        const url = data?.receipt_url;
        if (url) window.open(url, '_blank');
        else toast.error('لم يتم العثور على رابط السند');
      } else {
        const { data, error } = await supabase.functions.invoke('generate-bulk-payment-receipt', {
          body: { payment_ids: paymentIds },
        });
        if (error) throw error;
        const url = data?.receipt_url;
        if (url) window.open(url, '_blank');
        else toast.error('لم يتم العثور على رابط السندات');
      }
    } catch (e) {
      console.error('Print group receipts error:', e);
      toast.error('فشل في توليد سندات القبض');
    } finally {
      setGeneratingReceipt(null);
    }
  };

  const getPolicyStatus = (policy: PolicyRecord) => {
    if (policy.cancelled) return { label: 'ملغاة', variant: 'destructive' as const, color: 'text-destructive' };
    if (policy.transferred) return { label: 'محولة', variant: 'warning' as const, color: 'text-amber-600' };
    const endDate = new Date(policy.end_date);
    const today = new Date();
    if (endDate < today) return { label: 'منتهية', variant: 'secondary' as const, color: 'text-muted-foreground' };
    return { label: 'سارية', variant: 'success' as const, color: 'text-success' };
  };

  // Filtered policies
  const filteredPolicies = useMemo(() => {
    return policies.filter(policy => {
      // Search filter
      if (policySearch) {
        const search = policySearch.toLowerCase();
        const matchesSearch = 
          (policy.policy_number?.toLowerCase().includes(search)) ||
          (policy.company?.name?.toLowerCase().includes(search)) ||
          (policy.company?.name_ar?.toLowerCase().includes(search)) ||
          (policy.car?.car_number?.toLowerCase().includes(search)) ||
          (getInsuranceTypeLabel(policy.policy_type_parent as any, policy.policy_type_child as any)?.toLowerCase().includes(search));
        if (!matchesSearch) return false;
      }
      
      // Type filter
      if (policyTypeFilter !== 'all' && policy.policy_type_parent !== policyTypeFilter) {
        return false;
      }
      
      // Car filter
      if (policyCarFilter !== 'all' && policy.car?.id !== policyCarFilter) {
        return false;
      }
      
      // Status filter
      if (policyStatusFilter !== 'all') {
        const status = getPolicyStatus(policy);
        if (policyStatusFilter === 'active' && status.label !== 'سارية') return false;
        if (policyStatusFilter === 'expired' && status.label !== 'منتهية') return false;
        if (policyStatusFilter === 'cancelled' && status.label !== 'ملغاة') return false;
        if (policyStatusFilter === 'transferred' && status.label !== 'محولة') return false;
      }
      
      return true;
    });
  }, [policies, policySearch, policyTypeFilter, policyStatusFilter, policyCarFilter]);

  // Get unique policy types for filter
  const uniquePolicyTypes = useMemo(() => {
    const types = new Set(policies.map(p => p.policy_type_parent));
    return Array.from(types);
  }, [policies]);

  // "الوثائق" count — within a package, non-ELZAMI policies from the same
  // company collapse into a single document (e.g. ثالث + خدمات طريق from
  // المشرق = 1 doc). ELZAMI is always its own doc because it's legally
  // distinct from the rest of the package even when the company matches.
  // Standalone policies are counted one each.
  const dedupedPolicyCount = useMemo(() => {
    const packageGroups = new Map<string, PolicyRecord[]>();
    let standalone = 0;
    for (const p of policies) {
      if (p.group_id) {
        const arr = packageGroups.get(p.group_id) || [];
        arr.push(p);
        packageGroups.set(p.group_id, arr);
      } else {
        standalone += 1;
      }
    }
    let packageTotal = 0;
    for (const [, groupPolicies] of packageGroups) {
      const elzami = groupPolicies.filter(p => p.policy_type_parent === 'ELZAMI');
      const nonElzami = groupPolicies.filter(p => p.policy_type_parent !== 'ELZAMI');
      packageTotal += elzami.length;
      const companies = new Set<string>();
      for (const p of nonElzami) {
        companies.add(p.company?.name_ar || p.company?.name || `no-company:${p.id}`);
      }
      packageTotal += companies.size;
    }
    return standalone + packageTotal;
  }, [policies]);

  // Group payments by batch_id for unified display
  const groupedPayments = useMemo((): GroupedPayment[] => {
    const groups = new Map<string, GroupedPayment>();

    // Build a group_id → package policies lookup. Every policy with a
    // group_id gets bucketed so we can answer "which policy types are in
    // this package?" without re-joining on the payments side.
    const packagePoliciesByGroup = new Map<
      string,
      { id: string; policy_type_parent: string; policy_type_child: string | null }[]
    >();
    for (const p of policies) {
      if (!p.group_id) continue;
      const arr = packagePoliciesByGroup.get(p.group_id) || [];
      arr.push({
        id: p.id,
        policy_type_parent: p.policy_type_parent,
        policy_type_child: (p as any).policy_type_child ?? null,
      });
      packagePoliciesByGroup.set(p.group_id, arr);
    }

    // Filter payments first based on search and type filter
    const filteredPayments = payments.filter(payment => {
      if (paymentSearch) {
        const search = paymentSearch.toLowerCase();
        if (!payment.cheque_number?.toLowerCase().includes(search) && 
            !payment.notes?.toLowerCase().includes(search)) {
          return false;
        }
      }
      if (paymentTypeFilter !== 'all' && payment.payment_type !== paymentTypeFilter) {
        return false;
      }
      return true;
    });

    for (const payment of filteredPayments) {
      // Collapse every payment made against the same package (shared
      // group_id on the underlying policy) into one row, regardless of
      // when or how it was paid. Auto-generated ELZAMI payments and
      // user-entered package payments don't share a batch_id but they
      // do share a policy.group_id. Fall back to batch_id for historical
      // non-package batches and finally to the payment id for standalone
      // rows.
      const groupKey = payment.policy?.group_id
        ? `group:${payment.policy.group_id}`
        : payment.batch_id || payment.id;
      
      if (!groups.has(groupKey)) {
        const thisGroupId = payment.policy?.group_id || null;
        const fromPackage = thisGroupId ? packagePoliciesByGroup.get(thisGroupId) : null;
        groups.set(groupKey, {
          id: groupKey,
          groupId: thisGroupId,
          totalAmount: 0,
          payment_date: payment.payment_date,
          payment_type: payment.payment_type,
          paymentTypes: [],
          cheque_number: payment.cheque_number,
          cheque_image_url: payment.cheque_image_url,
          card_last_four: payment.card_last_four,
          refused: payment.refused,
          notes: payment.notes,
          locked: payment.locked,
          payments: [],
          policyTypes: [],
          packagePolicies: fromPackage && fromPackage.length > 0
            ? fromPackage
            : (payment.policy
              ? [{
                  id: payment.policy.id,
                  policy_type_parent: payment.policy.policy_type_parent,
                  policy_type_child: payment.policy.policy_type_child ?? null,
                }]
              : []),
        });
      }

      const group = groups.get(groupKey)!;
      group.payments.push(payment);
      group.totalAmount += payment.amount;

      // Collect unique payment types across the batch so the row can show
      // combined labels like "نقدي + فيزا" or "نقدي + فيزا + شيكات".
      if (payment.payment_type && !group.paymentTypes.includes(payment.payment_type)) {
        group.paymentTypes.push(payment.payment_type);
      }

      // Collect unique policy types
      if (payment.policy?.policy_type_parent && !group.policyTypes.includes(payment.policy.policy_type_parent)) {
        group.policyTypes.push(payment.policy.policy_type_parent);
      }
      
      // Use earliest date if batched
      if (payment.payment_date < group.payment_date) {
        group.payment_date = payment.payment_date;
      }
      
      // If any payment in batch is refused, mark whole batch
      if (payment.refused) {
        group.refused = true;
      }
      
      // If any payment is locked, mark whole batch
      if (payment.locked) {
        group.locked = true;
      }
    }
    
    // Sort by date descending
    return Array.from(groups.values()).sort((a, b) =>
      new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
    );
  }, [payments, paymentSearch, paymentTypeFilter, policies]);

  // Re-open the PaymentGroupDetailsDialog with the freshest version of
  // the group the user was drilled into. Runs whenever groupedPayments
  // changes (e.g. after a refetch following save/delete) AND a reopen
  // is pending AND no inner dialog is still mounted. The key stays
  // "sticky" while the popup is open so every subsequent refetch also
  // re-syncs the displayed group — otherwise the popup would show a
  // stale cached copy that was captured before the fetches resolved.
  // If the group has been emptied entirely (every payment deleted) we
  // just clear the pending key without reopening.
  useEffect(() => {
    if (!pendingReopenGroupKey) return;
    if (editPaymentDialogOpen || deletePaymentDialogOpen) return;
    const fresh = groupedPayments.find((g) => g.id === pendingReopenGroupKey);
    if (fresh) {
      setGroupDetailsGroup(fresh);
      setGroupDetailsOpen(true);
    } else {
      setPendingReopenGroupKey(null);
    }
  }, [pendingReopenGroupKey, groupedPayments, editPaymentDialogOpen, deletePaymentDialogOpen]);

  // Loading skeleton
  if (initialLoading) {
    return (
      <MainLayout>
        <Helmet>
          <title>{client.full_name} | ثقة للتأمين</title>
        </Helmet>
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header Skeleton */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-l from-primary/10 via-primary/5 to-transparent p-6">
              <div className="flex items-start gap-4">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <Skeleton className="h-20 w-20 rounded-2xl" />
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-8 w-48" />
                  <div className="flex gap-4">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-20 rounded-full" />
                    <Skeleton className="h-6 w-28 rounded-full" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-10 w-20" />
                  <Skeleton className="h-10 w-20" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-border border-t">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="p-4 text-center space-y-2">
                  <Skeleton className="h-3 w-16 mx-auto" />
                  <Skeleton className="h-6 w-12 mx-auto" />
                </div>
              ))}
            </div>
          </Card>

          {/* Financial Cards Skeleton */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Tabs Skeleton */}
          <Card className="p-6 space-y-4">
            <div className="flex gap-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-9 w-24 rounded-lg" />
              ))}
            </div>
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Helmet>
        <title>{client.full_name} | ثقة للتأمين</title>
      </Helmet>

      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">
        {/* Professional Header Card */}
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-l from-primary/10 via-primary/5 to-transparent p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
              {/* Identity block — back button + avatar + client info */}
              <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                {returnPath ? (
                  <Button variant="outline" onClick={onBack} className="mt-1 gap-2 px-2 sm:px-3 shrink-0" size="sm">
                    <ArrowRight className="h-4 w-4" />
                    <span className="text-sm hidden sm:inline">
                      {returnTab === 'renewed' ? 'العودة للتجديدات' :
                       returnTab === 'renewals' ? 'العودة للتجديدات' :
                       'العودة للتقارير'}
                    </span>
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" onClick={onBack} className="mt-1 shrink-0">
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                )}

                {/* Avatar */}
                <div className="relative shrink-0">
                  {client.image_url ? (
                    <img
                      src={client.image_url}
                      alt={client.full_name}
                      className="h-14 w-14 sm:h-20 sm:w-20 rounded-2xl object-cover border-4 border-background shadow-lg"
                    />
                  ) : (
                    <div className="h-14 w-14 sm:h-20 sm:w-20 rounded-2xl bg-primary/10 border-4 border-background shadow-lg flex items-center justify-center">
                      <User className="h-7 w-7 sm:h-10 sm:w-10 text-primary" />
                    </div>
                  )}
                  {(client.under24_type !== 'none' && client.under24_type) && (
                    <Badge className="absolute -bottom-2 -right-2 bg-amber-500 text-white text-[10px] px-1.5">-24</Badge>
                  )}
                </div>

                {/* Client Info */}
                <div className="flex-1 min-w-0">
                  <h1 className="text-lg sm:text-2xl font-bold truncate">{client.full_name}</h1>
                  <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 text-xs sm:text-sm text-muted-foreground mt-1 sm:mt-2">
                    <span className="flex items-center gap-1.5 font-mono">
                      <Hash className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                      {client.id_number}
                    </span>
                    {client.phone_number && (
                      <ClickablePhone phone={client.phone_number} />
                    )}
                    {client.phone_number_2 && (
                      <ClickablePhone phone={client.phone_number_2} className="text-muted-foreground/70" />
                    )}
                    {client.file_number && (
                      <span className="flex items-center gap-1.5">
                        <FileText className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                        ملف: {client.file_number}
                      </span>
                    )}
                    {client.birth_date && (
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                        {formatDate(client.birth_date)}
                      </span>
                    )}
                  </div>

                  {/* Badges row */}
                  <div className="mt-2 sm:mt-3 flex flex-wrap gap-1.5 sm:gap-2">
                    {client.branch_id && (
                      <Badge variant="secondary" className="gap-1.5 bg-primary/10 text-primary border-primary/20 text-[10px] sm:text-xs">
                        <Building2 className="h-3 w-3" />
                        {getBranchName(client.branch_id)}
                      </Badge>
                    )}
                    {broker && (
                      <Badge variant="outline" className="gap-1.5 bg-background text-[10px] sm:text-xs">
                        <Users className="h-3 w-3" />
                        الوسيط: {broker.name}
                        {broker.phone && <span className="text-muted-foreground mr-1"><bdi>({broker.phone})</bdi></span>}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions — wraps below header on mobile, sits next to it on desktop */}
              <div className="flex flex-wrap gap-2 shrink-0">
                {(paymentSummary.total_remaining - walletBalance.total_refunds) > 0 && (
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5 flex-1 sm:flex-none sm:size-default"
                    onClick={() => setDebtPaymentModalOpen(true)}
                  >
                    <CreditCard className="h-4 w-4" />
                    دفع
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 flex-1 sm:flex-none sm:size-default"
                  onClick={() => setAccidentWizardOpen(true)}
                >
                  <AlertTriangle className="h-4 w-4" />
                  <span>بلاغ حادث</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 flex-1 sm:flex-none sm:size-default"
                  onClick={() => setReportModalOpen(true)}
                >
                  <FileText className="h-4 w-4" />
                  <span>تقرير</span>
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 flex-1 sm:flex-none sm:size-default"
                  onClick={() => setClientDrawerOpen(true)}
                >
                  <Edit className="h-4 w-4" />
                  <span>تعديل</span>
                </Button>
              </div>
            </div>
          </div>
          
          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-border border-t">
            <div className="p-3 sm:p-4 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">رقم الملف</p>
              <p className="text-sm sm:text-lg font-bold truncate">{client.file_number || '-'}</p>
            </div>
            <div className="p-3 sm:p-4 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">تاريخ الانضمام</p>
              <p className="text-sm sm:text-lg font-bold">{formatDate(client.date_joined)}</p>
            </div>
            <div className="p-3 sm:p-4 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">السيارات</p>
              <p className="text-sm sm:text-lg font-bold text-blue-600">{cars.length}</p>
            </div>
            <div className="p-3 sm:p-4 text-center">
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">الوثائق</p>
              <p className="text-sm sm:text-lg font-bold text-purple-600">{dedupedPolicyCount}</p>
              <button
                type="button"
                onClick={handleRevealDocs}
                className="mt-0.5 text-[10px] text-purple-600 hover:text-purple-700 underline underline-offset-2 transition-colors"
              >
                عرض التفاصيل
              </button>
            </div>
            <div className="p-3 sm:p-4 text-center col-span-2 md:col-span-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">العمر</p>
              {client.under24_type === 'additional_driver' ? (
                <div className="space-y-1">
                  <Badge variant="warning" className="text-xs">سائق إضافي -24</Badge>
                  {client.under24_driver_name && (
                    <p className="text-xs text-muted-foreground">
                      {client.under24_driver_name}
                      {client.under24_driver_id && <span className="font-mono mr-1">({client.under24_driver_id})</span>}
                    </p>
                  )}
                </div>
              ) : client.under24_type === 'client' || client.less_than_24 ? (
                <Badge variant="warning" className="mt-1">أقل من 24</Badge>
              ) : (
                <Badge variant="outline" className="mt-1">24+</Badge>
              )}
            </div>
          </div>
        </Card>

        {/* Financial Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <Card className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
              <Wallet className="h-5 w-5 sm:h-6 sm:w-6 text-success" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground">إجمالي المدفوع</p>
              <p className="text-base sm:text-xl font-bold text-success truncate">₪{paymentSummary.total_paid.toLocaleString()}</p>
            </div>
          </Card>

          <Card className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertCircle className="h-5 w-5 sm:h-6 sm:w-6 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground">إجمالي المتبقي</p>
              <p className={cn("text-base sm:text-xl font-bold truncate",
                (paymentSummary.total_remaining - walletBalance.total_refunds) > 0
                  ? "text-destructive"
                  : "text-success"
              )}>
                ₪{Math.max(0, paymentSummary.total_remaining - walletBalance.total_refunds).toLocaleString()}
              </p>
              {walletBalance.total_refunds > 0 && paymentSummary.total_remaining > 0 && (
                <div className="text-[10px] text-muted-foreground space-y-0.5 mt-1">
                  <p>المطلوب: ₪{paymentSummary.total_remaining.toLocaleString()}</p>
                  <p className="text-amber-600">المرتجع: -₪{walletBalance.total_refunds.toLocaleString()}</p>
                </div>
              )}
            </div>
            <DebtIndicator
              totalOwed={paymentSummary.total_paid + paymentSummary.total_remaining}
              totalPaid={paymentSummary.total_paid + walletBalance.total_refunds}
              showAmount={false}
            />
          </Card>

          {/* Profit card - Admin only */}
          {isAdmin && (
            <Card className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
              <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] sm:text-xs text-muted-foreground">إجمالي الأرباح</p>
                <p className="text-base sm:text-xl font-bold text-primary truncate">₪{paymentSummary.total_profit.toLocaleString()}</p>
              </div>
            </Card>
          )}

          {/* Wallet Balance - Show only if we owe customer MORE than their debt (net credit) */}
          {(walletBalance.total_refunds - paymentSummary.total_remaining) > 0 && (
            <Card className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4 border-amber-500/30 bg-amber-500/5">
              <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                <Banknote className="h-5 w-5 sm:h-6 sm:w-6 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] sm:text-xs text-amber-700">مرتجع للعميل</p>
                <p className="text-base sm:text-xl font-bold text-amber-600 truncate">₪{(walletBalance.total_refunds - paymentSummary.total_remaining).toLocaleString()}</p>
                <p className="text-[10px] text-amber-600/70">نحن مدينون للعميل بهذا المبلغ</p>
              </div>
            </Card>
          )}
        </div>

        {/* Tabs — horizontal scroll on mobile, wrap on desktop */}
        <Tabs defaultValue="policies" className="w-full" dir="rtl">
          <TabsList className="w-full justify-start bg-muted/50 p-1 h-auto flex-nowrap overflow-x-auto sm:flex-wrap">
            <TabsTrigger value="overview" className="gap-1.5 shrink-0 whitespace-nowrap">
              <User className="h-4 w-4" />
              نظرة عامة
            </TabsTrigger>
            <TabsTrigger value="policies" className="gap-1.5 shrink-0 whitespace-nowrap">
              <FileText className="h-4 w-4" />
              الوثائق ({dedupedPolicyCount})
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5 shrink-0 whitespace-nowrap">
              <CreditCard className="h-4 w-4" />
              سجل الدفعات ({payments.length})
            </TabsTrigger>
            <TabsTrigger value="cars" className="gap-1.5 shrink-0 whitespace-nowrap">
              <Car className="h-4 w-4" />
              السيارات ({cars.length})
            </TabsTrigger>
            <TabsTrigger value="notes" className="gap-1.5 shrink-0 whitespace-nowrap">
              <MessageSquare className="h-4 w-4" />
              الملاحظات
            </TabsTrigger>
            <TabsTrigger value="accidents" className="gap-1.5 shrink-0 whitespace-nowrap relative">
              <AlertTriangle className="h-4 w-4" />
              بلاغات الحوادث ({accidentCount})
              {hasActiveReports && (
                <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
              )}
            </TabsTrigger>
            <TabsTrigger value="refunds" className="gap-1.5 shrink-0 whitespace-nowrap">
              <Banknote className="h-4 w-4" />
              المرتجعات
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-6">
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  بيانات العميل
                </h3>
                <dl className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b">
                    <dt className="text-muted-foreground">الاسم الكامل</dt>
                    <dd className="font-semibold">{client.full_name}</dd>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <dt className="text-muted-foreground">رقم الهوية</dt>
                    <dd className="font-mono font-semibold ltr-nums">{client.id_number}</dd>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <dt className="text-muted-foreground">رقم الهاتف</dt>
                    <dd className="font-mono ltr-nums">{client.phone_number || '-'}</dd>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <dt className="text-muted-foreground">رقم الملف</dt>
                    <dd className="font-semibold">{client.file_number || '-'}</dd>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <dt className="text-muted-foreground">تاريخ الانضمام</dt>
                    <dd>{formatDate(client.date_joined)}</dd>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <dt className="text-muted-foreground">الفئة العمرية</dt>
                    <dd>
                      {client.under24_type === 'additional_driver' ? (
                        <div className="text-left">
                          <Badge variant="warning">سائق إضافي أقل من 24</Badge>
                          {client.under24_driver_name && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {client.under24_driver_name}
                              {client.under24_driver_id && <span className="font-mono mr-1"> ({client.under24_driver_id})</span>}
                            </p>
                          )}
                        </div>
                      ) : client.under24_type === 'client' ? (
                        <Badge variant="warning">العميل أقل من 24 سنة</Badge>
                      ) : (
                        <Badge variant="outline">24 سنة فأكثر</Badge>
                      )}
                    </dd>
                  </div>
                </dl>
              </Card>
              
              {/* Signature Section */}
              <ClientSignatureSection
                clientId={client.id}
                clientName={client.full_name}
                phoneNumber={client.phone_number}
                signatureUrl={client.signature_url}
                onSignatureSent={onRefresh}
              />
            </div>

          </TabsContent>

          {/* Policies Tab */}
          <TabsContent value="policies" className="mt-6 space-y-4">
            {/* Header with Add Button */}
            <div ref={policiesHeaderRef} className="flex flex-wrap items-center justify-between gap-3 scroll-mt-20">
              <div>
                <h3 className="font-semibold text-lg">وثائق التأمين</h3>
                <button
                  type="button"
                  onClick={handleRevealDocs}
                  className="text-sm text-muted-foreground hover:text-purple-600 underline underline-offset-2 transition-colors"
                >
                  {dedupedPolicyCount} وثيقة مسجلة
                </button>
              </div>
              <Button onClick={() => setPolicyWizardOpen(true)}>
                <Plus className="h-4 w-4 ml-2" />
                إضافة وثيقة جديدة
              </Button>
            </div>
            
            {/* Car Filter Chips - Visual car selector */}
            {cars.length > 0 && (
              <Card className="p-4">
                <p className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Car className="h-4 w-4 text-primary" />
                  فلترة حسب السيارة
                </p>
                <CarFilterChips
                  cars={cars}
                  policies={policies.map(p => ({
                    car: p.car,
                    end_date: p.end_date,
                    cancelled: p.cancelled,
                    transferred: p.transferred,
                    group_id: p.group_id,
                  }))}
                  selectedCarId={policyCarFilter}
                  onSelect={setPolicyCarFilter}
                />
              </Card>
            )}
            
            {/* Additional Filters */}
            <Card className="p-4">
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث برقم الوثيقة، الشركة..."
                    value={policySearch}
                    onChange={(e) => setPolicySearch(e.target.value)}
                    className="pr-10"
                  />
                </div>
                <Select value={policyTypeFilter} onValueChange={setPolicyTypeFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="نوع التأمين" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأنواع</SelectItem>
                    {uniquePolicyTypes.map(type => (
                      <SelectItem key={type} value={type}>
                        {policyTypeLabels[type] || type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={policyStatusFilter} onValueChange={setPolicyStatusFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="الحالة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الحالات</SelectItem>
                    <SelectItem value="active">سارية</SelectItem>
                    <SelectItem value="expired">منتهية</SelectItem>
                    <SelectItem value="transferred">محولة</SelectItem>
                    <SelectItem value="cancelled">ملغاة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Card>

            {loadingPolicies ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-xl" />
                ))}
              </div>
            ) : filteredPolicies.length === 0 ? (
              <Card className="text-center py-12">
                <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground">
                  {policies.length > 0 ? 'لا توجد وثائق تطابق معايير البحث' : 'لا توجد وثائق تأمين'}
                </p>
                {policyCarFilter !== 'all' && (
                  <Button 
                    variant="link" 
                    onClick={() => setPolicyCarFilter('all')}
                    className="mt-2"
                  >
                    إظهار كل السيارات
                  </Button>
                )}
              </Card>
            ) : (
              <PolicyYearTimeline
                policies={filteredPolicies}
                clientPhone={client.phone_number}
                paymentInfo={policyPaymentInfo}
                accidentInfo={policyAccidentCounts}
                childrenInfo={policyChildrenCounts}
                onPolicyClick={handlePolicyClick}
                onPaymentAdded={async () => {
                  await Promise.all([
                    fetchPaymentSummary(),
                    fetchPayments(),
                    fetchPolicies(),
                    fetchWalletBalance(),
                  ]);
                }}
                onTransferPolicy={(policyId) => {
                  setSelectedPolicyId(policyId);
                  setPolicyDetailsOpen(true);
                }}
                onCancelPolicy={(policyId) => {
                  const p = policies.find((x) => x.id === policyId);
                  if (!p) return;
                  setCancelPolicyIds([policyId]);
                  setCancelInsurancePrice(Number(p.insurance_price) || 0);
                  setCancelPolicyNumber(p.policy_number);
                  setCancelModalOpen(true);
                }}
                onTransferPackage={(policyIds) => {
                  if (policyIds.length > 0) {
                    setSelectedPolicyId(policyIds[0]);
                    setTransferOpen(true);
                  }
                }}
                onCancelPackage={(policyIds) => {
                  if (policyIds.length === 0) return;
                  const packagePolicies = policies.filter((p) =>
                    policyIds.includes(p.id),
                  );
                  if (packagePolicies.length === 0) return;
                  // Refund ceiling excludes ELZAMI (compulsory) rows.
                  // Compulsory premiums are settled directly by the
                  // insurance company — the office can't refund that
                  // portion to the client, so letting the user enter
                  // a refund larger than the sum of the non-ELZAMI
                  // rows would guarantee a reconciliation mismatch.
                  // All sibling rows (including ELZAMI) still get
                  // marked as cancelled — the filter only affects the
                  // ceiling shown in the refund input.
                  const totalPrice = packagePolicies
                    .filter((p) => p.policy_type_parent !== 'ELZAMI')
                    .reduce(
                      (sum, p) => sum + (Number(p.insurance_price) || 0),
                      0,
                    );
                  // Use the first policy's number for labels/SMS.
                  const primary = packagePolicies[0];
                  setCancelPolicyIds(policyIds);
                  setCancelInsurancePrice(totalPrice);
                  setCancelPolicyNumber(primary.policy_number);
                  setCancelModalOpen(true);
                }}
                onDeletePolicy={isAdmin ? (policyIds) => {
                  setDeletePolicyIds(policyIds);
                  setDeletePolicyDialogOpen(true);
                } : undefined}
                onPoliciesUpdate={fetchPolicies}
                onRenewPolicy={handleRenewPolicy}
                onRenewPackage={handleRenewPackage}
                onEditPolicy={async (policyId) => {
                  // PolicyEditDrawer needs a fully hydrated policy row
                  // (clients.id, clients.less_than_24, cars.car_type/value/year,
                  // insurance_companies.id, etc.) that the timeline fetch
                  // doesn't carry. Pull the full row on demand so the
                  // drawer can render its form without guessing.
                  try {
                    const { data, error } = await supabase
                      .from('policies')
                      .select(`
                        id, group_id, policy_type_parent, policy_type_child,
                        start_date, end_date, insurance_price, cancelled,
                        transferred, transferred_car_number, is_under_24,
                        notes, broker_id,
                        clients!inner(id, full_name, less_than_24, under24_type, under24_driver_name, under24_driver_id),
                        cars(id, car_number, car_type, car_value, year),
                        insurance_companies(id, name, name_ar)
                      `)
                      .eq('id', policyId)
                      .single();
                    if (error) throw error;
                    setEditPolicyData(data);
                    setEditPolicyOpen(true);
                  } catch (e: any) {
                    console.error('Error loading policy for edit:', e);
                    toast.error(e.message || 'فشل في تحميل الوثيقة');
                  }
                }}
                onEditPackage={(groupId) => {
                  setEditPackageGroupId(groupId);
                }}
              />
            )}
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments" className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">سجل الدفعات</h3>
            </div>
            
            {/* Payment Filters */}
            <Card className="p-4">
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث في الدفعات..."
                    value={paymentSearch}
                    onChange={(e) => setPaymentSearch(e.target.value)}
                    className="pr-10"
                  />
                </div>
                <Select value={paymentTypeFilter} onValueChange={setPaymentTypeFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="طريقة الدفع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الطرق</SelectItem>
                    <SelectItem value="cash">نقدي</SelectItem>
                    <SelectItem value="cheque">شيك</SelectItem>
                    <SelectItem value="visa">بطاقة</SelectItem>
                    <SelectItem value="transfer">تحويل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Card>

            {loadingPayments ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : payments.length === 0 ? (
              <Card className="text-center py-12">
                <CreditCard className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground">لا توجد دفعات مسجلة</p>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-right">المبلغ</TableHead>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">طريقة الدفع</TableHead>
                      <TableHead className="text-right">نوع التأمين</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="text-right">ملفات</TableHead>
                      <TableHead className="text-right w-[60px]">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedPayments.map((group) => {
                      const combinedLabel = getCombinedPaymentTypeLabel(group.payments);
                      return (
                      <TableRow
                        key={group.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => {
                          setGroupDetailsGroup(group);
                          setGroupDetailsOpen(true);
                        }}
                      >
                        <TableCell className="font-semibold">
                          <div className="flex items-center gap-1">
                            ₪{group.totalAmount.toLocaleString()}
                            {group.payments.length > 1 && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                {group.payments.length} دفعات
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(group.payment_date)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline">{combinedLabel}</Badge>
                            {group.paymentTypes.includes('visa') && group.card_last_four && (
                              <span className="text-xs text-muted-foreground font-mono">
                                *{group.card_last_four}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(() => {
                              // Show every policy type in the package (via
                              // group_id → packagePolicies). Payments are
                              // attached to a single policy on the DB but a
                              // package pay really covers the whole group.
                              const seen = new Set<string>();
                              const tags: { label: string; parent: string }[] = [];
                              for (const p of group.packagePolicies) {
                                const label = getInsuranceTypeLabel(p.policy_type_parent as any, p.policy_type_child as any);
                                if (seen.has(label)) continue;
                                seen.add(label);
                                tags.push({ label, parent: p.policy_type_parent });
                              }
                              return tags.map((t) => (
                                <Badge key={t.label} className={cn("border", policyTypeColors[t.parent])}>
                                  {t.label}
                                </Badge>
                              ));
                            })()}
                          </div>
                        </TableCell>
                        <TableCell>
                          {group.refused ? (
                            <Badge variant="destructive">راجع</Badge>
                          ) : (
                            <Badge variant="success">مقبول</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <ChequeImageGallery
                            primaryImageUrl={group.cheque_image_url}
                            paymentId={group.payments[0]?.id || group.id}
                            batchPaymentIds={group.payments.map(p => p.id)}
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {/* Print all receipts for this row — one PDF when
                                  the row groups multiple payments, one per-payment
                                  PDF otherwise. */}
                              <DropdownMenuItem
                                onClick={() => handlePrintGroupReceipts(group.id, group.payments.map((p) => p.id))}
                                disabled={generatingReceipt === group.id}
                              >
                                {generatingReceipt === group.id ? (
                                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                                ) : (
                                  <Receipt className="h-4 w-4 ml-2" />
                                )}
                                {group.payments.length > 1 ? 'طباعة سندات القبض' : 'طباعة سند القبض'}
                              </DropdownMenuItem>

                              {group.payments.length === 1 ? (
                                <>
                                  <DropdownMenuItem onClick={() => handleEditPayment(group.payments[0], group)}>
                                    <Edit className="h-4 w-4 ml-2" />
                                    تعديل
                                  </DropdownMenuItem>
                                  {!group.locked && (
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => {
                                        setDeletePaymentId(group.payments[0].id);
                                        setDeletePaymentDialogOpen(true);
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 ml-2" />
                                      حذف
                                    </DropdownMenuItem>
                                  )}
                                </>
                              ) : (
                                <>
                                  <DropdownMenuItem disabled className="text-muted-foreground text-xs">
                                    دفعة مجمعة ({group.payments.length} سجلات)
                                  </DropdownMenuItem>
                                  {group.payments.map((payment) => (
                                    <DropdownMenuItem
                                      key={payment.id}
                                      onClick={() => handleEditPayment(payment, group)}
                                      className="text-sm"
                                    >
                                      <Edit className="h-3 w-3 ml-2" />
                                      <span className="flex items-center gap-1.5">
                                        تعديل: ₪{Number(payment.amount || 0).toLocaleString('en-US')}
                                        {payment.refused && (
                                          <span className="text-[10px] font-bold text-destructive border border-destructive/40 bg-destructive/10 rounded px-1 py-0">
                                            مرفوضة
                                          </span>
                                        )}
                                      </span>
                                    </DropdownMenuItem>
                                  ))}
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          {/* Cars Tab */}
          <TabsContent value="cars" className="mt-6 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setCarDrawerOpen(true)}>
                <Plus className="h-4 w-4 ml-2" />
                إضافة سيارة
              </Button>
            </div>

            {loadingCars ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : cars.length === 0 ? (
              <Card className="text-center py-12">
                <Car className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground">لا توجد سيارات مسجلة</p>
                <Button variant="link" onClick={() => setCarDrawerOpen(true)}>
                  إضافة سيارة جديدة
                </Button>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-right">رقم السيارة</TableHead>
                      <TableHead className="text-right">الشركة المصنعة</TableHead>
                      <TableHead className="text-right">الموديل</TableHead>
                      <TableHead className="text-right">السنة</TableHead>
                      <TableHead className="text-right">اللون</TableHead>
                      <TableHead className="text-right">القيمة</TableHead>
                      <TableHead className="text-right">النوع</TableHead>
                      <TableHead className="text-right">الوثائق</TableHead>
                      <TableHead className="text-right w-[60px]">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cars.map((car) => {
                      const policyCount = carPolicyCounts[car.id] || 0;
                      const canDelete = policyCount === 0;
                      
                      return (
                        <TableRow key={car.id}>
                          <TableCell className="font-mono font-semibold"><bdi>{car.car_number}</bdi></TableCell>
                          <TableCell>{car.manufacturer_name || '-'}</TableCell>
                          <TableCell>{car.model || '-'}</TableCell>
                          <TableCell>{car.year || '-'}</TableCell>
                          <TableCell>{car.color || '-'}</TableCell>
                          <TableCell>
                            {car.car_value ? (
                              <span className="font-semibold text-primary ltr-nums">₪{car.car_value.toLocaleString()}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{carTypeLabels[car.car_type || ''] || car.car_type || 'خصوصي'}</Badge>
                          </TableCell>
                          <TableCell>
                            {policyCount > 0 ? (
                              <Badge variant="secondary">{policyCount} وثيقة</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">لا يوجد</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => {
                                  setEditingCar(car);
                                  setCarDrawerOpen(true);
                                }}>
                                  <Edit className="h-4 w-4 ml-2" />
                                  تعديل
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  className={cn(
                                    "text-destructive focus:text-destructive",
                                    !canDelete && "opacity-50 cursor-not-allowed"
                                  )}
                                  disabled={!canDelete}
                                  onClick={() => {
                                    if (canDelete) {
                                      setDeleteCarId(car.id);
                                      setDeleteCarDialogOpen(true);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 ml-2" />
                                  حذف
                                  {!canDelete && <span className="text-xs mr-2">(مرتبطة بوثائق)</span>}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="mt-6 space-y-6">
            {/* Timestamped Notes Section */}
            <div>
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                سجل المتابعات والملاحظات
              </h3>
              <ClientNotesSection 
                clientId={client.id} 
                branchId={client.branch_id} 
              />
            </div>

            {/* General Notes Section (legacy) */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Edit className="h-5 w-5 text-primary" />
                  ملاحظات عامة
                </h3>
                {!editingNotes ? (
                  <Button variant="outline" size="sm" onClick={() => setEditingNotes(true)}>
                    <Edit className="h-4 w-4 ml-2" />
                    تعديل
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      onClick={handleSaveNotes}
                      disabled={savingNotes}
                    >
                      <Save className="h-4 w-4 ml-2" />
                      {savingNotes ? 'جاري الحفظ...' : 'حفظ'}
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        setEditingNotes(false);
                        setNotesValue(client.notes || '');
                      }}
                    >
                      <X className="h-4 w-4 ml-2" />
                      إلغاء
                    </Button>
                  </div>
                )}
              </div>
              
              {editingNotes ? (
                <Textarea
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  placeholder="أضف ملاحظات عامة عن العميل هنا..."
                  className="min-h-[150px] resize-none"
                  autoFocus
                />
              ) : (
                <div className="min-h-[100px] p-4 bg-muted/30 rounded-lg">
                  {client.notes ? (
                    <p className="whitespace-pre-wrap">{client.notes}</p>
                  ) : (
                    <p className="text-muted-foreground text-center py-8">
                      لا توجد ملاحظات عامة. اضغط "تعديل" لإضافة ملاحظات.
                    </p>
                  )}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Accidents Tab */}
          <TabsContent value="accidents" className="mt-6">
            <ClientAccidentsTab
              clientId={client.id}
              accidentNotes={client.accident_notes}
              onAccidentNotesUpdated={onRefresh}
            />
          </TabsContent>

          {/* Refunds Tab */}
          <TabsContent value="refunds" className="mt-6">
            <RefundsTab 
              clientId={client.id}
              branchId={client.branch_id}
              onRefundAdded={() => {
                fetchWalletBalance();
              }}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Add/Edit Car Drawer */}
      <CarDrawer
        open={carDrawerOpen}
        onOpenChange={(open) => {
          setCarDrawerOpen(open);
          if (!open) setEditingCar(null);
        }}
        clientId={client.id}
        car={editingCar}
        onSaved={handleCarSaved}
      />

      {/* Policy Details Drawer */}
      <PolicyDetailsDrawer
        open={policyDetailsOpen}
        onOpenChange={setPolicyDetailsOpen}
        policyId={selectedPolicyId}
        onUpdated={() => {
          fetchPolicies();
          fetchPaymentSummary();
          fetchPayments();
        }}
        onViewRelatedPolicy={(newPolicyId) => {
          setSelectedPolicyId(newPolicyId);
        }}
      />

      {/* Policy Wizard for creating new policy */}
      <PolicyWizard
        open={policyWizardOpen}
        onOpenChange={(open) => {
          setPolicyWizardOpen(open);
          // Clear renewal data when wizard closes
          if (!open) {
            setRenewalData(null);
          }
        }}
        preselectedClientId={client.id}
        renewalData={renewalData}
        onSaved={async () => {
          setPolicyWizardOpen(false);
          setRenewalData(null);
          // Delay to ensure DB commits are complete before fetching
          await new Promise(resolve => setTimeout(resolve, 200));
          // Fetch all data in parallel
          await Promise.all([
            fetchPolicies(),
            fetchPaymentSummary(),
            fetchPayments(),
            fetchCars(),
          ]);
          // Force state update and refresh
          onRefresh();
        }}
      />

      {/* Client Edit Drawer */}
      <ClientDrawer
        open={clientDrawerOpen}
        onOpenChange={setClientDrawerOpen}
        client={client}
        onSaved={() => {
          setClientDrawerOpen(false);
          onRefresh();
          fetchBroker();
        }}
      />

      {/* Client Report Modal */}
      <ClientReportModal
        open={reportModalOpen}
        onOpenChange={setReportModalOpen}
        client={client}
        cars={cars}
        policies={policies}
        paymentSummary={paymentSummary}
        walletBalance={walletBalance}
        broker={broker}
        branchName={client.branch_id ? getBranchName(client.branch_id) : null}
      />

      {/* Transfer Policy Modal - for package/policy transfer from timeline */}
      {selectedPolicyId && (() => {
        const selectedPolicy = policies.find(p => p.id === selectedPolicyId);
        const selectedCar = selectedPolicy?.car ? cars.find(c => c.id === selectedPolicy.car?.id) : null;
        return (
          <TransferPolicyModal
            open={transferOpen}
            onOpenChange={setTransferOpen}
            policyId={selectedPolicyId}
            policyNumber={selectedPolicy?.policy_number || null}
            policyType={selectedPolicy?.policy_type_parent || ''}
            groupId={selectedPolicy?.group_id || null}
            clientId={client.id}
            clientName={client.full_name}
            clientPhone={client.phone_number}
            branchId={client.branch_id}
            currentCar={selectedCar ? {
              id: selectedCar.id,
              car_number: selectedCar.car_number,
              model: selectedCar.model || null,
              year: selectedCar.year || null,
              manufacturer_name: selectedCar.manufacturer_name || null,
            } : null}
            onTransferred={async () => {
              setTransferOpen(false);
              // Small delay to ensure DB commits are complete
              await new Promise(resolve => setTimeout(resolve, 100));
              await Promise.all([
                fetchPolicies(),
                fetchPaymentSummary(),
                fetchPayments(),
              ]);
              onRefresh();
            }}
          />
        );
      })()}

      {/* Policy edit drawer — opened directly from the timeline dropdown
          for single policies. Needs a fully hydrated policy object, so
          the dropdown handler fetches the row on demand before opening. */}
      {editPolicyData && (
        <PolicyEditDrawer
          open={editPolicyOpen}
          onOpenChange={(open) => {
            setEditPolicyOpen(open);
            if (!open) setEditPolicyData(null);
          }}
          policy={editPolicyData}
          onSaved={async () => {
            setEditPolicyOpen(false);
            setEditPolicyData(null);
            await fetchPolicies();
          }}
        />
      )}

      {/* Package edit modal — opened directly from the timeline dropdown
          for package rows. It fetches every sibling in the group itself,
          so it only needs the groupId. */}
      <PackagePolicyEditModal
        open={!!editPackageGroupId}
        onOpenChange={(open) => {
          if (!open) setEditPackageGroupId(null);
        }}
        groupId={editPackageGroupId}
        onSaved={async () => {
          setEditPackageGroupId(null);
          await fetchPolicies();
        }}
      />

      {/* Cancel policy / package modal — opened directly from the
          PolicyYearTimeline dropdown so the user doesn't have to walk
          through the details drawer first. */}
      <CancelPolicyModal
        open={cancelModalOpen}
        onOpenChange={(o) => {
          setCancelModalOpen(o);
          if (!o) {
            setCancelPolicyIds([]);
            setCancelInsurancePrice(0);
            setCancelPolicyNumber(null);
          }
        }}
        policyIds={cancelPolicyIds}
        policyNumber={cancelPolicyNumber}
        clientId={client.id}
        clientName={client.full_name}
        clientPhone={client.phone_number}
        branchId={client.branch_id}
        insurancePrice={cancelInsurancePrice}
        onCancelled={async () => {
          setCancelModalOpen(false);
          setCancelPolicyIds([]);
          setCancelInsurancePrice(0);
          setCancelPolicyNumber(null);
          await Promise.all([
            fetchPolicies(),
            fetchPaymentSummary(),
          ]);
        }}
      />

      {/* Debt Payment Modal */}
      <DebtPaymentModal
        open={debtPaymentModalOpen}
        onOpenChange={setDebtPaymentModalOpen}
        clientId={client.id}
        clientName={client.full_name}
        clientPhone={client.phone_number}
        totalOwed={paymentSummary.total_remaining}
        onSuccess={async () => {
          setDebtPaymentModalOpen(false);
          // Refresh all payment-related data
          await Promise.all([
            fetchPaymentSummary(),
            fetchPayments(),
            fetchPolicies(),
          ]);
        }}
      />

      {/* Payment Edit Dialog */}
      <PaymentEditDialog
        open={editPaymentDialogOpen}
        onOpenChange={(o) => {
          setEditPaymentDialogOpen(o);
          if (!o) setEditingGroupPolicies(undefined);
        }}
        payment={editingPayment}
        packagePolicies={editingGroupPolicies}
        onSuccess={async () => {
          setEditingPayment(null);
          setEditingGroupPolicies(undefined);
          // Refresh every surface that reads from payments: the payments
          // tab itself, the financial summary, and the policies list that
          // backs the PolicyYearTimeline paid/remaining numbers. Without
          // the fetchPolicies call the policy cards stay stuck on the
          // pre-edit amounts until the user hard-refreshes.
          await Promise.all([
            fetchPaymentSummary(),
            fetchPayments(),
            fetchPolicies(),
          ]);
        }}
      />

      {/* Grouped payment details — opens when a row in the payments table is clicked */}
      <PaymentGroupDetailsDialog
        open={groupDetailsOpen}
        onOpenChange={(o) => {
          setGroupDetailsOpen(o);
          if (!o) {
            setGroupDetailsGroup(null);
            // User explicitly closed the popup — drop any lingering
            // reopen intent so refetches don't resurrect it.
            setPendingReopenGroupKey(null);
          }
        }}
        group={groupDetailsGroup}
        onEdit={(payment) => {
          setPendingReopenGroupKey(groupDetailsGroup?.id ?? null);
          handleEditPayment(payment as any, groupDetailsGroup ?? undefined);
        }}
        onDelete={(payment) => {
          setPendingReopenGroupKey(groupDetailsGroup?.id ?? null);
          setDeletePaymentId(payment.id);
          setDeletePaymentDialogOpen(true);
        }}
      />

      {/* Super Admin: Delete Policy Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deletePolicyDialogOpen}
        onOpenChange={(open) => {
          setDeletePolicyDialogOpen(open);
          if (!open) setDeletePolicyIds([]);
        }}
        onConfirm={handleDeletePolicy}
        title="حذف الوثيقة نهائياً"
        description={`هل أنت متأكد من حذف ${deletePolicyIds.length > 1 ? `${deletePolicyIds.length} وثائق` : 'هذه الوثيقة'} نهائياً؟ سيتم حذف جميع البيانات المرتبطة (الدفعات، القيود المحاسبية، الملفات). هذا الإجراء لا يمكن التراجع عنه!`}
        loading={deletingPolicy}
      />

      {/* Delete Car Confirmation Dialog */}
      <AlertDialog open={deleteCarDialogOpen} onOpenChange={setDeleteCarDialogOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف السيارة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذه السيارة؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2">
            <AlertDialogCancel onClick={() => setDeleteCarId(null)}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCar}
              disabled={deletingCar}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingCar ? 'جاري الحذف...' : 'حذف'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Payment Confirmation Dialog */}
      <AlertDialog open={deletePaymentDialogOpen} onOpenChange={setDeletePaymentDialogOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الدفعة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذه الدفعة؟ سيتم تحديث الرصيد المتبقي للعميل.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2">
            <AlertDialogCancel onClick={() => setDeletePaymentId(null)}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePayment}
              disabled={deletingPayment}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingPayment ? 'جاري الحذف...' : 'حذف'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Accident Report Wizard */}
      <AccidentReportWizard
        open={accidentWizardOpen}
        onOpenChange={setAccidentWizardOpen}
        preselectedClient={{
          id: client.id,
          full_name: client.full_name,
          id_number: client.id_number,
          file_number: client.file_number,
          phone_number: client.phone_number,
        }}
      />
    </MainLayout>
  );
}
