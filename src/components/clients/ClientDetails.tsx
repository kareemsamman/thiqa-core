import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { useRecentClient } from '@/hooks/useRecentClient';
import { useSidebarState } from '@/hooks/useSidebarState';
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  IdCard,
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
  FolderOpen,
  DollarSign,
  MessageSquare,
  Loader2,
  Receipt,
  AlertTriangle,
  Handshake,
  Lock,
  Sparkles,
  Ban,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CarDrawer } from '@/components/cars/CarDrawer';
import { PolicyDetailsDrawer } from '@/components/policies/PolicyDetailsDrawer';
import { TransferPolicyModal } from '@/components/policies/TransferPolicyModal';
import { CancelPolicyModal } from '@/components/policies/CancelPolicyModal';
import { VoucherSendDialog, type VoucherKind } from '@/components/policies/VoucherSendDialog';
import { PolicyWizard } from '@/components/policies/PolicyWizard';
import { PackagePolicyEditModal } from '@/components/policies/PackagePolicyEditModal';
import { ClientDrawer } from '@/components/clients/ClientDrawer';
import { ClientSignatureSection } from '@/components/clients/ClientSignatureSection';
import { PolicyYearTimeline } from '@/components/clients/PolicyYearTimeline';
import { CustomerStatementModal } from '@/components/clients/CustomerStatementModal';
import { CarFilterChips } from '@/components/clients/CarFilterChips';
import { ExpiryBadge } from '@/components/shared/ExpiryBadge';
import { ClickablePhone } from '@/components/shared/ClickablePhone';
import { DebtIndicator } from '@/components/shared/DebtIndicator';
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog';
import { PrintProgressDialog } from '@/components/shared/PrintProgressDialog';
import { DebtPaymentModal } from '@/components/debt/DebtPaymentModal';
import { DebtPaymentSuccessDialog } from '@/components/debt/DebtPaymentSuccessDialog';
import { ClientNotesSection } from '@/components/clients/ClientNotesSection';
import { PaymentEditDialog } from '@/components/clients/PaymentEditDialog';
import { PaymentGroupDetailsDialog } from '@/components/clients/PaymentGroupDetailsDialog';
import { getCombinedPaymentTypeLabel, getPaymentTypeLabel, PAYMENT_TYPE_LABELS } from '@/lib/paymentLabels';
import { AccountingFilters, type AccountingFiltersValue } from '@/components/accounting/AccountingFilters';
import { RefundsTab } from '@/components/clients/RefundsTab';
import { ClientFilesTab, type ClientFilesPolicyRef } from '@/components/clients/ClientFilesTab';
import { AccidentReportWizard } from '@/components/accident-reports/AccidentReportWizard';
import { ClientAccidentsTab } from '@/components/clients/ClientAccidentsTab';
import { useClientAccidentInfo } from '@/hooks/useClientAccidentInfo';
import { cn } from '@/lib/utils';
import { pickPackageDocumentNumber } from '@/lib/packageDocumentNumber';
import { getInsuranceTypeLabel } from '@/lib/insuranceTypes';
import { ChequeImageGallery } from '@/components/shared/ChequeImageGallery';
import { useBranches } from '@/hooks/useBranches';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useShortcutAction } from '@/hooks/useShortcutAction';
import { useAgentLimits } from '@/hooks/useAgentLimits';
import { useUpgradePrompt } from '@/components/pricing/UpgradePromptProvider';
import { usePolicyWizardController } from '@/hooks/usePolicyWizardController';
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

interface BrokerDebtInfo {
  brokerId: string;
  brokerName: string;
  amount: number;
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
  // True when the payment has at least one row in `payment_images`.
  // cheque_image_url only covers scanned cheques, so uploaded receipts
  // (the "add a file" flow) would otherwise stay invisible in the outer
  // payments-log row even though the details dialog can see them.
  has_images?: boolean;
  card_last_four: string | null;
  refused: boolean | null;
  notes: string | null;
  locked: boolean | null;
  policy_id: string;
  batch_id: string | null;
  payment_session_id: string | null;
  receipt_number: string | null;
  printed_at: string | null;
  created_at: string | null;
  policy: {
    id: string;
    policy_type_parent: string;
    policy_type_child?: string | null;
    insurance_price: number;
    group_id?: string | null;
    document_number?: string | null;
  } | null;
}

// Grouped payment for display — one row per physical receipt.
// Multi-split cheques (تسديد المبلغ allocator splits one cheque
// across N policies, all sharing the same batch_id) collapse into
// one row at the cheque's face value. Single-policy payments stay
// as their own row keyed by payment.id. The transaction grouping
// the page used to do (by policy.group_id) is gone — the customer
// payment-history view now matches the cheques-page and receipts-
// page "physical payment = one row" rule.
interface GroupedPayment {
  id: string; // batch_id or individual payment id
  receipt_number: string | null; // first split's receipt_number (R85/2026 etc.)
  totalAmount: number;
  payment_date: string;
  payment_type: string; // same across all splits in a batch
  paymentTypes: string[]; // historical; for a batch it's just [payment_type]
  cheque_number: string | null;
  cheque_image_url: string | null;
  card_last_four: string | null;
  refused: boolean | null;
  notes: string | null;
  locked: boolean | null;
  // True when ANY payment in the row has been printed (printed_at set).
  // Locks the "تعديل" entry on the dropdown — printed receipts are
  // immutable per the accountant's rule; only إلغاء stays available.
  printed: boolean;
  // True when the row represents money the office didn't actually
  // collect (payment_type='visa_external' or ELZAMI passthrough).
  // Renders as a read-only informational row — no سند number, no
  // edit / cancel actions, just shows the amount so the bookkeeper
  // sees the customer's total payment picture. The print/cancel
  // scope resolvers still exclude these rows from the office's
  // كشف قبض.
  isPassthrough: boolean;
  // Latest created_at across the group's rows — used to sort the
  // payment log strictly by "when the bookkeeper added the entry".
  // The user explicitly wants newest-on-top regardless of passthrough
  // vs. real-collection status; payment_date alone is the user-entered
  // value (which can be back-dated) and would not match that intent.
  latestCreatedAt: string;
  payments: PaymentRecord[]; // Individual splits in this batch (or one row when not batched)
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
  const { can } = usePermissions();
  // QueryClient drives the cross-mount cache used by the fetchX
  // wrappers below — leaving and returning to the same client within
  // ~30s replays cached state instead of re-running the queries. The
  // wrapper pattern (see fetchPaymentSummary header) is preferred
  // over a full useQuery rewrite because the existing setters are
  // referenced by ~30 sites in this file, and the wrapper keeps the
  // setState contract intact while just gating network round-trips.
  //
  // Cache check is gated to the INITIAL load only — post-mutation
  // refreshes (after saving a payment, editing a policy, etc.) always
  // bypass cache so the user sees fresh data immediately. The ref
  // resets on every client.id change (loadInitialData sets it false
  // at start, true after Promise.all completes).
  const queryClient = useQueryClient();
  const initialLoadDoneRef = useRef(false);
  // Total-profit card is gated by view_financial. Delete-policy button
  // below stays on isAdmin (action-level, outside this refactor's
  // page-level permission model).
  const canViewFinancial = can('view_financial');
  const { setRecentClient } = useRecentClient();
  // Sidebar-aware content width: when the sidebar is collapsed there's
  // ~10rem of extra horizontal room, so let the client profile stretch
  // wider to use it. Expanded sidebar keeps the old 6xl cap so layouts
  // with a lot of body copy stay readable.
  const { collapsed: sidebarCollapsed } = useSidebarState();
  const { count: accidentCount, hasActiveReports } = useClientAccidentInfo(client.id);
  const [cars, setCars] = useState<CarRecord[]>([]);
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const policiesHeaderRef = useRef<HTMLDivElement>(null);
  // Controlled tabs so a click in the payments log can jump to المعاملات
  // and scroll the target card into view. Default matches the previous
  // defaultValue.
  const [activeTab, setActiveTab] = useState<string>('policies');
  const [systemFilesCount, setSystemFilesCount] = useState(0);
  const [clientFilesCount, setClientFilesCount] = useState(0);

  // Jump from the payments log to the المعاملات tab and scroll the card
  // owning this policy into view. Policy cards in PolicyYearTimeline tag
  // themselves with `data-policy-ids="<id> <id> ..."` so a single package
  // card is reachable from any of its member policies via the `~=` word
  // selector.
  const scrollToPolicyCard = (policyId: string) => {
    setActiveTab('policies');
    window.setTimeout(() => {
      const card = document.querySelector<HTMLElement>(
        `[data-policy-ids~="${policyId}"]`
      );
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.remove('highlight-pulse');
      void card.offsetWidth;
      card.classList.add('highlight-pulse');
      window.setTimeout(() => card.classList.remove('highlight-pulse'), 3100);
    }, 250);
  };

  // Scroll to the policies section and run a 3-second attention pulse on
  // every #N document-number chip so the user can see which concrete rows
  // the "المعاملات" stat is counting. Re-clicks restart the animation via a
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
  // payment_id → { voucher_number, reason } for refused payments. Read from
  // the receipts table (receipt_type='cancellation') so a cancelled row in
  // the payment log can render the linked سند الإلغاء number + the
  // bookkeeper's stated reason. Empty for non-refused payments.
  const [cancellationInfo, setCancellationInfo] = useState<
    Map<string, { voucherNumber: number | string; reason: string | null; year: number }>
  >(new Map());
  // First-class سند إلغاء entries — one per cancelled session, NOT
  // per refused row. Rendered as their own rows in سجل الدفعات so the
  // bookkeeper can see them next to the original سند قبض and trigger
  // a separate print for just the cancellation voucher (per the user's
  // rule: "one cancelled سند = the original visible AND the إلغاء
  // visible AND a print button on the إلغاء").
  const [cancellationVouchers, setCancellationVouchers] = useState<Array<{
    id: string;                 // canonical cancellation receipt's row id
    voucherNumber: string;      // canonical (smallest) R-number for the voucher
    sourceReceiptNumber: string | null;  // original سند قبض's R-number
    sourceGroupId: string;      // payment_session_id || batch_id || payment.id
    cancelledPaymentIds: string[];
    amount: number;             // total cancelled
    reason: string | null;
    date: string;               // cancellation receipt's date
    sortDate: string;           // for chronological merge with payment groups
  }>>([]);
  // اشعار دائن (credit notes): formal voucher rows created by
  // CancelPolicyModal / TransferPolicyModal when the agency owes the
  // client money. Shown inline in سجل الدفعات alongside payments and
  // cancellation vouchers so the bookkeeper sees the full picture of
  // the customer's account in one place.
  const [creditNotes, setCreditNotes] = useState<Array<{
    id: string;            // receipts.id of the credit_note row
    voucherNumber: string; // C{nn}/YYYY pre-formatted
    amount: number;
    date: string;          // receipt_date
    sortDate: string;      // created_at, drives newest-first merge
    description: string | null;  // notes column (e.g. "مرتجع إلغاء معاملة 12/2026")
  }>>([]);
  // اشعار مدين — same shape as credit notes but the customer OWES
  // the office (manual_debit wallet entry + receipt_type='debit_note',
  // M{nn}/YYYY voucher number). Lives in its own bucket so the
  // payment-log row can render with the rose/debt-side styling.
  const [debitNotes, setDebitNotes] = useState<Array<{
    id: string;
    voucherNumber: string; // M{nn}/YYYY
    amount: number;
    date: string;
    sortDate: string;
    description: string | null;
  }>>([]);
  // سند صرف rows — same shape as credit notes but for actual cash
  // disbursed (refund-on-cancel/transfer or manual). The amount
  // here doesn't carry into wallet balance (the agency literally
  // paid the customer); سجل الدفعات shows it so the bookkeeper
  // can prove the money left.
  const [disbursements, setDisbursements] = useState<Array<{
    id: string;
    voucherNumber: string; // D{nn}/YYYY
    amount: number;
    date: string;
    sortDate: string;
    description: string | null;
    paymentMethod: string | null;  // 'cash' / 'cheque' / 'transfer' / 'visa'
  }>>([]);
  const [broker, setBroker] = useState<Broker | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary>({ total_paid: 0, total_remaining: 0, total_profit: 0 });
  const [brokerDebts, setBrokerDebts] = useState<BrokerDebtInfo[]>([]);
  const [walletBalance, setWalletBalance] = useState<WalletBalance>({ total_refunds: 0, transaction_count: 0 });
  const [reconciliationAlerts, setReconciliationAlerts] = useState<Array<{
    id: string;
    alert_type: string;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingCars, setLoadingCars] = useState(true);
  const [loadingPolicies, setLoadingPolicies] = useState(true);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [carDrawerOpen, setCarDrawerOpen] = useState(false);
  const [policyDetailsOpen, setPolicyDetailsOpen] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  // Drawer can open on either the main tab or jump straight to files —
  // the "ملفات (N)" button on the card uses the latter.
  const [policyDetailsInitialSection, setPolicyDetailsInitialSection] =
    useState<'main' | 'files'>('main');
  const [policyWizardOpen, setPolicyWizardOpen] = useState(false);
  const { policies: policiesLimit, loading: limitsLoading } = useAgentLimits();
  const { showUpgradePrompt } = useUpgradePrompt();
  const { openWizard } = usePolicyWizardController();
  // Only commit to the locked variant once limits resolve, matching the
  // flash-free pattern used on the header "معاملة جديدة" button.
  const policiesLocked = !limitsLoading && policiesLimit.exceeded;
  const openPolicyWizardGated = () => {
    // Drop clicks during hydration — we don't know the real quota yet.
    if (limitsLoading) return;
    if (policiesLimit.exceeded) {
      showUpgradePrompt({
        resource: 'policies',
        current: policiesLimit.used,
        limit: policiesLimit.effective ?? 0,
      });
      return;
    }
    // Route through the global wizard controller (same path as the
    // header "معاملة جديدة" button). Using the local PolicyWizard
    // here was losing the client preselection because two wizard
    // instances were mounted at once and they fought over state.
    // The controller spawns a fresh instance with our client id and
    // the GlobalPolicyWizardHost renders it cleanly.
    openWizard({ clientId: client.id });
  };
  const [clientDrawerOpen, setClientDrawerOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);

  // "Edit client" shortcut: this component is the single place that
  // owns the edit drawer for a specific client, so the handler can
  // call the setter directly. It's scoped to whichever profile is
  // currently mounted, which is exactly the intent.
  useShortcutAction(
    'edit_client',
    useCallback(() => setClientDrawerOpen(true), []),
  );
  const [transferOpen, setTransferOpen] = useState(false);
  const [debtPaymentModalOpen, setDebtPaymentModalOpen] = useState(false);
  // When set, the DebtPaymentModal opens in "edit a سند قبض" mode:
  // it pre-loads the session's existing rows, treats the session's
  // existing total as available wallet room, and on submit DELETEs
  // the session's old rows before re-inserting. The accounting rule
  // (set by the user) is "tear up the unprinted draft and rewrite"
  // — there is no per-row UPDATE path. Cleared every time the modal
  // closes so the next plain "دفع" click goes back to add mode.
  const [debtModalEditingSession, setDebtModalEditingSession] =
    useState<import('@/components/debt/DebtPaymentModal').DebtPaymentEditingSession | null>(null);
  // Post-submit "طباعة / إرسال سند القبض" dialog — same flow as
  // DebtTracking page: capture payment_ids from DebtPaymentModal's
  // onSuccess so the user picks the channel (print/SMS/WhatsApp)
  // instead of an auto-send. Empty paymentIds (edit mode) skip the
  // dialog since there's no new receipt to send.
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [receiptPaymentIds, setReceiptPaymentIds] = useState<string[]>([]);
  // Same flow but for إشعار دائن / سند صرف vouchers produced by
  // cancel/transfer. Either modal's success callback hands us
  // { kind, receiptId } when a refund leg actually wrote a voucher,
  // and we open VoucherSendDialog to let the agent print / SMS /
  // WhatsApp it to the customer.
  const [voucherDialogOpen, setVoucherDialogOpen] = useState(false);
  const [voucherDialogPayload, setVoucherDialogPayload] = useState<
    { kind: VoucherKind; receiptId: string } | null
  >(null);
  // Cancel policy/package modal — opened directly from the dropdown on
  // PolicyYearTimeline instead of going through the details drawer.
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelPolicyIds, setCancelPolicyIds] = useState<string[]>([]);
  const [cancelInsurancePrice, setCancelInsurancePrice] = useState(0);
  const [cancelPolicyNumber, setCancelPolicyNumber] = useState<string | null>(null);
  const [cancelDocumentNumber, setCancelDocumentNumber] = useState<string | null>(null);

  // Edit policy/package modals — opened directly from the dropdown so
  // the user skips the "open drawer, find edit button" dance. Both
  // single and package edits go through PackagePolicyEditModal: pass
  // policyId for single rows, groupId for packages.
  const [editPolicyOpen, setEditPolicyOpen] = useState(false);
  const [editPolicyId, setEditPolicyId] = useState<string | null>(null);
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
  // Per-policy file counts (media_files where entity_id = policy.id +
  // entity_type ∈ {policy, policy_insurance, policy_file}). Drives the
  // "ملفات (N)" button on each policy card, which opens the details
  // drawer pre-positioned to the files tab. Bulk-fetched alongside
  // payment / accident / children metadata.
  const [policyFileCounts, setPolicyFileCounts] = useState<Record<string, number>>({});
  
  // Payment delete state
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [deletePaymentDialogOpen, setDeletePaymentDialogOpen] = useState(false);
  const [groupDetailsOpen, setGroupDetailsOpen] = useState(false);
  const [groupDetailsGroup, setGroupDetailsGroup] = useState<GroupedPayment | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);

  // Cancel-payment-receipt state — mirrors the receipts page flow.
  // Cancellation is always customer-scope: voids every non-إلزامي /
  // non-visa_external payment of this customer + every batch sibling
  // so a physical cheque can't end up half-cancelled. The dialog
  // shows the resolved count + total before the user confirms.
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [cancelReasonText, setCancelReasonText] = useState('');
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [cancelTargetIds, setCancelTargetIds] = useState<string[]>([]);
  const [cancelTargetSum, setCancelTargetSum] = useState<number>(0);
  const [cancelResolving, setCancelResolving] = useState(false);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
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
  // Date range + voucher kind + payment method filters live in the
  // AccountingFilters popover (same UX as /receipts). companies stays
  // unused here — the dynamic options below leave it hidden.
  const [paymentFilters, setPaymentFilters] = useState<AccountingFiltersValue>({
    dateFrom: '',
    dateTo: '',
    companies: [],
    types: [],
    paymentMethods: [],
  });
  
  // Comprehensive invoice state
  
  // Individual payment receipt state
  const [generatingReceipt, setGeneratingReceipt] = useState<string | null>(null);
  // Shared print-progress overlay state — same UX as the Receipts page.
  // Ticker creeps the bar toward 90% while the edge function runs, then
  // snaps to 100 just before window.open. Title swaps between the two
  // print paths (سند قبض vs سند إلغاء) so the bookkeeper sees what's
  // actually being prepared.
  const [printProgress, setPrintProgress] = useState<{
    open: boolean;
    value: number;
    title?: string;
  }>({ open: false, value: 0 });
  
  // Accident report wizard state
  const [accidentWizardOpen, setAccidentWizardOpen] = useState(false);

  // Renewal state
  const [renewalData, setRenewalData] = useState<RenewalData | null>(null);

  const fetchBroker = async () => {
    if (!client.broker_id) {
      setBroker(null);
      return;
    }
    // Cache replay on re-mount. Broker rarely changes for a given
    // client; the 30s TTL is conservative but keeps the chrome
    // instant on re-visit. Keyed by broker_id so switching clients
    // who share a broker also short-circuits.
    const cacheKey = ['client-broker', client.broker_id];
    const cacheState = queryClient.getQueryState(cacheKey);
    const cached = queryClient.getQueryData<Broker>(cacheKey);
    if (!initialLoadDoneRef.current && cached && cacheState?.dataUpdatedAt && Date.now() - cacheState.dataUpdatedAt < 30 * 1000) {
      setBroker(cached);
      return;
    }
    try {
      const { data } = await supabase
        .from('brokers')
        .select('id, name, phone')
        .eq('id', client.broker_id)
        .single();
      if (data) {
        queryClient.setQueryData(cacheKey, data);
        setBroker(data);
      } else setBroker(null);
    } catch (error) {
      console.error('Error fetching broker:', error);
      setBroker(null);
    }
  };

  const fetchCars = async () => {
    // Cache replay on re-mount (see fetchPaymentSummary header).
    const cacheKey = ['client-cars', client.id];
    const cacheState = queryClient.getQueryState(cacheKey);
    const cached = queryClient.getQueryData<CarRecord[]>(cacheKey);
    if (!initialLoadDoneRef.current && cached && cacheState?.dataUpdatedAt && Date.now() - cacheState.dataUpdatedAt < 30 * 1000) {
      setCars(cached);
      setLoadingCars(false);
      return;
    }
    setLoadingCars(true);
    try {
      const { data, error } = await supabase
        .from('cars')
        .select('id, car_number, client_id, manufacturer_name, model, model_number, year, color, car_type, car_value, license_type, license_expiry, last_license')
        .eq('client_id', client.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const rows = (data || []) as CarRecord[];
      queryClient.setQueryData(cacheKey, rows);
      setCars(rows);
    } catch (error) {
      console.error('Error fetching cars:', error);
    } finally {
      setLoadingCars(false);
    }
  };

  const fetchPolicies = async () => {
    // Cache replay on re-mount. fetchPolicies is the heaviest
    // deferred read (one RPC + all the joins) — caching it makes
    // returning to a recently-viewed client's policies tab instant.
    type CachedPolicies = {
      policies: PolicyRecord[];
      paymentInfo: Record<string, { paid: number; remaining: number }>;
      accCounts: Record<string, number>;
      childCounts: Record<string, number>;
      fileCounts: Record<string, number>;
      carCounts: Record<string, number>;
    };
    const cacheKey = ['client-policies', client.id];
    const cacheState = queryClient.getQueryState(cacheKey);
    const cached = queryClient.getQueryData<CachedPolicies>(cacheKey);
    if (!initialLoadDoneRef.current && cached && cacheState?.dataUpdatedAt && Date.now() - cacheState.dataUpdatedAt < 30 * 1000) {
      setPolicies(cached.policies);
      setPolicyPaymentInfo(cached.paymentInfo);
      setPolicyAccidentCounts(cached.accCounts);
      setPolicyChildrenCounts(cached.childCounts);
      setPolicyFileCounts(cached.fileCounts);
      setCarPolicyCounts(cached.carCounts);
      setLoadingPolicies(false);
      return;
    }
    setLoadingPolicies(true);
    try {
      // One RPC, one round-trip — replaces the previous chain of
      // PostgREST policies SELECT (with 5 joins) → separate
      // get_client_policy_metadata RPC for the per-policy counts.
      // The RPC returns each policy as a jsonb object with the same
      // shape PostgREST produced (nested company / car / creator /
      // road_service / broker objects) plus the four aggregates
      // (paid_total / accidents_count / children_count / files_count)
      // alongside it, so we can set both `policies` and the
      // per-policy maps off a single response.
      const { data: rows, error } = await supabase.rpc('get_client_policies_full', {
        p_client_id: client.id,
      });
      if (error) throw error;

      type RpcRow = {
        policy: PolicyRecord;
        paid_total: number | null;
        accidents_count: number | null;
        children_count: number | null;
        files_count: number | null;
      };
      const rpcRows = (rows ?? []) as RpcRow[];

      const policiesData = rpcRows.map((r) => r.policy);
      setPolicies(policiesData);

      if (policiesData.length === 0) {
        setPolicyPaymentInfo({});
        setPolicyAccidentCounts({});
        setPolicyChildrenCounts({});
        setPolicyFileCounts({});
        return;
      }

      const paymentInfo: Record<string, { paid: number; remaining: number }> = {};
      const accCounts: Record<string, number> = {};
      const childCounts: Record<string, number> = {};
      const fileCounts: Record<string, number> = {};
      // Per-car active-policy counts. Previously a separate
      // fetchCarPolicyCounts() query on the policies table; now derived
      // from the same RPC payload we already have. Saves one round-trip
      // off the critical load group.
      const carCounts: Record<string, number> = {};
      for (const r of rpcRows) {
        const id = r.policy.id;
        const paid = Number(r.paid_total ?? 0);
        paymentInfo[id] = {
          paid,
          remaining:
            (Number(r.policy.insurance_price ?? 0) + Number((r.policy as any).office_commission ?? 0)) - paid,
        };
        accCounts[id] = Number(r.accidents_count ?? 0);
        childCounts[id] = Number(r.children_count ?? 0);
        fileCounts[id] = Number(r.files_count ?? 0);
        const carId = (r.policy as any).car?.id as string | undefined;
        if (carId && !r.policy.cancelled) {
          carCounts[carId] = (carCounts[carId] || 0) + 1;
        }
      }
      setPolicyPaymentInfo(paymentInfo);
      setPolicyAccidentCounts(accCounts);
      setPolicyChildrenCounts(childCounts);
      setPolicyFileCounts(fileCounts);
      setCarPolicyCounts(carCounts);
      queryClient.setQueryData(cacheKey, {
        policies: policiesData,
        paymentInfo,
        accCounts,
        childCounts,
        fileCounts,
        carCounts,
      });
    } catch (error) {
      console.error('Error fetching policies:', error);
    } finally {
      setLoadingPolicies(false);
    }
  };

  const fetchPaymentSummary = async () => {
    // Cross-mount cache. Visiting another client and coming back
    // within ~30s replays the cached numbers without re-running the
    // three reads below — chrome appears instantly on revisit.
    const cacheKey = ['client-payment-summary', client.id];
    const cacheState = queryClient.getQueryState(cacheKey);
    const cached = queryClient.getQueryData<{
      summary: { total_paid: number; total_remaining: number; total_profit: number };
      brokerDebts: BrokerDebtInfo[];
    }>(cacheKey);
    if (!initialLoadDoneRef.current && cached && cacheState?.dataUpdatedAt && Date.now() - cacheState.dataUpdatedAt < 30 * 1000) {
      setPaymentSummary(cached.summary);
      setBrokerDebts(cached.brokerDebts);
      return;
    }

    try {
      // Single source of truth for the main numbers — the
      // get_client_balance RPC encapsulates the entire kashf
      // formula on the SQL side (billed − credits with all the
      // ELZAMI-passthrough / cancelled-stays-in-debt /
      // transfer-adjustment / receipt-vs-wallet rules baked in).
      // Pulling it as one round-trip replaces six client-side
      // queries (policies × 2 + policy_payments + receipts × 2 +
      // policy_transfers + customer_wallet_transactions) that
      // re-implemented the same math and were prone to drifting
      // from the printed كشف.
      //
      // Profit + broker debts aren't in the RPC's return shape so
      // we still need ONE policies query plus ONE policy_payments
      // query to compute them — broker math splits payments per
      // group between client claim and broker claim, which lives
      // client-side. Net: 7 queries → 3.
      // Fire all three reads in parallel. The PostgREST !inner join
      // on policy_payments lets us filter by the linked policy's
      // client_id without needing the policy_id list back from the
      // policies query first — so payments + policies + balance RPC
      // all share one RTT instead of policy_payments having to await
      // the policies select. Cuts fetchPaymentSummary's critical path
      // from 2 RTTs to 1.
      const [
        { data: balanceRows, error: balanceErr },
        { data: policiesData, error: policiesErr },
        { data: paymentsDataRaw, error: paymentsErr },
      ] = await Promise.all([
        supabase.rpc('get_client_balance', { p_client_id: client.id }),
        supabase
          .from('policies')
          .select('id, insurance_price, office_commission, profit, policy_type_parent, cancelled, transferred, group_id, broker_id, broker:brokers(id, name)')
          .eq('client_id', client.id)
          .is('transferred_from_policy_id', null)
          .is('deleted_at', null),
        supabase
          .from('policy_payments')
          .select('policy_id, amount, refused, payment_type, policies!inner(client_id, deleted_at)')
          .eq('policies.client_id', client.id)
          .is('policies.deleted_at', null),
      ]);
      if (balanceErr) throw balanceErr;
      if (policiesErr) throw policiesErr;
      if (paymentsErr) throw paymentsErr;

      const balance = Array.isArray(balanceRows) ? balanceRows[0] : balanceRows;
      const totalPaid = Number(balance?.total_paid ?? 0);
      const totalRemaining = Number(balance?.total_remaining ?? 0);

      if (!policiesData || policiesData.length === 0) {
        setPaymentSummary({
          total_paid: totalPaid,
          total_remaining: totalRemaining,
          total_profit: 0,
        });
        setBrokerDebts([]);
        return;
      }

      // Profit summed across every active (non-destination) policy.
      // The RPC doesn't return this — it's a UI-only number for the
      // "صافي الأرباح" tile, not part of the customer-facing balance.
      const totalProfit = policiesData.reduce((sum, p) => sum + (p.profit || 0), 0);

      // Narrow the payments to the same active (non-destination)
      // policy set so the broker debt math only consults the rows
      // that actually contribute to the active obligation. We already
      // have the policy_id set from policiesData above.
      const activePolicyIds = new Set(policiesData.map((p) => p.id));
      const paymentsData = (paymentsDataRaw || []).filter((p: any) =>
        activePolicyIds.has(p.policy_id),
      );

      // ELZAMI passthrough = customer paid the insurance company
      // directly (visa_external) on a policy with no office
      // commission. Same rule the RPC uses server-side.
      const policyById = new Map(policiesData.map(p => [p.id, p]));
      const paymentsMap: Record<string, number> = {};
      for (const p of (paymentsData || []) as Array<{ policy_id: string; amount: number; refused: boolean | null; payment_type: string | null }>) {
        if (p.refused) continue;
        const pol = policyById.get(p.policy_id);
        const isElzamiPassthrough =
          p.payment_type === 'visa_external' &&
          pol?.policy_type_parent === 'ELZAMI' &&
          Number(pol?.office_commission || 0) <= 0;
        if (isElzamiPassthrough) continue;
        paymentsMap[p.policy_id] = (paymentsMap[p.policy_id] || 0) + Number(p.amount || 0);
      }

      // Group policies by group_id and split each group's payment
      // pool between client claim and broker claim.
      const groupMap = new Map<string, typeof policiesData>();
      for (const p of policiesData) {
        const key = p.group_id || `single_${p.id}`;
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(p);
      }

      const officeClaimFor = (p: any) => {
        const commission = Number(p.office_commission || 0);
        if (p.policy_type_parent === 'ELZAMI') return commission;
        return Number(p.insurance_price || 0) + commission;
      };

      const brokerTotals = new Map<string, { brokerId: string; brokerName: string; amount: number }>();
      groupMap.forEach(groupPolicies => {
        const nonBrokerInGroup = groupPolicies.filter(p => !(p as any).broker_id);
        const brokerInGroup = groupPolicies.filter(p => (p as any).broker_id);
        if (brokerInGroup.length === 0) return;

        const nonBrokerClaim = nonBrokerInGroup.reduce((sum, p) => sum + officeClaimFor(p), 0);
        const groupPool = groupPolicies.reduce((sum, p) => sum + (paymentsMap[p.id] || 0), 0);
        const paidTowardClient = Math.min(groupPool, nonBrokerClaim);
        const paidTowardBroker = Math.max(0, groupPool - paidTowardClient);

        const brokerOwed = brokerInGroup.reduce((sum, p) => sum + officeClaimFor(p), 0);
        const brokerRemaining = Math.max(0, brokerOwed - paidTowardBroker);
        if (brokerRemaining <= 0) return;

        const broker = (brokerInGroup[0] as any).broker;
        if (!broker?.id) return;
        const existing = brokerTotals.get(broker.id);
        if (existing) {
          existing.amount += brokerRemaining;
        } else {
          brokerTotals.set(broker.id, {
            brokerId: broker.id,
            brokerName: broker.name || 'وسيط',
            amount: brokerRemaining,
          });
        }
      });

      const summary = {
        total_paid: totalPaid,
        total_remaining: totalRemaining,
        total_profit: totalProfit,
      };
      const brokerDebts = Array.from(brokerTotals.values());
      queryClient.setQueryData(cacheKey, { summary, brokerDebts });
      setPaymentSummary(summary);
      setBrokerDebts(brokerDebts);
    } catch (error) {
      console.error('Error fetching payment summary:', error);
    }
  };

  const fetchReconciliationAlerts = async () => {
    try {
      const { data, error } = await supabase
        .from('reconciliation_alerts' as never)
        .select('id, alert_type, payload, created_at')
        .eq('client_id', client.id)
        .is('resolved_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setReconciliationAlerts((data as never as Array<{
        id: string;
        alert_type: string;
        payload: Record<string, unknown> | null;
        created_at: string;
      }>) || []);
    } catch (error) {
      console.error('Error fetching reconciliation alerts:', error);
    }
  };

  const fetchWalletBalance = async () => {
    // Cache replay on re-mount (see fetchPaymentSummary header).
    const cacheKey = ['client-wallet-balance', client.id];
    const cacheState = queryClient.getQueryState(cacheKey);
    const cached = queryClient.getQueryData<{ total_refunds: number; transaction_count: number }>(cacheKey);
    if (!initialLoadDoneRef.current && cached && cacheState?.dataUpdatedAt && Date.now() - cacheState.dataUpdatedAt < 30 * 1000) {
      setWalletBalance(cached);
      return;
    }
    try {
      // Only outstanding rows count toward "نحن مدينون للعميل". A
      // row with settled_at != NULL has been explicitly resolved
      // (e.g. paid out via a سند صرف the user linked, or manually
      // reconciled), so it's no longer a live debt. Prior to the
      // 20260514130000 migration we inferred settlement by subtracting
      // every disbursement receipt — that produced false-zero
      // balances when a سند صرف was issued for an UNRELATED expense
      // (the agency rule per the user: every voucher is independent;
      // disbursements don't auto-settle credit notes).
      const { data, error } = await supabase
        .from('customer_wallet_transactions')
        .select('amount, transaction_type, settled_at')
        .eq('client_id', client.id)
        .is('settled_at', null);

      if (error) throw error;

      // "refund" / "transfer_refund_owed" / "manual_refund" = We owe customer
      // "transfer_adjustment_due"                            = Customer owes us (transfer fee)
      // "credit_consumed"                                    = Credit was applied to a new policy
      // "manual_debit"                                       = Customer owes us (إشعار مدين)
      const weOweCustomer = (data || [])
        .filter(t =>
          t.transaction_type === 'refund' ||
          t.transaction_type === 'transfer_refund_owed' ||
          t.transaction_type === 'manual_refund'
        )
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      const customerOwesUs = (data || [])
        .filter(t =>
          t.transaction_type === 'transfer_adjustment_due' ||
          t.transaction_type === 'credit_consumed' ||
          t.transaction_type === 'manual_debit'
        )
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      const next = {
        total_refunds: Math.max(0, weOweCustomer - customerOwesUs),
        transaction_count: data?.length || 0,
      };
      queryClient.setQueryData(cacheKey, next);
      setWalletBalance(next);
    } catch (error) {
      console.error('Error fetching wallet balance:', error);
    }
  };

  const fetchPayments = async () => {
    setLoadingPayments(true);
    try {
      // Both reads only need client.id — fire them in parallel.
      //   • policy_payments — joined on policies!inner so we filter
      //     by the linked policy's client_id without needing a
      //     separate policies SELECT first. Each row carries its
      //     parent policy as a nested object (same fields the cards
      //     and grouping memos consume below), so no second-pass
      //     find() against a policies list is needed.
      //   • voucher receipts (credit_note + debit_note + disbursement)
      //     — independent client-id-scoped lookup.
      const [paymentsRes, voucherRowsRes] = await Promise.all([
        supabase
          .from('policy_payments')
          .select(
            `id, amount, payment_date, payment_type, cheque_number, cheque_date, bank_code, branch_code,
             cheque_image_url, card_last_four, refused, notes, policy_id, locked, batch_id,
             payment_session_id, receipt_number, printed_at, created_at,
             policies!inner(id, policy_type_parent, policy_type_child, insurance_price, office_commission,
                            group_id, document_number, client_id, deleted_at)`
          )
          .eq('policies.client_id', client.id)
          .is('policies.deleted_at', null)
          .order('payment_date', { ascending: false }),
        supabase
          .from('receipts')
          .select('id, voucher_number, amount, receipt_date, created_at, notes, payment_method, receipt_type')
          .in('receipt_type', ['credit_note', 'debit_note', 'disbursement'])
          .eq('client_id', client.id)
          .is('cancelled_at', null)
          .order('created_at', { ascending: false }),
      ]);
      const paymentsData = paymentsRes.data;
      if (paymentsRes.error) throw paymentsRes.error;

      // Two follow-up queries that both depend on the payment IDs but
      // hit disjoint tables — fire them in parallel rather than the
      // previous sequential chain. payment_images backs the gallery
      // trigger on each row; cancellation vouchers feed the inline
      // "ملغي بسند #X" badge on refused rows.
      const paymentIds = (paymentsData || []).map(p => p.id);
      const refusedIdsForFetch = (paymentsData || []).filter((p) => p.refused).map((p) => p.id);

      const [imageRowsRes, voucherRowsForRefusedRes] = await Promise.all([
        paymentIds.length > 0
          ? supabase
              .from('payment_images')
              .select('payment_id')
              .in('payment_id', paymentIds)
          : Promise.resolve({ data: [] as Array<{ payment_id: string }> }),
        refusedIdsForFetch.length > 0
          ? supabase
              .from('receipts')
              .select('id, payment_id, receipt_number, cancellation_reason, receipt_date, created_at')
              .eq('receipt_type', 'cancellation')
              .in('payment_id', refusedIdsForFetch)
          : Promise.resolve({ data: [] as Array<{
              id: string | null;
              payment_id: string | null;
              receipt_number: number | string | null;
              cancellation_reason: string | null;
              receipt_date: string | null;
              created_at: string | null;
            }> }),
      ]);
      const paymentsWithImages = new Set<string>();
      for (const row of (imageRowsRes as any).data || []) {
        paymentsWithImages.add(row.payment_id);
      }

      // Map payments with policy info. Each payment already carries
      // its parent policy as `payment.policies` (via the !inner join
      // above), so we lift it onto the page's expected `policy` key
      // — no second-pass lookup against a policies array needed.
      const paymentsWithPolicy = (paymentsData || []).map((payment: any) => ({
        ...payment,
        has_images: paymentsWithImages.has(payment.id),
        policy: payment.policies || null,
      }));

      setPayments(paymentsWithPolicy);

      // Cancellation voucher lookup for refused rows. The trigger inserts
      // one cancellation receipt per refused payment; on the UI we
      // collapse to one voucher per سند قبض (smallest receipt_number)
      // and assign that to every payment in the same سند. The
      // accounting rule is absolute: one سند قبض = one سند إلغاء, no
      // matter how many payment rows the سند groups. We use the same
      // fallback chain as groupedPayments (`payment_session_id`
      // → `batch_id` → `payment.id`) so both DebtPaymentModal sessions
      // and PackagePaymentModal batches dedupe correctly.
      const refused = paymentsWithPolicy.filter((p) => p.refused);
      const refusedIds = refused.map((p) => p.id);
      const nextInfo = new Map<string, { voucherNumber: number | string; reason: string | null; year: number }>();
      const nextVouchers: typeof cancellationVouchers = [];
      if (refusedIds.length > 0) {
        // Voucher rows already fetched alongside payment_images via the
        // Promise.all above — same dataset, no second round-trip needed.
        const voucherRows = (voucherRowsForRefusedRes as any).data as Array<{
          id: string | null;
          payment_id: string | null;
          receipt_number: number | string | null;
          cancellation_reason: string | null;
          receipt_date: string | null;
          created_at: string | null;
        }>;

        // Per-payment row data: keep ALL fields we'll need for both the
        // inline badge (voucherNumber + reason) and the standalone
        // cancellation voucher row (id + date for the print URL).
        type VoucherRow = {
          id: string;
          payment_id: string;
          voucherNumber: number | string;
          reason: string | null;
          date: string;
          sortDate: string;
        };
        const perPayment = new Map<string, VoucherRow>();
        for (const row of (voucherRows ?? []) as Array<{
          id: string | null;
          payment_id: string | null;
          receipt_number: number | string | null;
          cancellation_reason: string | null;
          receipt_date: string | null;
          created_at: string | null;
        }>) {
          if (row.payment_id && row.id && row.receipt_number != null) {
            perPayment.set(row.payment_id, {
              id: row.id,
              payment_id: row.payment_id,
              voucherNumber: row.receipt_number,
              reason: row.cancellation_reason,
              date: row.receipt_date || row.created_at || new Date().toISOString(),
              sortDate: row.created_at || row.receipt_date || new Date().toISOString(),
            });
          }
        }

        // Pick the canonical voucher per سند قبض: smallest numeric
        // receipt_number among the سند's refused payments.
        const sortKey = (v: number | string): string => {
          const n = typeof v === 'number' ? v : Number(v);
          return Number.isFinite(n) ? String(n).padStart(20, '0') : String(v);
        };
        const receiptGroupKey = (p: PaymentRecord): string =>
          p.payment_session_id || p.batch_id || p.id;
        const groupVoucher = new Map<string, VoucherRow>();
        const groupRefusedPayments = new Map<string, PaymentRecord[]>();
        for (const p of refused) {
          const key = receiptGroupKey(p);
          if (!groupRefusedPayments.has(key)) groupRefusedPayments.set(key, []);
          groupRefusedPayments.get(key)!.push(p);
          const own = perPayment.get(p.id);
          if (!own) continue;
          const existing = groupVoucher.get(key);
          if (!existing || sortKey(own.voucherNumber) < sortKey(existing.voucherNumber)) {
            groupVoucher.set(key, own);
          }
        }

        for (const p of refused) {
          const v = groupVoucher.get(receiptGroupKey(p));
          if (v) {
            nextInfo.set(p.id, {
              voucherNumber: v.voucherNumber,
              reason: v.reason,
              year: new Date(v.date).getFullYear(),
            });
          }
        }

        // Build one cancellation voucher entry per cancelled session.
        // Source receipt_number = smallest R-number among the session's
        // refused payments (same canonical we use for grouped display).
        for (const [key, voucher] of groupVoucher.entries()) {
          const sessionPayments = groupRefusedPayments.get(key) ?? [];
          const amount = sessionPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
          let sourceReceiptNumber: string | null = null;
          for (const p of sessionPayments) {
            if (!p.receipt_number) continue;
            if (!sourceReceiptNumber || p.receipt_number < sourceReceiptNumber) {
              sourceReceiptNumber = p.receipt_number;
            }
          }
          nextVouchers.push({
            id: voucher.id,
            voucherNumber: String(voucher.voucherNumber),
            sourceReceiptNumber,
            sourceGroupId: key,
            cancelledPaymentIds: sessionPayments.map((p) => p.id),
            amount,
            reason: voucher.reason,
            date: voucher.date,
            sortDate: voucher.sortDate,
          });
        }
      }
      setCancellationInfo(nextInfo);
      setCancellationVouchers(nextVouchers);

      // اشعار دائن + إشعار مدين + سند صرف rows for this client.
      // Already fetched in parallel with the policies query at the top
      // of this function — same data, no second round-trip. The split
      // by receipt_type happens client-side below.
      try {
        const voucherRows = voucherRowsRes.data;

        const nextCreditNotes: typeof creditNotes = [];
        const nextDebitNotes: typeof debitNotes = [];
        const nextDisbursements: typeof disbursements = [];
        for (const r of (voucherRows ?? []) as any[]) {
          if (!r.voucher_number) continue;
          const base = {
            id: r.id as string,
            voucherNumber: r.voucher_number as string,
            amount: Number(r.amount || 0),
            date: (r.receipt_date as string) || (r.created_at as string),
            sortDate: (r.created_at as string) || (r.receipt_date as string),
            description: (r.notes as string | null) ?? null,
          };
          if (r.receipt_type === 'credit_note') nextCreditNotes.push(base);
          else if (r.receipt_type === 'debit_note') nextDebitNotes.push(base);
          else if (r.receipt_type === 'disbursement') {
            nextDisbursements.push({
              ...base,
              paymentMethod: (r.payment_method as string | null) ?? null,
            });
          }
        }
        setCreditNotes(nextCreditNotes);
        setDebitNotes(nextDebitNotes);
        setDisbursements(nextDisbursements);
      } catch (voucherErr) {
        console.warn('[ClientDetails] receipts/notes fetch failed:', voucherErr);
        setCreditNotes([]);
        setDebitNotes([]);
        setDisbursements([]);
      }
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
    // Reset the "initial load complete" gate so this mount's fetches
    // consult the QueryClient cache (see fetchX wrappers). After the
    // critical group finishes we flip the gate so any subsequent
    // call (post-mutation refresh) bypasses cache and pulls fresh.
    initialLoadDoneRef.current = false;
    const loadInitialData = async () => {
      setInitialLoading(true);
      // Critical group — drives the page chrome (header tile, summary
      // pills, wallet badge, broker info). These are LIGHT queries
      // that finish quickly; we wait on them so the user sees a
      // populated page on first paint instead of a full-page skeleton.
      await Promise.all([
        fetchCars(),
        fetchBroker(),
        fetchPaymentSummary(),
        fetchWalletBalance(),
        fetchReconciliationAlerts(),
      ]);
      setNotesValue(client.notes || '');
      setInitialLoading(false);

      // Deferred — fill in the policies + payments tabs in the
      // background. They both have their own loading state
      // (loadingPolicies / loadingPayments) that drives per-section
      // skeletons, so the rest of the page is interactive while these
      // heavier reads finish. Previously they were awaited in the
      // critical Promise.all above, so the entire page sat behind a
      // skeleton until the slowest read returned.
      void fetchPolicies();
      void fetchPayments();
      // Flip the gate AFTER the deferred ones kick off so their first
      // call still consulted the cache. Any subsequent refresh
      // (mutations) bypasses the cache check.
      initialLoadDoneRef.current = true;
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
    // Skipped: refreshing carPolicyCounts. Saving/editing a car
    // doesn't add or remove policies on that car, so the map is
    // unchanged. carPolicyCounts is re-derived whenever fetchPolicies
    // runs (deferred load + post-mutation refresh sites).
    onRefresh();
  };

  // Delete car handler
  const handleDeleteCar = async () => {
    if (!deleteCarId) return;
    
    // Check if car has policies
    if (carPolicyCounts[deleteCarId] > 0) {
      toast.error('لا يمكن حذف السيارة لوجود معاملات مرتبطة بها');
      setDeleteCarDialogOpen(false);
      setDeleteCarId(null);
      return;
    }
    
    setDeletingCar(true);
    try {
      // policy_groups.car_id has a FK to cars(id) with the default
      // ON DELETE RESTRICT. After a policy/package is deleted the group
      // row can linger (delete-policy removes policies + policy_transfers
      // but not policy_groups), so a car with no *active* policies may
      // still be referenced by an orphan group and the raw DELETE is
      // rejected by Postgres. We release those back-pointers first so
      // the car can be removed; the group rows survive without a car
      // linkage, which is fine since they'll either be garbage-collected
      // later or reused if a new transfer targets the same bundle.
      const { error: groupUnlinkError } = await supabase
        .from('policy_groups')
        .update({ car_id: null })
        .eq('car_id', deleteCarId);
      if (groupUnlinkError) throw groupUnlinkError;

      const { error } = await supabase
        .from('cars')
        .delete()
        .eq('id', deleteCarId);

      if (error) throw error;
      toast.success('تم حذف السيارة بنجاح');
      fetchCars();
      // Skipped: carPolicyCounts refresh. The delete check above
      // already gates on the count being 0, so the deleted car has no
      // entry in the map to clean up.
    } catch (error: any) {
      console.error('Error deleting car:', error);
      toast.error('فشل حذف السيارة', { description: error?.message });
    } finally {
      setDeletingCar(false);
      setDeleteCarDialogOpen(false);
      setDeleteCarId(null);
    }
  };

  // Delete payment handler
  const openCancelPaymentDialog = () => {
    // Customer-scope resolver — mirrors the receipts page so the
    // bookkeeper sees the SAME set of receipts in the cancel dialog
    // that they'd see on a printed كشف القبض for this customer. We
    // already have the customer's payments + policies in memory from
    // fetchPayments / fetchPolicies, so no extra round-trip is needed.
    setCancelResolving(true);
    try {
      const policyById = new Map(policies.map((p) => [p.id, p]));

      // Stage 1 — same filter as the print:
      //   - skip already-refused rows (nothing to cancel)
      //   - skip payment_type='visa_external' (customer paid the
      //     insurer directly, never came through the office)
      //   - skip ELZAMI passthrough = locked system row + amount==price.
      //     The `locked` gate is what makes this safe: a manual cash
      //     payment the user collected via the "دفع" button is
      //     unlocked, so it survives the filter and gets a real سند
      //     قبض / إلغاء flow.
      const survivors = payments.filter((p) => {
        if (p.refused) return false;
        if (p.payment_type === 'visa_external') return false;
        if (p.locked !== true) return true;
        const pol = policyById.get(p.policy_id);
        if (!pol) return true;
        if (pol.policy_type_parent !== 'ELZAMI') return true;
        const price = Number(pol.insurance_price ?? 0);
        if (price <= 0) return true;
        return Math.abs(Number(p.amount ?? 0) - price) >= 0.005;
      });

      // Stage 2 — keep multi-split cheques whole: if any live slice
      // of a batch survives Stage 1, every still-live slice in that
      // batch joins the target. Already-refused siblings stay alone.
      const batchIds = new Set(
        survivors.filter((p) => !!p.batch_id).map((p) => p.batch_id as string),
      );
      const survivorIds = new Set(survivors.map((p) => p.id));
      const finalRows = payments.filter((p) => {
        if (p.refused) return false;
        if (survivorIds.has(p.id)) return true;
        return !!p.batch_id && batchIds.has(p.batch_id);
      });

      if (finalRows.length === 0) {
        toast.error('لا توجد سندات قابلة للإلغاء (كل دفعات العميل ملغاة أو إلزامي/فيزا خارجي)');
        return;
      }

      setCancelTargetIds(finalRows.map((p) => p.id));
      setCancelTargetSum(finalRows.reduce((s, p) => s + Number(p.amount || 0), 0));
      setCancelReasonText('');
      setCancelReasonError(null);
      setCancelReasonOpen(true);
    } finally {
      setCancelResolving(false);
    }
  };

  const confirmCancelPayment = async () => {
    if (cancelTargetIds.length === 0) {
      toast.error('لا توجد سندات قابلة للإلغاء');
      return;
    }
    // Determine whether the targeted سند قبض has ever been printed.
    // The user's accounting rule splits cancellation into two regimes:
    //   * Printed → the customer holds a physical copy. We can't
    //     pretend it never happened, so refused=true + سند إلغاء +
    //     reason gives the bookkeeper the audit trail. The reason
    //     text is required here.
    //   * Unprinted → the سند قبض is still a draft, never handed to
    //     the customer. "Cancel" really means "throw the draft away":
    //     DELETE the rows so nothing remains — no سند إلغاء, no
    //     ghost rows in receipts. No reason is required since there
    //     is no audit copy that would need explaining.
    const targetSet = new Set(cancelTargetIds);
    const anyPrinted = payments.some(
      (p) => targetSet.has(p.id) && p.printed_at != null,
    );

    if (anyPrinted && !cancelReasonText.trim()) {
      setCancelReasonError('السبب مطلوب');
      return;
    }

    setCancelSubmitting(true);
    try {
      if (anyPrinted) {
        const { error } = await supabase
          .from('policy_payments')
          .update({
            refused: true,
            cheque_status: 'cancelled',
            cancellation_reason: cancelReasonText.trim(),
          })
          .in('id', cancelTargetIds);
        if (error) throw error;
        toast.success(`تم إلغاء ${cancelTargetIds.length} سند${cancelTargetIds.length > 1 ? 'اً' : ''} وإصدار سند إلغاء`);
      } else {
        // Unprinted draft → clean delete. Clear receipts first
        // (receipts.payment_id FK is ON DELETE SET NULL so the row
        // would otherwise linger as an orphan with null payment_id),
        // then DELETE policy_payments (cascades to payment_images).
        const { error: receiptsErr } = await supabase
          .from('receipts')
          .delete()
          .in('payment_id', cancelTargetIds);
        if (receiptsErr) throw receiptsErr;

        const { error: payErr } = await supabase
          .from('policy_payments')
          .delete()
          .in('id', cancelTargetIds);
        if (payErr) throw payErr;
        toast.success(`تم حذف ${cancelTargetIds.length} سند${cancelTargetIds.length > 1 ? 'اً' : ''}`);
      }
      setCancelReasonOpen(false);
      setCancelTargetIds([]);
      setCancelTargetSum(0);
      setCancelReasonText('');
      setCancelReasonError(null);
      // Same refresh fan-out as handleDeletePayment so the policy
      // cards' paid/remaining recompute without a reload.
      await Promise.all([
        fetchPayments(),
        fetchPaymentSummary(),
        fetchPolicies(),
      ]);
    } catch (err: any) {
      console.error('[ClientDetails] cancel payment:', err);
      toast.error(err?.message || 'فشل في إلغاء السند');
    } finally {
      setCancelSubmitting(false);
    }
  };

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
  const handleEditPayment = (payment: PaymentRecord, _group?: GroupedPayment) => {
    setEditingPayment(payment);
    // If the payment belongs to a package, expand to every policy in
    // the package so the dialog can render the whole package context.
    // We derive this from the underlying policy's group_id at click
    // time — the row data no longer carries packagePolicies because
    // the grouping is now per physical receipt, not per package.
    const policyOfPayment = policies.find((p) => p.id === payment.policy_id);
    const groupId = policyOfPayment?.group_id;
    if (groupId) {
      const inSamePackage = policies.filter((p) => p.group_id === groupId);
      if (inSamePackage.length > 1) {
        const enriched = inSamePackage.map((p) => ({
          id: p.id,
          policy_type_parent: p.policy_type_parent,
          policy_type_child: (p as any).policy_type_child ?? null,
          insurance_price: Number(p.insurance_price || 0),
          company_name: p.company?.name_ar || p.company?.name || null,
        }));
        setEditingGroupPolicies(enriched);
        setEditPaymentDialogOpen(true);
        return;
      }
    }
    setEditingGroupPolicies(undefined);
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
      // Force a session refresh first — the cached access_token can be
      // expired moments before the JS client's auto-refresh fires,
      // which surfaced as a sporadic "Invalid token" from the edge
      // function when the user clicked delete after sitting idle on
      // the page for a while. refreshSession() pulls a fresh JWT
      // synchronously so the subsequent invoke() always carries a
      // live token.
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      const token = refreshed?.session?.access_token;

      if (refreshError || !token) {
        toast.error('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى');
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
        let msg = response.error.message || 'فشل في حذف المعاملة';
        // error.context is a Response in supabase-js v2; the body can be a
        // stream that hasn't been read yet. Try the sync string path first
        // (older versions expose it already), then fall back to .text().
        const ctx: any = (response.error as any).context;
        try {
          if (typeof ctx?.body === 'string') {
            const parsed = JSON.parse(ctx.body);
            msg = parsed?.details || parsed?.error || msg;
          } else if (ctx && typeof ctx.text === 'function') {
            const bodyText = await ctx.clone().text();
            if (bodyText) {
              const parsed = JSON.parse(bodyText);
              msg = parsed?.details || parsed?.error || msg;
            }
          }
        } catch {
          // ignore — keep msg
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
              title: 'حذف معاملة',
              message: `تم حذف معاملة ${pol.policy_number || pol.id.slice(0, 8)} (${companyName}) بواسطة ${userName}`,
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

        toast.success(`تم حذف ${result.deletedCount} معاملة نهائياً`);
        setDeletePolicyDialogOpen(false);
        setDeletePolicyIds([]);
        // Refresh all data
        fetchPolicies();
        fetchPayments();
        fetchPaymentSummary();
        fetchWalletBalance();
      } else {
        throw new Error(result.error || 'فشل في حذف المعاملة');
      }
    } catch (error: any) {
      console.error('Delete policy error:', error);
      toast.error(error.message || 'فشل في حذف المعاملة');
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
        toast.error('فشل في جلب بيانات المعاملة');
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
      toast.error('فشل في جلب بيانات المعاملة');
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
      // Unified template: always call the bulk endpoint (it renders
      // the singular layout when a single id is passed).
      const { data, error } = await supabase.functions.invoke('generate-voucher', {
        body: { payment_ids: [paymentId] }
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
  // payment it falls back to the per-payment endpoint. Once the PDF
  // is generated successfully, every policy_payment in the row gets
  // printed_at stamped — that's the trigger that locks the "تعديل"
  // entry on the dropdown (printed receipts become immutable per the
  // accountant's rule the user agreed on; only إلغاء stays available).
  const handlePrintGroupReceipts = async (groupKey: string, paymentIds: string[]) => {
    if (paymentIds.length === 0) return;
    setGeneratingReceipt(groupKey);
    setPrintProgress({ open: true, value: 8, title: 'جاري إعداد سند القبض' });
    // Fake-progress ticker (real progress isn't exposed by the edge
    // function); creeps toward 90 so the bar has visible motion, then
    // snaps to 100 once we have the URL. Identical UX to the receipts
    // page so the bookkeeper sees the same spinner everywhere.
    const ticker = setInterval(() => {
      setPrintProgress((s) => {
        if (!s.open || s.value >= 90) return s;
        return { ...s, value: Math.min(90, s.value + 6) };
      });
    }, 220);
    const closeOverlay = (success: boolean) => {
      clearInterval(ticker);
      if (success) {
        setPrintProgress((s) => ({ ...s, value: 100 }));
        setTimeout(() => setPrintProgress({ open: false, value: 0 }), 350);
      } else {
        setPrintProgress({ open: false, value: 0 });
      }
    };
    try {
      let url: string | undefined;
      // Always go through the bulk endpoint — it already collapses to
      // a single-سند layout when paymentIds.length === 1 (doc-title
      // becomes singular, the رقم سند القبض column disappears, etc.).
      // The user wants one template for both paths so future edits
      // only touch one place; the legacy single-payment endpoint
      // stays in the codebase for any external callers but no UI
      // surface routes to it anymore.
      {
        const { data, error } = await supabase.functions.invoke('generate-voucher', {
          body: { payment_ids: paymentIds },
        });
        if (error) throw error;
        url = data?.receipt_url;
      }
      if (!url) {
        closeOverlay(false);
        toast.error(paymentIds.length === 1 ? 'لم يتم العثور على رابط السند' : 'لم يتم العثور على رابط السندات');
        return;
      }
      // Stamp printed_at on every row in this group so subsequent
      // renders disable the edit action. We deliberately don't fail
      // the print if this UPDATE errors — the PDF is already in hand,
      // and the user can re-click to retry the stamp.
      const { error: stampErr } = await supabase
        .from('policy_payments')
        .update({ printed_at: new Date().toISOString() })
        .in('id', paymentIds)
        .is('printed_at', null);
      if (stampErr) {
        console.warn('[ClientDetails] failed to stamp printed_at after print:', stampErr);
      } else {
        // Refresh so the dropdown picks up the new state right away
        // without a manual reload.
        fetchPayments();
      }
      closeOverlay(true);
      window.open(url, '_blank');
    } catch (e) {
      closeOverlay(false);
      console.error('Print group receipts error:', e);
      toast.error('فشل في توليد سند القبض');
    } finally {
      setGeneratingReceipt(null);
    }
  };

  // Print a سند إلغاء as its own document — different from a سند قبض.
  // Calls a dedicated edge function so the rendered HTML has the right
  // title ("سند إلغاء") and layout, and lives at a separate URL from
  // the original سند قبض it cancels (per the user's rule: each is its
  // own paper). The voucher row in سجل الدفعات has the print action
  // bound to this handler; voucherId is the receipts.id of the
  // canonical cancellation row resolved in fetchPayments.
  // سند صرف print — mirror of handlePrintCreditNote against the
  // disbursement edge function. Same visual family (navy accent),
  // shows the payment-line breakdown since disbursement actually
  // moved money.
  const handlePrintDisbursement = async (voucherId: string, voucherNumber: string) => {
    const key = `disbursement-${voucherId}`;
    setGeneratingReceipt(key);
    setPrintProgress({ open: true, value: 8, title: 'جاري إعداد سند الصرف' });
    const ticker = setInterval(() => {
      setPrintProgress((s) => {
        if (!s.open || s.value >= 90) return s;
        return { ...s, value: Math.min(90, s.value + 6) };
      });
    }, 220);
    const closeOverlay = (success: boolean) => {
      clearInterval(ticker);
      if (success) {
        setPrintProgress((s) => ({ ...s, value: 100 }));
        setTimeout(() => setPrintProgress({ open: false, value: 0 }), 350);
      } else {
        setPrintProgress({ open: false, value: 0 });
      }
    };
    try {
      const { data, error } = await supabase.functions.invoke(
        'generate-voucher',
        { body: { voucher_receipt_id: voucherId } },
      );
      if (error) throw error;
      const url = (data as { receipt_url?: string } | null)?.receipt_url;
      if (!url) {
        closeOverlay(false);
        toast.error('لم يتم العثور على رابط سند الصرف');
        return;
      }
      closeOverlay(true);
      window.open(url, '_blank');
    } catch (e) {
      closeOverlay(false);
      console.error('Print disbursement error:', e);
      toast.error(`فشل في طباعة سند الصرف ${voucherNumber}`);
    } finally {
      setGeneratingReceipt(null);
    }
  };

  // اشعار دائن print — calls the dedicated edge function so the
  // output matches the visual family of سند قبض / سند إلغاء (same
  // A4 layout, branded header, customer block, amount panel). The
  // emerald accent on the document distinguishes it from the red
  // سند إلغاء and the navy-blue سند قبض at a glance.
  const handlePrintCreditNote = async (voucherId: string, voucherNumber: string) => {
    const key = `credit-${voucherId}`;
    setGeneratingReceipt(key);
    setPrintProgress({ open: true, value: 8, title: 'جاري إعداد الإشعار' });
    const ticker = setInterval(() => {
      setPrintProgress((s) => {
        if (!s.open || s.value >= 90) return s;
        return { ...s, value: Math.min(90, s.value + 6) };
      });
    }, 220);
    const closeOverlay = (success: boolean) => {
      clearInterval(ticker);
      if (success) {
        setPrintProgress((s) => ({ ...s, value: 100 }));
        setTimeout(() => setPrintProgress({ open: false, value: 0 }), 350);
      } else {
        setPrintProgress({ open: false, value: 0 });
      }
    };
    try {
      const { data, error } = await supabase.functions.invoke(
        'generate-voucher',
        { body: { voucher_receipt_id: voucherId } },
      );
      if (error) throw error;
      const url = (data as { receipt_url?: string } | null)?.receipt_url;
      if (!url) {
        closeOverlay(false);
        toast.error('لم يتم العثور على رابط الإشعار');
        return;
      }
      closeOverlay(true);
      window.open(url, '_blank');
    } catch (e) {
      closeOverlay(false);
      console.error('Print credit note error:', e);
      toast.error(`فشل في طباعة الإشعار ${voucherNumber}`);
    } finally {
      setGeneratingReceipt(null);
    }
  };

  const handlePrintCancellationVoucher = async (voucherId: string, voucherNumber: string) => {
    const key = `voucher-${voucherId}`;
    setGeneratingReceipt(key);
    setPrintProgress({ open: true, value: 8, title: 'جاري إعداد سند الإلغاء' });
    const ticker = setInterval(() => {
      setPrintProgress((s) => {
        if (!s.open || s.value >= 90) return s;
        return { ...s, value: Math.min(90, s.value + 6) };
      });
    }, 220);
    const closeOverlay = (success: boolean) => {
      clearInterval(ticker);
      if (success) {
        setPrintProgress((s) => ({ ...s, value: 100 }));
        setTimeout(() => setPrintProgress({ open: false, value: 0 }), 350);
      } else {
        setPrintProgress({ open: false, value: 0 });
      }
    };
    try {
      const { data, error } = await supabase.functions.invoke(
        'generate-voucher',
        { body: { voucher_receipt_id: voucherId } },
      );
      if (error) throw error;
      const url = (data as { receipt_url?: string } | null)?.receipt_url;
      if (!url) {
        closeOverlay(false);
        toast.error('لم يتم العثور على رابط سند الإلغاء');
        return;
      }
      closeOverlay(true);
      window.open(url, '_blank');
    } catch (e) {
      closeOverlay(false);
      console.error('Print cancellation voucher error:', e);
      toast.error(`فشل في طباعة سند الإلغاء ${voucherNumber}`);
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

  // "المعاملات" count — one per card in the timeline. Packages (all
  // policies sharing a group_id) collapse to a single معاملة regardless
  // of how many types they hold; standalone policies count one each.
  // This matches what the user sees on the المعاملات tab, where each
  // card IS one معاملة.
  const dedupedPolicyCount = useMemo(() => {
    const groupIds = new Set<string>();
    let standalone = 0;
    for (const p of policies) {
      if (p.group_id) {
        groupIds.add(p.group_id);
      } else {
        standalone += 1;
      }
    }
    return groupIds.size + standalone;
  }, [policies]);

  // Flat list of policy refs (id + display label + car number) used by
  // the files tabs to label each file with the معاملة it belongs to.
  const clientFilesPolicyRefs = useMemo<ClientFilesPolicyRef[]>(() => {
    return policies.map((p) => {
      const typeLabel =
        p.policy_type_parent === 'THIRD_FULL' && p.policy_type_child === 'THIRD'
          ? 'ثالث'
          : p.policy_type_parent === 'THIRD_FULL' && p.policy_type_child === 'FULL'
          ? 'شامل'
          : policyTypeLabels[p.policy_type_parent] || p.policy_type_parent;
      const docPart = p.document_number ? ` #${p.document_number}` : '';
      return {
        id: p.id,
        label: `${typeLabel}${docPart}`,
        car_number: p.car?.car_number ?? null,
        policy_number: p.policy_number,
        document_number: p.document_number,
      };
    });
  }, [policies]);

  // Fetch file counts up-front so the tab badges are accurate before the
  // user clicks into the tabs. Radix Tabs unmounts inactive TabsContent,
  // so ClientFilesTab's own onCountChange wouldn't fire until activated.
  const policyIdsKey = useMemo(
    () => clientFilesPolicyRefs.map((p) => p.id).sort().join(','),
    [clientFilesPolicyRefs],
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Single media_files fetch covers both the per-policy split
      // (policy_crm → sys, policy / policy_insurance → cli) AND the
      // client-level system files (client_system → sys). Before, this
      // ran as two sequential queries — one for the policy IDs and one
      // head-count for the client row. Combining into one
      // `.in('entity_id', [...])` over the union of IDs keeps the wire
      // size tiny (we only ask for entity_type + entity_id) and saves
      // a round-trip on every page mount.
      const policyIds = policyIdsKey ? policyIdsKey.split(',') : [];
      const allIds = client?.id ? [client.id, ...policyIds] : policyIds;
      if (allIds.length === 0) {
        if (!cancelled) {
          setSystemFilesCount(0);
          setClientFilesCount(0);
        }
        return;
      }

      const { data, error } = await supabase
        .from('media_files')
        .select('entity_type, entity_id')
        .in('entity_id', allIds)
        .in('entity_type', ['policy_crm', 'policy', 'policy_insurance', 'client_system'])
        .is('deleted_at', null);
      if (cancelled) return;

      let sys = 0;
      let cli = 0;
      if (!error) {
        const policyIdSet = new Set(policyIds);
        for (const row of data || []) {
          if (row.entity_type === 'client_system' && row.entity_id === client?.id) {
            sys++;
          } else if (row.entity_type === 'policy_crm' && policyIdSet.has(row.entity_id)) {
            sys++;
          } else if (
            (row.entity_type === 'policy' || row.entity_type === 'policy_insurance') &&
            policyIdSet.has(row.entity_id)
          ) {
            cli++;
          }
        }
      }
      setSystemFilesCount(sys);
      setClientFilesCount(cli);
    })();
    return () => {
      cancelled = true;
    };
  }, [policyIdsKey, client?.id]);

  // Group payments into one row per physical receipt. The grouping
  // collapses multi-split cheques (same batch_id, allocated across
  // N policies by the debt-payment modal) into a single row at the
  // cheque's face value. The transaction-package grouping the page
  // used to do (by policies.group_id) is gone — the receipt-centric
  // view matches the cheques page and the print, so the bookkeeper
  // sees the same numbers everywhere.
  //
  // إلزامي passthrough + visa_external are also dropped here, same
  // filter as the receipts page and the bulk-receipt edge function.
  // These are payments the office never actually collected, so they
  // don't belong on a كشف قبض. (Future: surface as a per-agent
  // toggle so offices that DO collect إلزامي can flip them back in.)
  const groupedPayments = useMemo((): GroupedPayment[] => {
    const groups = new Map<string, GroupedPayment>();
    const policyById = new Map(policies.map((p) => [p.id, p]));

    // Search + payment-type filter (toolbar above the table). The
    // إلزامي/visa_external rows are NOT filtered here — they stay
    // visible as read-only informational rows so the bookkeeper sees
    // the customer's full payment picture. Their isPassthrough flag
    // is computed below and drives the row's rendering (no سند
    // number, no edit / cancel actions).
    const isPassthroughPayment = (payment: PaymentRecord): boolean => {
      if (payment.payment_type === 'visa_external') return true;
      // Legacy/import case: an إلزامي premium recorded as cash/cheque
      // /transfer with the system-generated `locked` flag — money the
      // office didn't actually collect, just a passthrough record. The
      // `locked === true` check is what makes this safe; without it,
      // a user-collected cash payment that happens to match the إلزامي
      // price (e.g. customer pays the exact premium in cash via the
      // "دفع" button) would incorrectly hide as passthrough.
      if (payment.locked !== true) return false;
      const pol = policyById.get(payment.policy_id);
      if (!pol || pol.policy_type_parent !== 'ELZAMI') return false;
      const price = Number((pol as any).insurance_price ?? 0);
      if (price <= 0) return false;
      return Math.abs(Number(payment.amount ?? 0) - price) < 0.005;
    };

    const filteredPayments = payments.filter((payment) => {
      // Note: ghost rows (refused=true + printed_at=null from legacy
      // cancel-while-unprinted) USED to be filtered out here, but the
      // user revised the rule for سجل الدفعات: when a cancellation
      // voucher row is shown above, the cancelled سند قبض below has
      // to be visible too so the bookkeeper sees both sides of the
      // event. Ghosts still get filtered out of the printed receipt
      // in generate-bulk-payment-receipt (separate concern — printed
      // copy must stay clean of orphan history).
      if (paymentSearch) {
        const search = paymentSearch.toLowerCase();
        if (!payment.cheque_number?.toLowerCase().includes(search) &&
            !payment.notes?.toLowerCase().includes(search)) {
          return false;
        }
      }
      // Voucher-kind / date / payment-method filters apply at the
      // session level (filteredDisplayRows) so a session with mixed
      // methods doesn't get its splits dropped here.
      return true;
    });

    for (const payment of filteredPayments) {
      // Group by collection event (payment_session_id) when present —
      // that's the cashier's "one visit, one voucher" concept. New
      // submits from DebtPaymentModal stamp a session_id on every row.
      // Legacy rows (no session_id) fall back to batch_id (one
      // physical cheque) or the payment id (standalone single payment).
      const groupKey = payment.payment_session_id
        || payment.batch_id
        || payment.id;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: groupKey,
          receipt_number: payment.receipt_number,
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
          printed: false,
          isPassthrough: false,
          latestCreatedAt: payment.created_at || payment.payment_date,
          payments: [],
        });
      }

      const group = groups.get(groupKey)!;
      group.payments.push(payment);
      group.totalAmount += payment.amount;

      // Display dedupe: legacy data has rows in the same session/batch
      // with different receipt_numbers (R10/R11/R12 for one collection
      // event). Show the smallest as the canonical سند number per the
      // user's rule "one سند قبض = one number, regardless of how many
      // rows". New data from the pre-allocate path already has the
      // same R-number across all rows, so this is a no-op for it.
      if (payment.receipt_number && (!group.receipt_number || payment.receipt_number < group.receipt_number)) {
        group.receipt_number = payment.receipt_number;
      }

      if (payment.payment_type && !group.paymentTypes.includes(payment.payment_type)) {
        group.paymentTypes.push(payment.payment_type);
      }

      // Use earliest date if batched (typically all splits share a date).
      if (payment.payment_date < group.payment_date) {
        group.payment_date = payment.payment_date;
      }

      // Track the LATEST created_at across the group's rows. Sort uses
      // this so newer additions (or recent edits via the unified flow,
      // which re-INSERTs with a new created_at) bubble to the top.
      const candidateCa = payment.created_at || payment.payment_date;
      if (candidateCa > group.latestCreatedAt) {
        group.latestCreatedAt = candidateCa;
      }

      // If any split is refused, mark whole batch — the cancel flow
      // propagates so this should be all-or-nothing in practice.
      if (payment.refused) {
        group.refused = true;
      }

      if (payment.locked) {
        group.locked = true;
      }

      // Any printed row in the session locks the whole session's edit
      // action — there's no concept of a partially-printed receipt.
      if (payment.printed_at) {
        group.printed = true;
      }
    }

    // Pass 2: tag groups whose ENTIRE membership is passthrough money
    // (إلزامي / visa_external). Mixed sessions stay editable; the
    // print/cancel scope resolvers still skip the passthrough slices
    // via their own filters, so the office's كشف قبض numbers don't
    // change either way.
    for (const group of groups.values()) {
      group.isPassthrough = group.payments.every(isPassthroughPayment);
    }

    // Sort by latest created_at descending — newest entry always on
    // top, regardless of whether it's a real collection or an إلزامي
    // / فيزا خارجي passthrough row. The user's rule (revised): order
    // is purely by when the bookkeeper added the entry. The earlier
    // "passthrough always last" behaviour was removed at the user's
    // request — they want consistency with the chronological order of
    // work, not a type-based segregation.
    return Array.from(groups.values()).sort((a, b) =>
      new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime()
    );
  }, [payments, paymentSearch, policies]);

  // Merged display list: payment groups + cancellation vouchers +
  // اشعار دائن (credit_note) + سند صرف (disbursement) rows. Each
  // carries its own sortDate so newest-first merge naturally lets a
  // cancellation / credit note / disbursement sit above the source
  // سند when those documents were issued later.
  type DisplayRow =
    | { kind: 'payment'; group: GroupedPayment; sortDate: string }
    | { kind: 'voucher'; voucher: (typeof cancellationVouchers)[number]; sortDate: string }
    | { kind: 'credit_note'; note: (typeof creditNotes)[number]; sortDate: string }
    | { kind: 'debit_note'; note: (typeof debitNotes)[number]; sortDate: string }
    | { kind: 'disbursement'; disb: (typeof disbursements)[number]; sortDate: string };
  const displayRows = useMemo((): DisplayRow[] => {
    const rows: DisplayRow[] = [];
    for (const group of groupedPayments) {
      rows.push({ kind: 'payment', group, sortDate: group.latestCreatedAt });
    }
    for (const voucher of cancellationVouchers) {
      rows.push({ kind: 'voucher', voucher, sortDate: voucher.sortDate });
    }
    for (const note of creditNotes) {
      rows.push({ kind: 'credit_note', note, sortDate: note.sortDate });
    }
    for (const note of debitNotes) {
      rows.push({ kind: 'debit_note', note, sortDate: note.sortDate });
    }
    for (const disb of disbursements) {
      rows.push({ kind: 'disbursement', disb, sortDate: disb.sortDate });
    }
    return rows.sort((a, b) =>
      new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime(),
    );
  }, [groupedPayments, cancellationVouchers, creditNotes, debitNotes, disbursements]);

  // Filter options surfaced in the popover are derived from the rows
  // actually present for this client — typing a filter that has no
  // matching data is just noise. Only the 4 voucher families the user
  // requested (سند قبض / سند صرف / سند الإلغاء / اشعار دائن) are
  // candidates; the last two aren't fetched into سجل الدفعات yet, so
  // they appear only once the rendering side adds them.
  const paymentTypeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    if (displayRows.some((r) => r.kind === 'payment')) {
      opts.push({ value: 'payment', label: 'سند قبض' });
    }
    if (displayRows.some((r) => r.kind === 'voucher')) {
      opts.push({ value: 'cancellation', label: 'سند الإلغاء' });
    }
    if (displayRows.some((r) => r.kind === 'credit_note')) {
      opts.push({ value: 'credit_note', label: 'اشعار دائن' });
    }
    if (displayRows.some((r) => r.kind === 'debit_note')) {
      opts.push({ value: 'debit_note', label: 'اشعار مدين' });
    }
    if (displayRows.some((r) => r.kind === 'disbursement')) {
      opts.push({ value: 'disbursement', label: 'سند صرف' });
    }
    return opts;
  }, [displayRows]);

  const paymentMethodOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of displayRows) {
      if (row.kind !== 'payment') continue;
      for (const t of row.group.paymentTypes) {
        if (t) set.add(t);
      }
    }
    return Array.from(set).map((value) => ({
      value,
      label: PAYMENT_TYPE_LABELS[value] || value,
    }));
  }, [displayRows]);

  const filteredDisplayRows = useMemo((): DisplayRow[] => {
    const { dateFrom, dateTo, types, paymentMethods } = paymentFilters;
    return displayRows.filter((row) => {
      const date =
        row.kind === 'voucher'
          ? row.voucher.date
          : row.kind === 'credit_note' || row.kind === 'debit_note'
            ? row.note.date
            : row.kind === 'disbursement'
              ? row.disb.date
              : row.group.payment_date;
      const dateOnly = (date || '').slice(0, 10);
      if (dateFrom && dateOnly && dateOnly < dateFrom) return false;
      if (dateTo && dateOnly && dateOnly > dateTo) return false;

      if (types.length > 0) {
        const kind =
          row.kind === 'voucher'
            ? 'cancellation'
            : row.kind === 'credit_note'
              ? 'credit_note'
              : row.kind === 'debit_note'
                ? 'debit_note'
                : row.kind === 'disbursement'
                  ? 'disbursement'
                  : 'payment';
        if (!types.includes(kind)) return false;
      }

      if (paymentMethods.length > 0) {
        // Voucher / credit_note / debit_note rows carry no payment
        // method. Disbursement rows DO (cash / cheque / transfer /
        // visa) since the agency picked one when it paid the customer.
        if (row.kind === 'voucher' || row.kind === 'credit_note' || row.kind === 'debit_note') return false;
        if (row.kind === 'disbursement') {
          const m = row.disb.paymentMethod;
          return m ? paymentMethods.includes(m) : false;
        }
        const methods = row.group.paymentTypes;
        if (!methods.some((m) => paymentMethods.includes(m))) return false;
      }

      return true;
    });
  }, [displayRows, paymentFilters]);

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
        <Header title={client.full_name} subtitle="العملاء" />
        <div className={`${sidebarCollapsed ? "max-w-[96rem]" : "max-w-[88rem]"} mx-auto space-y-6`}>
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

      <Header
        title={client.full_name}
        subtitle="العملاء"
      />

      <div className={`${sidebarCollapsed ? "max-w-[96rem]" : "max-w-[88rem]"} mx-auto space-y-4 sm:space-y-6`}>
        {reconciliationAlerts.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 sm:px-4 sm:py-3 flex items-start gap-2 sm:gap-3">
            <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 mt-0.5 text-amber-600" />
            <div className="text-xs sm:text-sm leading-relaxed">
              <strong>تنبيه:</strong> تم اكتشاف عدم تطابق محتمل في بيانات هذا العميل
              ({reconciliationAlerts.length})
              — يُرجى مراجعة كشف الحساب وإعادة توليده إذا لزم الأمر.
            </div>
          </div>
        )}
        {/* Professional Header Card */}
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-l from-primary/10 via-primary/5 to-transparent p-4 sm:p-6">
            {/* Identity on top, action buttons below — stacked until lg.
                The row layout at sm+ was collapsing badly at 800-1000px
                viewports: 4 action buttons (~400px) + avatar + name +
                flex-wrapped ID/phone/file/date chips would all fight
                for the same ~770px row, pushing the avatar into the
                buttons and wrapping the name mid-word. */}
            <div className="flex flex-col lg:flex-row lg:items-start gap-3 sm:gap-4">
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
                  <div className="flex flex-wrap items-center gap-x-4 sm:gap-x-5 gap-y-1.5 text-sm sm:text-[15px] text-muted-foreground mt-1.5 sm:mt-2.5">
                    <span
                      className="flex items-center gap-2"
                      title="رقم الهوية"
                    >
                      <IdCard className="h-[18px] w-[18px] sm:h-5 sm:w-5 shrink-0 text-muted-foreground/70" />
                      <span className="font-mono ltr-nums font-semibold tracking-wide text-foreground/85">
                        {client.id_number}
                      </span>
                    </span>
                    {client.phone_number && (
                      <ClickablePhone
                        phone={client.phone_number}
                        className="text-sm sm:text-[15px] gap-2"
                        iconClassName="h-[18px] w-[18px] sm:h-5 sm:w-5"
                      />
                    )}
                    {client.phone_number_2 && (
                      <ClickablePhone
                        phone={client.phone_number_2}
                        className="text-sm sm:text-[15px] gap-2 text-muted-foreground/70"
                        iconClassName="h-[18px] w-[18px] sm:h-5 sm:w-5"
                      />
                    )}
                    {client.file_number && (
                      <span className="flex items-center gap-2" title="رقم الملف">
                        <FileText className="h-[18px] w-[18px] sm:h-5 sm:w-5 shrink-0 text-muted-foreground/70" />
                        <span>
                          ملف:{' '}
                          <span className="font-mono ltr-nums font-semibold text-foreground/85">
                            {client.file_number}
                          </span>
                        </span>
                      </span>
                    )}
                    {client.birth_date && (
                      <span className="flex items-center gap-2" title="تاريخ الميلاد">
                        <Calendar className="h-[18px] w-[18px] sm:h-5 sm:w-5 shrink-0 text-muted-foreground/70" />
                        <span className="font-mono ltr-nums font-semibold text-foreground/85">
                          {formatDate(client.birth_date)}
                        </span>
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
                        {broker.phone && (
                          <span className="mr-1">
                            <ClickablePhone phone={broker.phone} showIcon={false} />
                          </span>
                        )}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions — wraps below header on mobile, sits next to it on desktop */}
              <div className="flex flex-wrap gap-2 shrink-0">
                {(paymentSummary.total_remaining - walletBalance.total_refunds) > 0 && (
                  <Button
                    variant="gradient"
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
                  <span>كشف حساب</span>
                </Button>
                <Button
                  variant="gradient"
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
              <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">المعاملات</p>
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

        {/* Financial Summary Cards — stacked full-width below xl so
            the remaining-amount card (which has a DebtIndicator chip
            and can carry an extra refund/requested line) isn't forced
            to fracture digits mid-number at the md/lg range. Four
            columns side-by-side only at xl+, where there's room. */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-2 sm:gap-4">
          <Card className="p-2.5 sm:p-4 flex items-center gap-2 sm:gap-4">
            <div className="h-9 w-9 sm:h-12 sm:w-12 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
              <Wallet className="h-4 w-4 sm:h-6 sm:w-6 text-success" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate">إجمالي المدفوع</p>
              <p className="text-sm sm:text-base lg:text-xl font-bold text-success tabular-nums whitespace-nowrap truncate leading-tight">₪{paymentSummary.total_paid.toLocaleString()}</p>
            </div>
          </Card>

          <Card className="p-2.5 sm:p-4 flex items-start gap-2 sm:gap-4">
            <div className="h-9 w-9 sm:h-12 sm:w-12 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <AlertCircle className="h-4 w-4 sm:h-6 sm:w-6 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate">إجمالي المتبقي</p>
              <p className={cn("text-sm sm:text-base lg:text-xl font-bold tabular-nums whitespace-nowrap truncate leading-tight",
                paymentSummary.total_remaining > 0
                  ? "text-destructive"
                  : "text-success"
              )}>
                ₪{Math.max(0, paymentSummary.total_remaining).toLocaleString()}
              </p>
              {/* Always say who owes whom on this card so staff don't have
                  to do the subtraction in their head. Three states:
                    • net > 0 → customer owes us this much
                    • net == 0 with prior payments → fully settled
                    • net == 0 with no movement → no debt yet */}
              {(() => {
                // Mirror the kashf's "المتبقي على العميل" line directly —
                // credit notes are already netted inside total_remaining
                // (via creditsTotal), so subtracting walletBalance.total_refunds
                // here would double-count the same إشعارات دائن.
                const net = paymentSummary.total_remaining;
                if (net > 0) {
                  return (
                    <p className="text-[10px] sm:text-[11px] text-destructive/80 font-medium leading-tight mt-0.5">
                      على العميل أن يدفع
                    </p>
                  );
                }
                if (paymentSummary.total_paid > 0 || paymentSummary.total_remaining > 0) {
                  return (
                    <p className="text-[10px] sm:text-[11px] text-success/80 font-medium leading-tight mt-0.5">
                      مسدد ✓
                    </p>
                  );
                }
                return null;
              })()}
            </div>
            {/* DebtIndicator only shown from lg up; at sm/md the card
                already competes with the remaining-amount number for
                horizontal space and was forcing the digits to break
                mid-number (₪1,3,00). */}
            <DebtIndicator
              totalOwed={paymentSummary.total_paid + paymentSummary.total_remaining}
              totalPaid={paymentSummary.total_paid + walletBalance.total_refunds}
              showAmount={false}
              className="hidden lg:inline-flex"
            />
          </Card>

          {/* Total-profit card — gated by the view_financial permission */}
          {canViewFinancial && (
            <Card className="p-2.5 sm:p-4 flex items-center gap-2 sm:gap-4">
              <div className="h-9 w-9 sm:h-12 sm:w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <TrendingUp className="h-4 w-4 sm:h-6 sm:w-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">إجمالي الأرباح</p>
                <p className="text-sm sm:text-base lg:text-xl font-bold text-primary tabular-nums whitespace-nowrap truncate leading-tight">₪{paymentSummary.total_profit.toLocaleString()}</p>
              </div>
            </Card>
          )}

          {/* Wallet Balance - Show only if we owe customer MORE than their debt (net credit) */}
          {walletBalance.total_refunds > 0 && (
            <Card className="p-2.5 sm:p-4 flex items-center gap-2 sm:gap-4 border-amber-500/30 bg-amber-500/5">
              <div className="h-9 w-9 sm:h-12 sm:w-12 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                <Banknote className="h-4 w-4 sm:h-6 sm:w-6 text-amber-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-xs text-amber-700 truncate">مرتجع للعميل</p>
                <p className="text-sm sm:text-base lg:text-xl font-bold text-amber-600 tabular-nums whitespace-nowrap truncate leading-tight">₪{walletBalance.total_refunds.toLocaleString()}</p>
                <p className="text-[9px] sm:text-[10px] text-amber-600/70 leading-tight">نحن مدينون للعميل بهذا المبلغ</p>
              </div>
            </Card>
          )}
        </div>

        {brokerDebts.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-sky-500/30 bg-sky-500/5 text-sky-900 dark:text-sky-200">
            <Handshake className="h-4 w-4 mt-0.5 shrink-0 text-sky-600" />
            <div className="text-xs leading-relaxed space-y-0.5">
              <p>هذه المبالغ مستحقة على الوسيط وليس على العميل — تُتابع في حساب الوسيط:</p>
              {brokerDebts.map(b => (
                <p key={b.brokerId}>
                  <span className="font-bold ltr-nums">₪{b.amount.toLocaleString()}</span>
                  {' '}على الوسيط{' '}
                  <span className="font-semibold">{b.brokerName}</span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Tabs — horizontal scroll on mobile, wrap on desktop */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full" dir="rtl">
          <TabsList className="w-full justify-start bg-muted/50 p-1 h-auto flex-nowrap overflow-x-auto sm:flex-wrap">
            <TabsTrigger value="overview" className="gap-1.5 shrink-0 whitespace-nowrap">
              <User className="h-4 w-4" />
              نظرة عامة
            </TabsTrigger>
            <TabsTrigger value="policies" className="gap-1.5 shrink-0 whitespace-nowrap">
              <FileText className="h-4 w-4" />
              المعاملات ({dedupedPolicyCount})
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5 shrink-0 whitespace-nowrap">
              <CreditCard className="h-4 w-4" />
              سجل الدفعات ({groupedPayments.length})
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
            <TabsTrigger value="files-system" className="gap-1.5 shrink-0 whitespace-nowrap">
              <FolderOpen className="h-4 w-4" />
              ملفات النظام ({systemFilesCount})
            </TabsTrigger>
            <TabsTrigger value="files-client" className="gap-1.5 shrink-0 whitespace-nowrap">
              <FileImage className="h-4 w-4" />
              ملفات العميل ({clientFilesCount})
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
                    <dd>
                      {client.phone_number ? (
                        <ClickablePhone phone={client.phone_number} />
                      ) : (
                        <span className="font-mono ltr-nums">-</span>
                      )}
                    </dd>
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
                <h3 className="font-semibold text-lg">معاملات التأمين</h3>
                <button
                  type="button"
                  onClick={handleRevealDocs}
                  className="text-sm text-muted-foreground hover:text-purple-600 underline underline-offset-2 transition-colors"
                >
                  {dedupedPolicyCount} معاملة مسجلة
                </button>
              </div>
              {policiesLocked ? (
                <Button
                  onClick={openPolicyWizardGated}
                  variant="outline"
                  className="h-11 px-4 rounded-full gap-2 shadow-md hover:shadow-lg border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 active:scale-[0.98] text-[15px]"
                  title="تجاوزت حد المعاملات — اضغط للترقية"
                >
                  <Lock className="h-4 w-4" />
                  <span>إضافة معاملة جديدة</span>
                  <Sparkles className="h-3.5 w-3.5 opacity-70" />
                </Button>
              ) : (
                <Button
                  onClick={openPolicyWizardGated}
                  disabled={limitsLoading}
                  className="h-11 px-4 rounded-full gap-2 shadow-md hover:shadow-lg hover:shadow-foreground/20 active:scale-[0.98] text-[15px] bg-foreground text-background hover:bg-foreground/90"
                >
                  <Plus className="h-4 w-4" />
                  <span>إضافة معاملة جديدة</span>
                </Button>
              )}
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
                    placeholder="بحث برقم المعاملة، الشركة..."
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
                  {policies.length > 0 ? 'لا توجد معاملات تطابق معايير البحث' : 'لا توجد معاملات تأمين'}
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
                fileCounts={policyFileCounts}
                onOpenPolicyFiles={(policyId) => {
                  // Files shortcut on the policy card → drawer opens
                  // pre-positioned to the ملفات tab.
                  setSelectedPolicyId(policyId);
                  setPolicyDetailsInitialSection('files');
                  setPolicyDetailsOpen(true);
                }}
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
                  setTransferOpen(true);
                }}
                onCancelPolicy={(policyId) => {
                  const p = policies.find((x) => x.id === policyId);
                  if (!p) return;
                  setCancelPolicyIds([policyId]);
                  setCancelInsurancePrice(Number(p.insurance_price) || 0);
                  setCancelPolicyNumber(p.policy_number);
                  setCancelDocumentNumber((p as any).document_number ?? null);
                  setCancelModalOpen(true);
                }}
                onTransferPackage={(policyIds) => {
                  if (policyIds.length === 0) return;
                  // Pick the same "primary" policy the card chip shows
                  // (THIRD_FULL > ELZAMI > addons) so the رقم المعاملة
                  // in the dialog/SMS matches the number the staff just
                  // clicked. Falling back to policyIds[0] hit whichever
                  // row happened to be first in the group (often ELZAMI),
                  // which has its own doc number one off from the card.
                  const pkgPolicies = policies.filter((p) => policyIds.includes(p.id));
                  const primaryDoc = pickPackageDocumentNumber(pkgPolicies);
                  const primary = (primaryDoc && pkgPolicies.find(p => p.document_number === primaryDoc))
                    || pkgPolicies[0];
                  setSelectedPolicyId(primary?.id ?? policyIds[0]);
                  setTransferOpen(true);
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
                  // Use the same "primary" policy the card chip shows
                  // (THIRD_FULL > ELZAMI > addons) for labels/SMS, so
                  // رقم المعاملة in the dialog matches the card header.
                  // Plain packagePolicies[0] picked up whichever sibling
                  // was first in the filter output and surfaced a
                  // document_number off-by-one from what the user saw.
                  const primaryDoc = pickPackageDocumentNumber(packagePolicies);
                  const primary = (primaryDoc && packagePolicies.find(p => p.document_number === primaryDoc))
                    || packagePolicies[0];
                  setCancelPolicyIds(policyIds);
                  setCancelInsurancePrice(totalPrice);
                  setCancelPolicyNumber(primary.policy_number);
                  setCancelDocumentNumber((primary as any).document_number ?? null);
                  setCancelModalOpen(true);
                }}
                onDeletePolicy={isAdmin ? (policyIds) => {
                  setDeletePolicyIds(policyIds);
                  setDeletePolicyDialogOpen(true);
                } : undefined}
                onPoliciesUpdate={fetchPolicies}
                onRenewPolicy={handleRenewPolicy}
                onRenewPackage={handleRenewPackage}
                onEditPolicy={(policyId) => {
                  // PackagePolicyEditModal fetches the row itself, so the
                  // dropdown handler just needs to hand off the policy id.
                  setEditPolicyId(policyId);
                  setEditPolicyOpen(true);
                }}
                onEditPackage={(groupId) => {
                  setEditPackageGroupId(groupId);
                }}
              />
            )}
          </TabsContent>

          {/* Payments Tab */}
          <TabsContent value="payments" className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-lg ml-2">سجل الدفعات</h3>
              <div className="flex items-center gap-2 flex-wrap mr-auto">
                <div className="relative w-full sm:w-72 md:w-96">
                  <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    type="search"
                    value={paymentSearch}
                    onChange={(e) => setPaymentSearch(e.target.value)}
                    placeholder="بحث في الدفعات..."
                    className="h-8 w-full pr-8 text-sm"
                  />
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {filteredDisplayRows.length} سند
                </span>
                <AccountingFilters
                  value={paymentFilters}
                  onChange={setPaymentFilters}
                  companyOptions={[]}
                  typeOptions={paymentTypeOptions}
                  paymentMethodOptions={paymentMethodOptions}
                  show={{
                    dateRange: true,
                    types: paymentTypeOptions.length > 0,
                    paymentMethods: paymentMethodOptions.length > 0,
                    companies: false,
                  }}
                />
              </div>
            </div>

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
                      <TableHead className="text-right">رقم السند</TableHead>
                      <TableHead className="text-right">المبلغ</TableHead>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">طريقة الدفع</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="text-right">ملفات</TableHead>
                      <TableHead className="text-right w-[60px]">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDisplayRows.map((row) => {
                      if (row.kind === 'disbursement') {
                        const d = row.disb;
                        const methodLabel = d.paymentMethod
                          ? PAYMENT_TYPE_LABELS[d.paymentMethod] || d.paymentMethod
                          : null;
                        return (
                          <TableRow
                            key={`disbursement-${d.id}`}
                            className="hover:bg-muted/40 bg-sky-50/40 dark:bg-sky-950/10"
                          >
                            <TableCell className="font-mono text-xs ltr-nums whitespace-nowrap">
                              <span className="font-bold text-sky-700 dark:text-sky-300">
                                {d.voucherNumber}
                              </span>
                            </TableCell>
                            <TableCell className="font-semibold">
                              <span className="text-sky-700 dark:text-sky-300">
                                ₪{Math.round(d.amount).toLocaleString()}
                              </span>
                            </TableCell>
                            <TableCell>{formatDate(d.date)}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/30"
                              >
                                سند صرف
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-start gap-0.5">
                                {methodLabel && (
                                  <span className="text-[10px] text-muted-foreground">
                                    طريقة الصرف: {methodLabel}
                                  </span>
                                )}
                                {d.description && (
                                  <span
                                    className="text-[10px] text-muted-foreground max-w-[220px] truncate"
                                    title={d.description}
                                  >
                                    {d.description}
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground">
                                  المبلغ خرج من صندوق الشركة — لا يضيف للعميل رصيداً
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-muted-foreground">—</span>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={generatingReceipt === `disbursement-${d.id}`}
                                    onClick={() => handlePrintDisbursement(d.id, d.voucherNumber)}
                                  >
                                    {generatingReceipt === `disbursement-${d.id}` ? (
                                      <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                                    ) : (
                                      <Receipt className="h-4 w-4 ml-2" />
                                    )}
                                    طباعة سند الصرف
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      if (row.kind === 'credit_note') {
                        const n = row.note;
                        return (
                          <TableRow
                            key={`credit-${n.id}`}
                            className="hover:bg-muted/40 bg-emerald-50/40 dark:bg-emerald-950/10"
                          >
                            <TableCell className="font-mono text-xs ltr-nums whitespace-nowrap">
                              <span className="font-bold text-emerald-700 dark:text-emerald-300">
                                {n.voucherNumber}
                              </span>
                            </TableCell>
                            <TableCell className="font-semibold">
                              <span className="text-emerald-700 dark:text-emerald-300">
                                ₪{Math.round(n.amount).toLocaleString()}
                              </span>
                            </TableCell>
                            <TableCell>{formatDate(n.date)}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                              >
                                اشعار دائن
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-start gap-0.5">
                                {n.description && (
                                  <span
                                    className="text-[10px] text-muted-foreground max-w-[220px] truncate"
                                    title={n.description}
                                  >
                                    {n.description}
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground">
                                  رصيد للعميل — يُحسم تلقائياً من أي دفعة قادمة
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-muted-foreground">—</span>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={generatingReceipt === `credit-${n.id}`}
                                    onClick={() => handlePrintCreditNote(n.id, n.voucherNumber)}
                                  >
                                    {generatingReceipt === `credit-${n.id}` ? (
                                      <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                                    ) : (
                                      <Receipt className="h-4 w-4 ml-2" />
                                    )}
                                    طباعة الإشعار
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      if (row.kind === 'debit_note') {
                        const n = row.note;
                        return (
                          <TableRow
                            key={`debit-${n.id}`}
                            className="hover:bg-muted/40 bg-rose-50/40 dark:bg-rose-950/10"
                          >
                            <TableCell className="font-mono text-xs ltr-nums whitespace-nowrap">
                              <span className="font-bold text-rose-700 dark:text-rose-300">
                                {n.voucherNumber}
                              </span>
                            </TableCell>
                            <TableCell className="font-semibold">
                              <span className="text-rose-700 dark:text-rose-300">
                                ₪{Math.round(n.amount).toLocaleString()}
                              </span>
                            </TableCell>
                            <TableCell>{formatDate(n.date)}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="border-rose-500/40 text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30"
                              >
                                اشعار مدين
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-start gap-0.5">
                                {n.description && (
                                  <span
                                    className="text-[10px] text-muted-foreground max-w-[220px] truncate"
                                    title={n.description}
                                  >
                                    {n.description}
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground">
                                  مستحق على العميل — يُضاف إلى دينه ويُخصم من أول دفعة
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-muted-foreground">—</span>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={generatingReceipt === `credit-${n.id}`}
                                    onClick={() => handlePrintCreditNote(n.id, n.voucherNumber)}
                                  >
                                    {generatingReceipt === `credit-${n.id}` ? (
                                      <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                                    ) : (
                                      <Receipt className="h-4 w-4 ml-2" />
                                    )}
                                    طباعة الإشعار
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      if (row.kind === 'voucher') {
                        const v = row.voucher;
                        return (
                          <TableRow
                            key={`voucher-${v.id}`}
                            className="hover:bg-muted/40 bg-amber-50/40 dark:bg-amber-950/10"
                          >
                            <TableCell className="font-mono text-xs ltr-nums whitespace-nowrap">
                              <span className="font-bold text-amber-700 dark:text-amber-300">
                                {/* Display as R{N}/{YYYY} — same shape as
                                    سند قبض numbers so the bookkeeper
                                    can read both numbering schemes at a
                                    glance without mental conversion. */}
                                R{v.voucherNumber}/{new Date(v.date).getFullYear()}
                              </span>
                            </TableCell>
                            <TableCell className="font-semibold">
                              <span className="text-amber-700 dark:text-amber-300">
                                ₪{Math.round(v.amount).toLocaleString()}
                              </span>
                            </TableCell>
                            <TableCell>{formatDate(v.date)}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className="border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30"
                              >
                                سند إلغاء
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-start gap-0.5">
                                {v.sourceReceiptNumber && (
                                  <span className="text-[10px] font-mono ltr-nums text-muted-foreground">
                                    ألغى {v.sourceReceiptNumber}
                                  </span>
                                )}
                                {v.reason && (
                                  <span
                                    className="text-[10px] text-muted-foreground max-w-[180px] truncate"
                                    title={v.reason}
                                  >
                                    السبب: {v.reason}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-muted-foreground">—</span>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={generatingReceipt === `voucher-${v.id}`}
                                    onClick={() => handlePrintCancellationVoucher(v.id, v.voucherNumber)}
                                  >
                                    {generatingReceipt === `voucher-${v.id}` ? (
                                      <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                                    ) : (
                                      <Receipt className="h-4 w-4 ml-2" />
                                    )}
                                    طباعة سند الإلغاء
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      const group = row.group;
                      // A session row can mix payment methods (cash +
                      // cheque + visa all handed over in one visit), so
                      // use the combined label which dedupes types. A
                      // single-method row falls back to "نقدي" / "شيك"
                      // exactly as before.
                      const paymentLabel = group.paymentTypes.length > 1
                        ? getCombinedPaymentTypeLabel(group.payments)
                        : getPaymentTypeLabel({
                            payment_type: group.payment_type,
                            locked: group.locked,
                          });
                      // Cheque-number column was removed from سجل الدفعات
                      // per the user's request — the inline "N شيكات"
                      // pill belongs in the details popup, not the list.
                      return (
                      <TableRow
                        key={group.id}
                        className={cn(
                          'hover:bg-muted/40',
                          // Passthrough rows render in a muted strip so
                          // the bookkeeper can tell at a glance they're
                          // informational (money the office never
                          // actually collected — إلزامي / visa_external).
                          group.isPassthrough && 'bg-muted/30 text-muted-foreground',
                        )}
                      >
                        <TableCell className="font-mono text-xs ltr-nums whitespace-nowrap">
                          {group.isPassthrough ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            group.receipt_number || '—'
                          )}
                        </TableCell>
                        <TableCell className="font-semibold">
                          <div className="flex items-center gap-1">
                            ₪{group.totalAmount.toLocaleString()}
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(group.payment_date)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline">{paymentLabel}</Badge>
                            {group.payment_type === 'visa' && group.card_last_four && (
                              <span className="text-xs text-muted-foreground font-mono">
                                *{group.card_last_four}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {group.isPassthrough ? (
                            <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground text-[10px]">
                              إلزامي / فيزا خارجي
                            </Badge>
                          ) : group.refused ? (
                            (() => {
                              // For a cancelled row we surface the linked
                              // سند الإلغاء number and the bookkeeper's
                              // stated reason. We dedupe per session in
                              // the fetch step, so every payment of the
                              // same session lands on the same voucher
                              // number — one receipt cancelled = one
                              // voucher, not N.
                              const info = group.payments
                                .map((p) => cancellationInfo.get(p.id))
                                .find((x) => x != null);
                              return (
                                <div className="flex flex-col items-start gap-0.5">
                                  <Badge variant="destructive">ملغي</Badge>
                                  {info?.voucherNumber != null && (
                                    <span className="text-[10px] font-mono ltr-nums text-muted-foreground">
                                      سند الإلغاء R{String(info.voucherNumber)}/{info.year}
                                    </span>
                                  )}
                                  {info?.reason && (
                                    <span
                                      className="text-[10px] text-muted-foreground max-w-[180px] truncate"
                                      title={info.reason}
                                    >
                                      السبب: {info.reason}
                                    </span>
                                  )}
                                </div>
                              );
                            })()
                          ) : (
                            <Badge variant="success">مقبول</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {group.isPassthrough ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <ChequeImageGallery
                              primaryImageUrl={group.cheque_image_url}
                              paymentId={group.payments[0]?.id || group.id}
                              batchPaymentIds={group.payments.map(p => p.id)}
                              hasBatchImages={group.payments.some(p => p.has_images)}
                            />
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {group.isPassthrough ? (
                            // Passthrough rows (إلزامي / فيزا خارجي) skip
                            // the receipt-cancellation flow — there's no
                            // money in the office to refund, so a plain
                            // delete is the right action. Gated on a
                            // single row + not yet printed; multi-row
                            // and printed passthroughs stay read-only.
                            group.payments.length === 1 && !group.printed ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
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
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )
                          ) : (
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
                                طباعة سند القبض
                              </DropdownMenuItem>

                              {/* إلغاء السند — customer-scope void. Scope
                                  matches the printed كشف القبض so a
                                  click here reverses every non-إلزامي
                                  payment of this customer (incl. batch
                                  siblings) and lets the trigger emit
                                  paired cancellation vouchers. Hidden
                                  on cancelled rows — re-cancelling has
                                  no effect. */}
                              {group.payments.some((p) => !p.refused) && (
                                <DropdownMenuItem
                                  className="text-amber-700 focus:text-amber-800"
                                  disabled={cancelResolving}
                                  onClick={openCancelPaymentDialog}
                                >
                                  <Ban className="h-4 w-4 ml-2" />
                                  إلغاء السند
                                </DropdownMenuItem>
                              )}

                              {/* "تعديل" — opens the existing
                                  PaymentGroupDetailsDialog (same dialog
                                  the row-click already opens) where the
                                  user can edit each line of the session
                                  via its own pencil button. Disabled
                                  once any row in the session is printed
                                  (printed_at set) — printed receipts
                                  are immutable, only إلغاء stays open.
                                  Cancelled rows hide the option entirely
                                  since edit-on-cancelled doesn't apply. */}
                              {!group.refused && (
                                group.printed ? (
                                  <TooltipProvider delayDuration={200}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        {/* span wrapper so Tooltip can hook
                                            into the disabled item */}
                                        <span>
                                          <DropdownMenuItem
                                            disabled
                                            onSelect={(e) => e.preventDefault()}
                                            className="opacity-50 cursor-not-allowed"
                                          >
                                            <Edit className="h-4 w-4 ml-2" />
                                            تعديل
                                          </DropdownMenuItem>
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent side="left" className="text-xs max-w-[220px]">
                                        تمت طباعة السند — التعديل غير متاح. الإلغاء فقط.
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : (
                                  <DropdownMenuItem
                                    onClick={() => {
                                      // Unified edit flow: open the same
                                      // DebtPaymentModal used for "دفع",
                                      // but seeded with this session's
                                      // existing rows so the user can
                                      // re-allocate the same wallet room
                                      // (or add/remove lines). On submit
                                      // the old session is DELETEd and
                                      // recreated — no per-row UPDATE.
                                      setDebtModalEditingSession({
                                        id: group.id,
                                        paymentIds: group.payments.map((p) => p.id),
                                        payments: group.payments.map((p) => ({
                                          id: p.id,
                                          amount: Number(p.amount || 0),
                                          payment_type: p.payment_type,
                                          payment_date: p.payment_date,
                                          cheque_number: p.cheque_number,
                                          cheque_date: (p as any).cheque_date ?? null,
                                          cheque_issue_date: (p as any).cheque_issue_date ?? null,
                                          bank_code: p.bank_code ?? null,
                                          branch_code: p.branch_code ?? null,
                                          cheque_image_url: p.cheque_image_url,
                                          notes: p.notes,
                                          batch_id: p.batch_id,
                                          locked: p.locked,
                                        })),
                                        totalAmount: group.totalAmount,
                                        receiptNumber: group.receipt_number,
                                      });
                                      setDebtPaymentModalOpen(true);
                                    }}
                                  >
                                    <Edit className="h-4 w-4 ml-2" />
                                    تعديل
                                  </DropdownMenuItem>
                                )
                              )}
                              {/* Delete stays available for single-row
                                  manual receipts only — never for auto
                                  rows (they go through إلغاء) and never
                                  for already-refused/locked rows. */}
                              {group.payments.length === 1 &&
                                !group.locked &&
                                !group.payments[0].refused &&
                                !group.printed && (
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
                            </DropdownMenuContent>
                          </DropdownMenu>
                          )}
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
              <Button variant="gradient" onClick={() => setCarDrawerOpen(true)}>
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
                      <TableHead className="text-right">المعاملات</TableHead>
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
                              <Badge variant="secondary">{policyCount} معاملة</Badge>
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
                                  {!canDelete && <span className="text-xs mr-2">(مرتبطة بمعاملات)</span>}
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

          {/* System Files Tab — internal/CRM docs across all of the client's policies */}
          <TabsContent value="files-system" className="mt-6">
            <ClientFilesTab
              policies={clientFilesPolicyRefs}
              kind="system"
              clientId={client.id}
              onCountChange={setSystemFilesCount}
            />
          </TabsContent>

          {/* Client Files Tab — insurance/policy docs across all of the client's policies */}
          <TabsContent value="files-client" className="mt-6">
            <ClientFilesTab
              policies={clientFilesPolicyRefs}
              kind="client"
              onCountChange={setClientFilesCount}
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
        onOpenChange={(open) => {
          setPolicyDetailsOpen(open);
          // Reset to main when the drawer closes so the next opener
          // gets the default landing tab (the ملفات button explicitly
          // sets 'files' just before opening).
          if (!open) setPolicyDetailsInitialSection('main');
        }}
        policyId={selectedPolicyId}
        initialSection={policyDetailsInitialSection}
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

      {/* Customer Statement Modal — per-year كشف حساب */}
      <CustomerStatementModal
        open={reportModalOpen}
        onOpenChange={setReportModalOpen}
        clientId={client.id}
        clientName={client.full_name}
        clientPhone={client.phone_number}
        policies={policies.map((p) => ({ start_date: p.start_date }))}
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
            documentNumber={(selectedPolicy as any)?.document_number || null}
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
            onTransferred={async (voucher) => {
              setTransferOpen(false);
              // Small delay to ensure DB commits are complete
              await new Promise(resolve => setTimeout(resolve, 100));
              await Promise.all([
                fetchPolicies(),
                fetchPaymentSummary(),
                fetchPayments(),
                // Transfer can mint a brand-new car (the "+ إضافة
                // سيارة جديدة" path); without refetching, the cars
                // filter and the new transaction's car badge stay
                // stuck on the prior list until the page is reloaded.
                fetchCars(),
              ]);
              onRefresh();
              if (voucher) {
                setVoucherDialogPayload(voucher);
                setVoucherDialogOpen(true);
              }
            }}
          />
        );
      })()}

      {/* Policy edit modal — opened directly from the timeline dropdown
          for single policies. Same component used for packages, just with
          policyId instead of groupId. */}
      {editPolicyId && (
        <PackagePolicyEditModal
          open={editPolicyOpen}
          onOpenChange={(open) => {
            setEditPolicyOpen(open);
            if (!open) setEditPolicyId(null);
          }}
          policyId={editPolicyId}
          onSaved={async () => {
            setEditPolicyOpen(false);
            setEditPolicyId(null);
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
            setCancelDocumentNumber(null);
          }
        }}
        policyIds={cancelPolicyIds}
        policyNumber={cancelPolicyNumber}
        documentNumber={cancelDocumentNumber}
        clientId={client.id}
        clientName={client.full_name}
        clientPhone={client.phone_number}
        branchId={client.branch_id}
        insurancePrice={cancelInsurancePrice}
        onCancelled={async (voucher) => {
          setCancelModalOpen(false);
          setCancelPolicyIds([]);
          setCancelInsurancePrice(0);
          setCancelPolicyNumber(null);
          setCancelDocumentNumber(null);
          // Wallet balance feeds the "مرتجع للعميل" card and the
          // client-header net-remaining math. Without refreshing it
          // here, a refund booked as part of the cancellation only
          // showed up after a full page reload.
          await Promise.all([
            fetchPolicies(),
            fetchPaymentSummary(),
            fetchWalletBalance(),
            fetchPayments(),
          ]);
          if (voucher) {
            setVoucherDialogPayload(voucher);
            setVoucherDialogOpen(true);
          }
        }}
      />

      {/* Debt Payment Modal */}
      <DebtPaymentModal
        open={debtPaymentModalOpen}
        onOpenChange={(open) => {
          setDebtPaymentModalOpen(open);
          if (!open) setDebtModalEditingSession(null);
        }}
        clientId={client.id}
        clientName={client.full_name}
        clientPhone={client.phone_number}
        totalOwed={paymentSummary.total_remaining}
        editingSession={debtModalEditingSession}
        onSuccess={async (paymentIds) => {
          const wasEditMode = debtModalEditingSession !== null;
          setDebtPaymentModalOpen(false);
          setDebtModalEditingSession(null);
          await Promise.all([
            fetchPaymentSummary(),
            fetchPayments(),
            fetchPolicies(),
          ]);
          // Surface the print/SMS/WhatsApp dialog only for newly
          // created سند قبض sessions — edit mode restamps existing
          // rows and returns an empty list.
          if (!wasEditMode && paymentIds.length > 0) {
            setReceiptPaymentIds(paymentIds);
            setReceiptDialogOpen(true);
          }
        }}
      />

      <DebtPaymentSuccessDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        paymentIds={receiptPaymentIds}
        clientPhone={client.phone_number}
        onClose={() => setReceiptPaymentIds([])}
      />

      <VoucherSendDialog
        open={voucherDialogOpen}
        onOpenChange={setVoucherDialogOpen}
        voucher={voucherDialogPayload}
        clientPhone={client.phone_number}
        onClose={() => setVoucherDialogPayload(null)}
      />

      {/* Shared print-progress overlay used by both handlePrintGroup-
          Receipts (سند قبض) and handlePrintCancellationVoucher (سند
          إلغاء). The title prop swaps based on which handler set it
          so the spinner reflects the actual document being prepared. */}
      <PrintProgressDialog
        open={printProgress.open}
        value={printProgress.value}
        title={printProgress.title}
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
        onEdit={() => {
          // Pencil inside the details popup now routes to the same
          // session-level edit flow as the "تعديل" dropdown — the
          // accounting rule is "delete the whole unprinted draft and
          // rewrite", so per-row UPDATE doesn't apply anymore. We
          // ignore the clicked row and edit the entire session.
          const g = groupDetailsGroup;
          if (!g || g.printed || g.refused) return;
          setDebtModalEditingSession({
            id: g.id,
            paymentIds: g.payments.map((p) => p.id),
            payments: g.payments.map((p) => ({
              id: p.id,
              amount: Number(p.amount || 0),
              payment_type: p.payment_type,
              payment_date: p.payment_date,
              cheque_number: p.cheque_number,
              cheque_date: (p as any).cheque_date ?? null,
              cheque_issue_date: (p as any).cheque_issue_date ?? null,
              bank_code: p.bank_code ?? null,
              branch_code: p.branch_code ?? null,
              cheque_image_url: p.cheque_image_url,
              notes: p.notes,
              batch_id: p.batch_id,
              locked: p.locked,
            })),
            totalAmount: g.totalAmount,
            receiptNumber: g.receipt_number,
          });
          setGroupDetailsOpen(false);
          setDebtPaymentModalOpen(true);
        }}
        onDelete={(payment) => {
          setPendingReopenGroupKey(groupDetailsGroup?.id ?? null);
          setDeletePaymentId(payment.id);
          setDeletePaymentDialogOpen(true);
        }}
      />

      {/* Cancel-payment reason prompt. Scope was pre-resolved in
          openCancelPaymentDialog so the count + total reflect every
          customer payment that will be voided (incl. batch siblings),
          not just the row the user clicked. The bookkeeper sees what
          they're about to do before confirming. */}
      <Dialog
        open={cancelReasonOpen}
        onOpenChange={(o) => {
          if (!o) {
            setCancelReasonOpen(false);
            setCancelTargetIds([]);
            setCancelTargetSum(0);
            setCancelReasonText('');
            setCancelReasonError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" dir="rtl">
          {(() => {
            // Decide the dialog's regime from the target rows' print
            // state — same predicate as confirmCancelPayment. Printed
            // → real إلغاء with reason + سند إلغاء; unprinted draft
            // → clean DELETE, no reason needed.
            const targetSet = new Set(cancelTargetIds);
            const anyPrinted = payments.some(
              (p) => targetSet.has(p.id) && p.printed_at != null,
            );
            return (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {anyPrinted ? 'إلغاء سندات القبض' : 'حذف سندات القبض (لم تُطبع)'}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 pt-2">
                  <p className="text-xs text-muted-foreground">
                    {anyPrinted ? (
                      <>
                        سيُنشأ سند إلغاء لكل واحد من{' '}
                        <span className="font-bold ltr-nums">{cancelTargetIds.length}</span>{' '}
                        {cancelTargetIds.length === 1 ? 'سند' : 'سندات'} لهذا العميل بقيمة إجمالية{' '}
                        <span className="font-bold ltr-nums">
                          ₪{Math.round(cancelTargetSum).toLocaleString('en-US')}
                        </span>
                        . رصيد العميل سيرتد بالكامل كما لو لم يدفع.
                      </>
                    ) : (
                      <>
                        السند لم يُطبع بعد ولم يُسلَّم للعميل، لذا سيُحذف نهائياً بدون سند إلغاء.{' '}
                        <span className="font-bold ltr-nums">{cancelTargetIds.length}</span>{' '}
                        {cancelTargetIds.length === 1 ? 'سند' : 'سندات'} بقيمة إجمالية{' '}
                        <span className="font-bold ltr-nums">
                          ₪{Math.round(cancelTargetSum).toLocaleString('en-US')}
                        </span>
                        . رصيد العميل سيرتد بالكامل.
                      </>
                    )}
                  </p>
                  {anyPrinted && (
                    <>
                      <Label htmlFor="cancel-payment-reason">
                        سبب الإلغاء<span className="text-destructive mr-1">*</span>
                      </Label>
                      <Textarea
                        id="cancel-payment-reason"
                        value={cancelReasonText}
                        onChange={(e) => {
                          setCancelReasonText(e.target.value);
                          if (e.target.value.trim()) setCancelReasonError(null);
                        }}
                        placeholder="مثال: العميل طلب الإلغاء، خطأ في الإصدار، شيك مكرر..."
                        rows={3}
                        autoFocus
                        disabled={cancelSubmitting}
                      />
                      {cancelReasonError && (
                        <p className="text-sm text-destructive">{cancelReasonError}</p>
                      )}
                    </>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCancelReasonOpen(false)}
                    disabled={cancelSubmitting}
                  >
                    تراجع
                  </Button>
                  <Button
                    variant={anyPrinted ? 'default' : 'destructive'}
                    onClick={confirmCancelPayment}
                    disabled={cancelSubmitting || (anyPrinted && !cancelReasonText.trim())}
                  >
                    {cancelSubmitting ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                    {anyPrinted ? 'تأكيد الإلغاء' : 'حذف نهائي'}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Super Admin: Delete Policy Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deletePolicyDialogOpen}
        onOpenChange={(open) => {
          setDeletePolicyDialogOpen(open);
          if (!open) setDeletePolicyIds([]);
        }}
        onConfirm={handleDeletePolicy}
        title="حذف المعاملة نهائياً"
        description={`هل أنت متأكد من حذف ${deletePolicyIds.length > 1 ? `${deletePolicyIds.length} معاملات` : 'هذه المعاملة'} نهائياً؟ سيتم حذف جميع البيانات المرتبطة (الدفعات، القيود المحاسبية، الملفات). هذا الإجراء لا يمكن التراجع عنه!`}
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
