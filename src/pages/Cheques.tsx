import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Upload,
  MessageSquare,
  Edit,
  BarChart3,
  CheckSquare,
  ChevronDown,
  User,
  Loader2,
  Plus,
  Pencil,
  Calendar,
  MoreVertical,
  Building2,
  FileText,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PdfJsViewer } from "@/components/policies/PdfJsViewer";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { useToast } from "@/hooks/use-toast";
import { useSmsLock } from "@/hooks/useSmsLock";
import { Lock } from "@phosphor-icons/react";
import { PolicyDetailsDrawer } from "@/components/policies/PolicyDetailsDrawer";
import { AgentBranchFilter } from "@/components/shared/AgentBranchFilter";
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH, getEffectiveChequeStatus, isChequeOverdue } from "@/lib/chequeUtils";
import { AddCustomerChequeModal } from "@/components/cheques/AddCustomerChequeModal";
import { PaymentEditDialog } from "@/components/clients/PaymentEditDialog";
import { EditSettlementDialog, type SettlementTable } from "@/components/accounting/EditSettlementDialog";
import type { SettlementRow } from "@/components/accounting/SettlementsTable";
import { getBankName } from "@/lib/banks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PaymentImage {
  id: string;
  image_url: string;
  image_type: string;
}

interface ChequeRecord {
  id: string;
  policy_id: string;
  amount: number;
  /** Mirror of cheque_due_date for legacy code that still keys off
   *  payment_date. The "تاريخ الاستحقاق" column on the page reads
   *  cheque_due_date directly. */
  payment_date: string;
  /** تاريخ الاستحقاق — when the cheque can be cashed. Falls back to
   *  payment_date for rows written before the column existed. */
  cheque_due_date?: string | null;
  /** تاريخ الإصدار — when the customer wrote / we issued the cheque. */
  cheque_issue_date?: string | null;
  cheque_number: string | null;
  cheque_date: string | null;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url: string | null;
  cheque_status: string | null;
  refused: boolean | null;
  notes: string | null;
  policy: {
    id: string;
    policy_type_parent: string;
    client: { id: string; full_name: string; broker_id: string | null; phone_number: string | null } | null;
    car: { car_number: string } | null;
  } | null;
  broker_name?: string;
  images?: PaymentImage[];
  // Transfer info
  transferred_to_type?: string | null;
  transferred_to_id?: string | null;
  transferred_to_name?: string | null;
  transferred_payment_id?: string | null;
  /** What surface this cheque was written on. `customer` = a cheque
   *  the client gave us (policy_payments). The other values come from
   *  outgoing settlement vouchers — same cheque book, opposite flow. */
  source?: 'customer' | 'company' | 'broker' | 'expense';
  /** Multi-split grouping. When a single physical cheque pays several
   *  policies (debt-settlement modal splits it across the smallest-
   *  remaining first), all the rows share the same batch_id. The
   *  cheques page collapses them into one logical row whose `amount`
   *  is the SUM and whose `member_ids` / `member_policy_ids` carry the
   *  underlying policy_payments rows so mutations (status change, edit
   *  cheque number, etc.) propagate to all of them. */
  batch_id?: string | null;
  member_ids?: string[];
  member_policy_ids?: string[];
}

interface CustomerGroup {
  customerId: string;
  customerName: string;
  phone: string | null;
  cheques: ChequeRecord[];
  totalAmount: number;
  pendingAmount: number;
  overdueCount: number;
}

interface MonthlyStats {
  month: string;
  total: number;
  totalAmount: number;
  pending: number;
  pendingAmount: number;
  cashed: number;
  cashedAmount: number;
  returned: number;
  returnedAmount: number;
}

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "قيد الانتظار", variant: "secondary" },
  cashed: { label: "تم صرفه", variant: "default" },
  returned: { label: "مرتجع", variant: "destructive" },
  cancelled: { label: "ملغي", variant: "outline" },
  transferred_out: { label: "تم استخدامه", variant: "default" },
};

export default function Cheques() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { locked: smsLocked, loading: smsLoading, openUpgradeDialog: openSmsUpgrade, guardSend: guardSmsSend } = useSmsLock();
  const [cheques, setCheques] = useState<ChequeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // Page-level branch filter — global admins only.
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("customer");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dueTodayOnly, setDueTodayOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 100; // Increased for tree view

  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Image upload state
  const [uploadingForChequeId, setUploadingForChequeId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Summary stats
  const [summaryStats, setSummaryStats] = useState({
    returnedCount: 0,
    returnedTotal: 0,
    pendingCount: 0,
    pendingTotal: 0,
    overdueCount: 0,
    overdueTotal: 0,
    dueTodayCount: 0,
    dueTodayTotal: 0,
  });

  // Monthly statistics
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats[]>([]);

  // Bulk selection
  const [selectedCheques, setSelectedCheques] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Edit cheque dialog
  const [editingCheque, setEditingCheque] = useState<ChequeRecord | null>(null);
  const [editChequeNumber, setEditChequeNumber] = useState("");
  const [editChequeNumberError, setEditChequeNumberError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // SMS dialog for returned cheques
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const [smsCheque, setSmsCheque] = useState<ChequeRecord | null>(null);
  const [smsMessage, setSmsMessage] = useState("");
  const [sendingSms, setSendingSms] = useState(false);

  // Reason prompt for إلغاء / رجع — both actions are "voiding" the
  // cheque (refused=true, removed from the customer's paid total) so
  // accounting wants a written explanation. Single shared dialog
  // keeps the surface area small; `reasonAction` swaps the wording.
  const [reasonDialogOpen, setReasonDialogOpen] = useState(false);
  const [reasonAction, setReasonAction] = useState<'cancelled' | 'returned' | null>(null);
  const [reasonChequeId, setReasonChequeId] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [reasonSubmitting, setReasonSubmitting] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState("list");

  // Policy details drawer
  const [policyDrawerOpen, setPolicyDrawerOpen] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);

  // Expanded customers in tree view
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set());

  // Full-payment edit dialog — opens the same PaymentEditDialog
  // clients see when they edit a payment from the policy timeline,
  // so staff can change cheque number, dates, bank/branch, etc. in
  // one place instead of the rename-only dialog.
  const [paymentEditRecord, setPaymentEditRecord] = useState<any>(null);
  const [paymentEditOpen, setPaymentEditOpen] = useState(false);
  const [loadingPaymentEdit, setLoadingPaymentEdit] = useState(false);
  // For multi-split cheques, every underlying policy_payments id so
  // the dialog can propagate edits/deletes to the whole batch instead
  // of just one allocation row.
  const [paymentEditMemberIds, setPaymentEditMemberIds] = useState<string[] | undefined>(undefined);

  // Outgoing-cheque edit dialog — companies / brokers / expenses.
  // Reuses EditSettlementDialog so the same fields the accounting
  // surface exposes (amount, date, cheque triple, dates, images,
  // notes) are editable from the cheques page too. Edits land on
  // the underlying *_settlements / expenses row, so the accounting
  // tab reflects the change immediately.
  const [outgoingEditRow, setOutgoingEditRow] = useState<SettlementRow | null>(null);
  const [outgoingEditTable, setOutgoingEditTable] = useState<SettlementTable>('company_settlements');
  const [outgoingEditOpen, setOutgoingEditOpen] = useState(false);

  const openOutgoingEditFor = (cheque: ChequeRecord) => {
    // Synthetic IDs follow `cs-<uuid>` / `bs-<uuid>` / `ex-<uuid>`
    // — strip the prefix to get the real row id.
    const id = cheque.id.startsWith('cs-')
      ? cheque.id.slice(3)
      : cheque.id.startsWith('bs-')
      ? cheque.id.slice(3)
      : cheque.id.startsWith('ex-')
      ? cheque.id.slice(3)
      : cheque.id;
    const table: SettlementTable =
      cheque.source === 'broker'
        ? 'broker_settlements'
        : cheque.source === 'expense'
        ? 'expenses'
        : 'company_settlements';
    // EditSettlementDialog only needs `id` to fetch the rest. Pass a
    // minimal SettlementRow shaped object — the dialog re-fetches
    // every field on open.
    setOutgoingEditRow({
      id,
      settlement_date: cheque.payment_date,
      total_amount: cheque.amount,
      payment_type: 'cheque',
      cheque_number: cheque.cheque_number,
      bank_code: cheque.bank_code,
      branch_code: cheque.branch_code,
      cheque_image_urls: cheque.cheque_image_url ? [cheque.cheque_image_url] : [],
      status: cheque.cheque_status ?? 'pending',
      refused: cheque.refused ?? false,
      notes: cheque.notes,
      entity_id: null,
      entity_name: null,
    } as SettlementRow);
    setOutgoingEditTable(table);
    setOutgoingEditOpen(true);
  };

  const openPaymentEditFor = async (cheque: ChequeRecord) => {
    setLoadingPaymentEdit(true);
    try {
      // Re-fetch the full payment row so we have every column the
      // edit dialog wants (cheque_date, bank_code, branch_code,
      // locked, card_last_four, insurance_price on the policy…).
      const { data, error } = await supabase
        .from('policy_payments')
        .select(`
          id, amount, payment_date, payment_type, cheque_number,
          cheque_date, cheque_due_date, cheque_issue_date,
          bank_code, branch_code, cheque_image_url,
          card_last_four, refused, notes, locked, policy_id,
          policies!policy_payments_policy_id_fkey(
            id, policy_type_parent, policy_type_child, insurance_price
          )
        `)
        .eq('id', cheque.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        toast({
          title: 'غير موجود',
          description: 'تعذر تحميل بيانات الدفعة',
          variant: 'destructive',
        });
        return;
      }
      const policy = Array.isArray((data as any).policies)
        ? (data as any).policies[0]
        : (data as any).policies;
      // For a multi-split cheque the per-row .amount is just one slice
      // (e.g. 250 of a 1000₪ cheque). Use the collapsed row's aggregate
      // so the dialog shows the actual face value the customer signed.
      const isSplit = !!(cheque.member_ids && cheque.member_ids.length > 1);
      setPaymentEditRecord({
        id: (data as any).id,
        amount: isSplit ? cheque.amount : (data as any).amount,
        payment_date: (data as any).payment_date,
        payment_type: (data as any).payment_type,
        cheque_number: (data as any).cheque_number,
        cheque_date: (data as any).cheque_date,
        cheque_due_date: (data as any).cheque_due_date,
        cheque_issue_date: (data as any).cheque_issue_date,
        bank_code: (data as any).bank_code,
        branch_code: (data as any).branch_code,
        cheque_image_url: (data as any).cheque_image_url,
        card_last_four: (data as any).card_last_four,
        refused: (data as any).refused,
        notes: (data as any).notes,
        locked: (data as any).locked,
        policy_id: (data as any).policy_id,
        policy: policy
          ? {
              id: policy.id,
              policy_type_parent: policy.policy_type_parent,
              policy_type_child: policy.policy_type_child,
              insurance_price: policy.insurance_price,
            }
          : null,
      });
      setPaymentEditMemberIds(isSplit ? cheque.member_ids : undefined);
      setPaymentEditOpen(true);
    } catch (err) {
      console.error('Error loading payment for edit:', err);
      toast({
        title: 'خطأ',
        description: 'فشل في تحميل بيانات الدفعة',
        variant: 'destructive',
      });
    } finally {
      setLoadingPaymentEdit(false);
    }
  };

  // Add customer cheque modal
  const [addChequeModalOpen, setAddChequeModalOpen] = useState(false);

  // Group cheques by customer
  const customerGroups = useMemo((): CustomerGroup[] => {
    const groups: Record<string, CustomerGroup> = {};
    
    cheques.forEach(cheque => {
      const customerId = cheque.policy?.client?.id || 'unknown';
      const customerName = cheque.policy?.client?.full_name || 'غير معروف';
      const phone = cheque.policy?.client?.phone_number || null;
      
      if (!groups[customerId]) {
        groups[customerId] = {
          customerId,
          customerName,
          phone,
          cheques: [],
          totalAmount: 0,
          pendingAmount: 0,
          overdueCount: 0,
        };
      }
      
      groups[customerId].cheques.push(cheque);
      groups[customerId].totalAmount += cheque.amount;
      
      const effectiveStatus = getEffectiveChequeStatus(cheque.payment_date, cheque.cheque_status);
      if (effectiveStatus === 'pending') {
        groups[customerId].pendingAmount += cheque.amount;
      }
      if (isChequeOverdue(cheque.payment_date, cheque.cheque_status)) {
        groups[customerId].overdueCount++;
      }
    });
    
    // Sort by customer name
    return Object.values(groups).sort((a, b) => a.customerName.localeCompare(b.customerName, 'ar'));
  }, [cheques]);

  // Fetch summary stats separately (not affected by filters). The page
  // counts cheques across all surfaces — customer cheques (in-bound) +
  // outgoing settlement cheques to companies/brokers + outgoing expense
  // cheques. Each source is normalized to a {amount, cheque_status,
  // payment_date} triple so the same aggregation runs once at the end.
  const fetchSummaryStats = useCallback(async () => {
    try {
      const [ppRes, csRes, bsRes, exRes] = await Promise.all([
        supabase
          .from('policy_payments')
          .select('amount, cheque_status, payment_date, batch_id')
          .eq('payment_type', 'cheque'),
        supabase
          .from('company_settlements')
          .select('total_amount, status, refused, settlement_date')
          .eq('payment_type', 'cheque'),
        supabase
          .from('broker_settlements')
          .select('total_amount, status, refused, settlement_date')
          .eq('payment_type', 'cheque'),
        supabase
          .from('expenses')
          .select('amount, cheque_status, expense_date')
          .eq('payment_method', 'cheque'),
      ]);

      type Norm = { amount: number; cheque_status: string | null; payment_date: string };
      const normalized: Norm[] = [];

      // Multi-split cheques (batch_id != null) collapse into one logical
      // cheque so the summary counts at the top of the page match what
      // the user sees in the list. Amounts get summed across siblings;
      // status/date are identical within a batch so any member is fine.
      type PpRow = { amount: number | null; cheque_status: string | null; payment_date: string; batch_id: string | null };
      const ppRows = (ppRes.data ?? []) as PpRow[];
      const batchSums = new Map<string, number>();
      const seenBatches = new Set<string>();
      for (const c of ppRows) {
        if (c.batch_id) {
          batchSums.set(c.batch_id, (batchSums.get(c.batch_id) ?? 0) + Number(c.amount ?? 0));
        }
      }
      for (const c of ppRows) {
        if (c.batch_id) {
          if (seenBatches.has(c.batch_id)) continue;
          seenBatches.add(c.batch_id);
          normalized.push({
            amount: batchSums.get(c.batch_id) ?? 0,
            cheque_status: c.cheque_status,
            payment_date: c.payment_date,
          });
        } else {
          normalized.push({
            amount: Number(c.amount ?? 0),
            cheque_status: c.cheque_status,
            payment_date: c.payment_date,
          });
        }
      }

      const settlementToStatus = (status: string | null, refused: boolean | null): string => {
        if (refused) return 'returned';
        if (status === 'completed') return 'cashed';
        return 'pending';
      };

      ((csRes.data ?? []) as Array<{ total_amount: number | null; status: string | null; refused: boolean | null; settlement_date: string }>).forEach((c) => {
        normalized.push({
          amount: Number(c.total_amount ?? 0),
          cheque_status: settlementToStatus(c.status, c.refused),
          payment_date: c.settlement_date,
        });
      });

      ((bsRes.data ?? []) as Array<{ total_amount: number | null; status: string | null; refused: boolean | null; settlement_date: string }>).forEach((c) => {
        normalized.push({
          amount: Number(c.total_amount ?? 0),
          cheque_status: settlementToStatus(c.status, c.refused),
          payment_date: c.settlement_date,
        });
      });

      ((exRes.data ?? []) as Array<{ amount: number | null; cheque_status: string | null; expense_date: string }>).forEach((c) => {
        normalized.push({
          amount: Number(c.amount ?? 0),
          cheque_status: c.cheque_status,
          payment_date: c.expense_date,
        });
      });

      const todayIso = new Date().toISOString().split('T')[0];
      const returnedCheques = normalized.filter((c) => c.cheque_status === 'returned');
      const pendingCheques = normalized.filter((c) => c.cheque_status === 'pending' || !c.cheque_status);
      const overdueCheques = normalized.filter((c) => isChequeOverdue(c.payment_date, c.cheque_status));
      const dueTodayCheques = normalized.filter(
        (c) =>
          c.payment_date === todayIso &&
          c.cheque_status !== 'cashed' &&
          c.cheque_status !== 'returned',
      );

      setSummaryStats({
        returnedCount: returnedCheques.length,
        returnedTotal: returnedCheques.reduce((s, c) => s + c.amount, 0),
        pendingCount: pendingCheques.length,
        pendingTotal: pendingCheques.reduce((s, c) => s + c.amount, 0),
        overdueCount: overdueCheques.length,
        overdueTotal: overdueCheques.reduce((s, c) => s + c.amount, 0),
        dueTodayCount: dueTodayCheques.length,
        dueTodayTotal: dueTodayCheques.reduce((s, c) => s + c.amount, 0),
      });

      // Monthly stats — same normalized rows feed the per-month buckets.
      const monthlyMap: Record<string, MonthlyStats> = {};
      normalized.forEach((c) => {
        const date = new Date(c.payment_date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!monthlyMap[monthKey]) {
          monthlyMap[monthKey] = {
            month: monthKey,
            total: 0, totalAmount: 0,
            pending: 0, pendingAmount: 0,
            cashed: 0, cashedAmount: 0,
            returned: 0, returnedAmount: 0,
          };
        }

        monthlyMap[monthKey].total++;
        monthlyMap[monthKey].totalAmount += c.amount;

        const status = c.cheque_status || 'pending';
        if (status === 'pending') {
          monthlyMap[monthKey].pending++;
          monthlyMap[monthKey].pendingAmount += c.amount;
        } else if (status === 'cashed') {
          monthlyMap[monthKey].cashed++;
          monthlyMap[monthKey].cashedAmount += c.amount;
        } else if (status === 'returned') {
          monthlyMap[monthKey].returned++;
          monthlyMap[monthKey].returnedAmount += c.amount;
        }
      });

      const sortedMonths = Object.values(monthlyMap).sort((a, b) =>
        b.month.localeCompare(a.month),
      );
      setMonthlyStats(sortedMonths);
    } catch (error) {
      console.error('Error fetching summary stats:', error);
    }
  }, []);

  const fetchCheques = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('policy_payments')
        .select(`
          id, policy_id, amount, payment_date, cheque_due_date, cheque_issue_date,
          cheque_number, cheque_date, batch_id,
          bank_code, branch_code, cheque_image_url,
          cheque_status, refused, notes, transferred_to_type, transferred_to_id, transferred_payment_id,
          policies!policy_payments_policy_id_fkey(
            id, policy_type_parent,
            clients!policies_client_id_fkey(id, full_name, broker_id, phone_number),
            cars!policies_car_id_fkey(car_number)
          )
        `, { count: 'exact' })
        .eq('payment_type', 'cheque')
        .order('payment_date', { ascending: false })
        .range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

      if (statusFilter !== "all") {
        query = query.eq('cheque_status', statusFilter);
      }

      if (filterBranch) {
        // policy_payments.branch_id is auto-set from the parent policy
        // by the existing trigger; filtering here narrows the cheque
        // list to that branch's payments.
        query = query.eq('branch_id', filterBranch);
      }

      if (overdueOnly) {
        const today = new Date().toISOString().split('T')[0];
        query = query.lt('payment_date', today).neq('cheque_status', 'cashed');
      }

      if (dueTodayOnly) {
        // Cheques whose استحقاق falls exactly on today and haven't
        // been cashed yet — the "who do I need to collect from
        // today" view staff asked for.
        const today = new Date().toISOString().split('T')[0];
        query = query.eq('payment_date', today).neq('cheque_status', 'cashed');
      }

      const { data, error, count } = await query;
      if (error) throw error;

      const paymentIds = (data || []).map((c: any) => c.id);
      
      let imagesMap: Record<string, PaymentImage[]> = {};
      if (paymentIds.length > 0) {
        const { data: images } = await supabase
          .from('payment_images')
          .select('id, payment_id, image_url, image_type')
          .in('payment_id', paymentIds);
        
        imagesMap = (images || []).reduce((acc, img) => {
          if (!acc[img.payment_id]) acc[img.payment_id] = [];
          acc[img.payment_id].push({ id: img.id, image_url: img.image_url, image_type: img.image_type });
          return acc;
        }, {} as Record<string, PaymentImage[]>);
      }

      const brokerIds = [...new Set(
        (data || []).map((c: any) => c.policies?.clients?.broker_id).filter(Boolean)
      )];

      let brokerMap: Record<string, string> = {};
      if (brokerIds.length > 0) {
        const { data: brokers } = await supabase.from('brokers').select('id, name').in('id', brokerIds);
        brokerMap = (brokers || []).reduce((acc, b) => { acc[b.id] = b.name; return acc; }, {} as Record<string, string>);
      }

      // Fetch broker and company names for transferred cheques
      const transferredToBrokerIds = [...new Set(
        (data || []).filter((c: any) => c.transferred_to_type === 'broker').map((c: any) => c.transferred_to_id).filter(Boolean)
      )];
      const transferredToCompanyIds = [...new Set(
        (data || []).filter((c: any) => c.transferred_to_type === 'company').map((c: any) => c.transferred_to_id).filter(Boolean)
      )];

      let transferBrokerMap: Record<string, string> = {};
      let transferCompanyMap: Record<string, string> = {};
      
      if (transferredToBrokerIds.length > 0) {
        const { data: brokers } = await supabase.from('brokers').select('id, name').in('id', transferredToBrokerIds);
        transferBrokerMap = (brokers || []).reduce((acc, b) => { acc[b.id] = b.name; return acc; }, {} as Record<string, string>);
      }
      if (transferredToCompanyIds.length > 0) {
        const { data: companies } = await supabase.from('insurance_companies').select('id, name, name_ar').in('id', transferredToCompanyIds);
        transferCompanyMap = (companies || []).reduce((acc, c) => { acc[c.id] = c.name_ar || c.name; return acc; }, {} as Record<string, string>);
      }

      const formattedCheques: ChequeRecord[] = (data || []).map((c: any) => {
        let transferredToName = null;
        if (c.transferred_to_type === 'broker' && c.transferred_to_id) {
          transferredToName = transferBrokerMap[c.transferred_to_id];
        } else if (c.transferred_to_type === 'company' && c.transferred_to_id) {
          transferredToName = transferCompanyMap[c.transferred_to_id];
        }

        return {
          id: c.id,
          policy_id: c.policy_id,
          amount: c.amount,
          payment_date: c.payment_date,
          cheque_number: c.cheque_number,
          cheque_date: c.cheque_date || null,
          bank_code: c.bank_code || null,
          branch_code: c.branch_code || null,
          cheque_image_url: c.cheque_image_url,
          cheque_status: c.cheque_status || 'pending',
          refused: c.refused,
          notes: c.notes,
          batch_id: c.batch_id || null,
          policy: c.policies ? {
            id: c.policies.id,
            policy_type_parent: c.policies.policy_type_parent,
            client: c.policies.clients,
            car: c.policies.cars,
          } : null,
          broker_name: c.policies?.clients?.broker_id ? brokerMap[c.policies.clients.broker_id] : undefined,
          images: imagesMap[c.id] || [],
          transferred_to_type: c.transferred_to_type,
          transferred_to_id: c.transferred_to_id,
          transferred_to_name: transferredToName,
          transferred_payment_id: c.transferred_payment_id,
          source: 'customer',
        };
      });

      // Outgoing settlement cheques — written from us TO a company or
      // broker. They live in *_settlements with payment_type='cheque'
      // (customer_cheque rows aren't fetched here because they're just
      // re-uses of policy_payments and would double-count). Each row is
      // wrapped in a synthetic ChequeRecord so the existing group-by-
      // client UI groups them by recipient name automatically.
      const outgoing = await fetchOutgoingCheques();
      formattedCheques.push(...outgoing);
      // Most-recent first across both sources.
      formattedCheques.sort((a, b) => {
        const ad = new Date(a.payment_date).getTime();
        const bd = new Date(b.payment_date).getTime();
        return bd - ad;
      });

      // Collapse multi-split customer cheques into one logical row per
      // physical cheque. The debt-settlement modal splits a single
      // cheque across N policies (smallest-remaining first) so all
      // splits share batch_id; the user thinks of and signs ONE cheque,
      // so the page should show one row at the cheque's face value.
      // Outgoing cheques and single-policy payments (no batch_id) are
      // passed through unchanged.
      const collapsed = collapseCustomerChequesByBatch(formattedCheques);

      // Search filter (includes customer name search)
      const filtered = searchQuery
        ? collapsed.filter(c =>
            c.policy?.client?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.cheque_number?.includes(searchQuery) ||
            c.policy?.client?.phone_number?.includes(searchQuery)
          )
        : collapsed;

      // Auto-expand all groups when there's a small number of them so
      // the user lands in a useful state without having to click around.
      const groupIds = [
        ...new Set(formattedCheques.map((c) => c.policy?.client?.id).filter(Boolean) as string[]),
      ];

      setCheques(filtered);
      setTotalCount(count || 0);

      if (groupIds.length <= 10) {
        setExpandedCustomers(new Set(groupIds));
      }
    } catch (error) {
      console.error('Error fetching cheques:', error);
      toast({ title: "خطأ", description: "فشل في تحميل الشيكات", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentPage, statusFilter, overdueOnly, dueTodayOnly, searchQuery, filterBranch, toast]);

  useEffect(() => { fetchSummaryStats(); }, [fetchSummaryStats]);
  useEffect(() => { fetchCheques(); }, [fetchCheques]);

  const handleStatusChange = async (chequeId: string, newStatus: string, reason?: string) => {
    try {
      // chequeId is the displayed (logical) row id. For multi-split
      // cheques every underlying policy_payments row must flip together
      // — a physical cheque can't be half-cashed.
      const target = cheques.find(c => c.id === chequeId);
      const idsToUpdate = target?.member_ids?.length ? target.member_ids : [chequeId];

      // refused=true is what excludes the row from
      // validate_policy_payment_total's sum, which is how إلغاء/رجع
      // subtract the cheque from the customer's "paid" total. صرف
      // keeps refused=false because a cashed cheque counts as paid.
      const isVoided = newStatus === 'returned' || newStatus === 'cancelled';
      const updateData: { cheque_status: string; refused: boolean; cancellation_reason?: string | null } = {
        cheque_status: newStatus,
        refused: isVoided,
      };

      // Reason goes onto the dedicated column added by
      // 20260511160000_receipt_cancellation_voucher. The
      // sync_receipt_from_policy_payment trigger reads it to populate
      // both the cancellation voucher's notes line and the cancelled
      // original's cancellation_reason field — so the bookkeeper sees
      // the exact same text on the receipts page and on the printed
      // voucher.
      if (isVoided && reason && reason.trim()) {
        updateData.cancellation_reason = reason.trim();
      }

      const { error } = await supabase
        .from('policy_payments')
        .update(updateData)
        .in('id', idsToUpdate);

      if (error) throw error;
      toast({ title: "تم التحديث", description: "تم تحديث حالة الشيك" });

      fetchCheques();
      fetchSummaryStats();
    } catch (error) {
      toast({ title: "خطأ", description: "فشل في تحديث الحالة", variant: "destructive" });
    }
  };

  const openReasonDialog = (chequeId: string, action: 'cancelled' | 'returned') => {
    setReasonChequeId(chequeId);
    setReasonAction(action);
    setReasonText("");
    setReasonError(null);
    setReasonDialogOpen(true);
  };

  const confirmReasonAction = async () => {
    if (!reasonAction || !reasonChequeId) return;
    if (!reasonText.trim()) {
      setReasonError('السبب مطلوب');
      return;
    }
    setReasonSubmitting(true);
    try {
      await handleStatusChange(reasonChequeId, reasonAction, reasonText.trim());
      setReasonDialogOpen(false);
      setReasonAction(null);
      setReasonChequeId(null);
      setReasonText("");
      setReasonError(null);
    } finally {
      setReasonSubmitting(false);
    }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedCheques.size === 0) return;

    setBulkActionLoading(true);
    try {
      // Expand each selected logical row to its underlying members so
      // multi-split cheques flip in full.
      const idsToUpdate = new Set<string>();
      for (const id of selectedCheques) {
        const target = cheques.find(c => c.id === id);
        if (target?.member_ids?.length) {
          target.member_ids.forEach(mid => idsToUpdate.add(mid));
        } else {
          idsToUpdate.add(id);
        }
      }

      const isVoided = newStatus === 'returned' || newStatus === 'cancelled';
      const { error } = await supabase
        .from('policy_payments')
        .update({ cheque_status: newStatus, refused: isVoided })
        .in('id', Array.from(idsToUpdate));

      if (error) throw error;
      toast({ title: "تم التحديث", description: `تم تحديث ${selectedCheques.size} شيك` });
      setSelectedCheques(new Set());
      fetchCheques();
      fetchSummaryStats();
    } catch (error) {
      toast({ title: "خطأ", description: "فشل في تحديث الحالة", variant: "destructive" });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleEditCheque = (cheque: ChequeRecord) => {
    setEditingCheque(cheque);
    setEditChequeNumber(cheque.cheque_number || "");
    setEditChequeNumberError(null);
    setEditDialogOpen(true);
  };

  const handleEditChequeNumberChange = (value: string) => {
    const sanitized = sanitizeChequeNumber(value);
    setEditChequeNumber(sanitized);
    if (!sanitized) {
      setEditChequeNumberError("رقم الشيك مطلوب");
    } else {
      setEditChequeNumberError(null);
    }
  };

  const saveEditedCheque = async () => {
    if (!editingCheque) return;
    
    const sanitized = sanitizeChequeNumber(editChequeNumber);
    if (!sanitized) {
      setEditChequeNumberError("رقم الشيك مطلوب");
      return;
    }
    
    try {
      // Cheque number / status reset must apply to every split of the
      // physical cheque — not just one row of the batch.
      const idsToUpdate = editingCheque.member_ids?.length
        ? editingCheque.member_ids
        : [editingCheque.id];
      const { error } = await supabase
        .from('policy_payments')
        .update({
          cheque_number: sanitized,
          cheque_status: 'pending',
          refused: false,
        })
        .in('id', idsToUpdate);

      if (error) throw error;
      toast({ title: "تم التحديث", description: "تم تحديث رقم الشيك وإعادة الحالة إلى قيد الانتظار" });
      setEditDialogOpen(false);
      setEditingCheque(null);
      fetchCheques();
      fetchSummaryStats();
    } catch (error) {
      toast({ title: "خطأ", description: "فشل في تحديث الشيك", variant: "destructive" });
    }
  };

  const openSmsDialog = (cheque: ChequeRecord) => {
    setSmsCheque(cheque);
    const clientName = cheque.policy?.client?.full_name || "العميل";
    const chequeNum = cheque.cheque_number || "";
    setSmsMessage(`مرحباً ${clientName}، نود إعلامك بأن الشيك رقم ${chequeNum} بمبلغ ${formatCurrency(cheque.amount)} قد تم إرجاعه. يرجى التواصل معنا لتسوية الأمر.`);
    setSmsDialogOpen(true);
  };

  const sendReturnedChequeSms = async () => {
    if (!smsCheque || !smsCheque.policy?.client?.phone_number) {
      toast({ title: "خطأ", description: "لا يوجد رقم هاتف للعميل", variant: "destructive" });
      return;
    }
    if (!guardSmsSend('click')) return;

    setSendingSms(true);
    try {
      const { error } = await supabase.functions.invoke('send-sms', {
        body: {
          phone: smsCheque.policy.client.phone_number,
          message: smsMessage,
          clientId: smsCheque.policy.client.id,
          policyId: smsCheque.policy_id,
          smsType: 'manual',
        }
      });

      if (error) throw error;
      toast({ title: "تم الإرسال", description: "تم إرسال الرسالة بنجاح" });
      setSmsDialogOpen(false);
      setSmsCheque(null);
    } catch (error) {
      const description = await extractFunctionErrorMessage(error);
      toast({ title: "خطأ", description: description || "فشل في إرسال الرسالة", variant: "destructive" });
    } finally {
      setSendingSms(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `₪${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB');
  };

  // PDFs live in the same payment_images table as images (no mime_type
  // column), so we infer by extension. Query-string tolerant.
  const isPdfUrl = (url: string) => /\.pdf(\?|#|$)/i.test(url);

  const formatMonthName = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' });
  };

  // Use Bunny CDN for image upload instead of Supabase Storage
  const handleImageUpload = async (chequeId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setUploading(false);
        setUploadingForChequeId(null);
        toast({ 
          title: "تسجيل الدخول مطلوب", 
          description: "يجب تسجيل الدخول أولاً لرفع الصور. يرجى تسجيل الدخول والمحاولة مرة أخرى.", 
          variant: "destructive" 
        });
        return;
      }

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('entity_type', 'payment');
        formData.append('entity_id', chequeId);

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: formData,
          }
        );

        if (!response.ok) {
          throw new Error('Upload failed');
        }

        const data = await response.json();
        
        // Get the CDN URL from the response - upload-media returns { success, file: { cdn_url, ... } }
        const cdnUrl = data.file?.cdn_url || data.url;
        if (!cdnUrl) {
          throw new Error('No URL returned from upload');
        }
        
        // Insert into payment_images table
        const { error: insertError } = await supabase
          .from('payment_images')
          .insert({ 
            payment_id: chequeId, 
            image_url: cdnUrl, 
            image_type: 'cheque',
            sort_order: 0,
          });

        if (insertError) throw insertError;
      }

      toast({ title: "تم الرفع", description: "تم رفع الصور بنجاح" });
      fetchCheques();
    } catch (error) {
      console.error('Error uploading image:', error);
      toast({ title: "خطأ", description: "فشل في رفع الصور", variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadingForChequeId(null);
    }
  };

  const toggleSelectAll = () => {
    if (selectedCheques.size === cheques.length) {
      setSelectedCheques(new Set());
    } else {
      setSelectedCheques(new Set(cheques.map(c => c.id)));
    }
  };

  const toggleSelectCheque = (chequeId: string) => {
    const newSelected = new Set(selectedCheques);
    if (newSelected.has(chequeId)) {
      newSelected.delete(chequeId);
    } else {
      newSelected.add(chequeId);
    }
    setSelectedCheques(newSelected);
  };

  const toggleCustomerExpanded = (customerId: string) => {
    const newExpanded = new Set(expandedCustomers);
    if (newExpanded.has(customerId)) {
      newExpanded.delete(customerId);
    } else {
      newExpanded.add(customerId);
    }
    setExpandedCustomers(newExpanded);
  };

  const expandAll = () => {
    setExpandedCustomers(new Set(customerGroups.map(g => g.customerId)));
  };

  const collapseAll = () => {
    setExpandedCustomers(new Set());
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  const renderChequeRow = (cheque: ChequeRecord, index: number, isNested: boolean = false) => {
    const effectiveStatus = getEffectiveChequeStatus(cheque.payment_date, cheque.cheque_status);
    const isOverdueCheck = isChequeOverdue(cheque.payment_date, cheque.cheque_status);
    const allImages = [
      cheque.cheque_image_url,
      ...(cheque.images?.map(i => i.image_url) || [])
    ].filter(Boolean) as string[];
    
    return (
      <TableRow
        key={cheque.id}
        className={cn(
          "border-border/30 transition-colors",
          isOverdueCheck && "bg-destructive/5",
          selectedCheques.has(cheque.id) && "bg-primary/5",
          isNested && "bg-muted/20"
        )}
      >
        <TableCell
          className={cn(
            "[&:has([role=checkbox])]:!pr-4 [&:has([role=checkbox])]:!pl-2",
            isNested && "[&:has([role=checkbox])]:!pr-10",
          )}
        >
          <Checkbox
            checked={selectedCheques.has(cheque.id)}
            onCheckedChange={() => toggleSelectCheque(cheque.id)}
          />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            {allImages.length > 0 ? (
              <button
                onClick={() => {
                  setGalleryImages(allImages.filter(url => url && url.trim()));
                  setGalleryIndex(0);
                  setGalleryOpen(true);
                }}
                className="relative group"
              >
                {isPdfUrl(allImages[0]) ? (
                  <div className="h-10 w-14 rounded border bg-red-500/10 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-red-600" />
                  </div>
                ) : (
                  <img
                    src={allImages[0]}
                    alt="صورة الشيك"
                    className="h-10 w-14 object-cover rounded border"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="h-10 w-14 bg-muted rounded flex items-center justify-center text-[10px] text-muted-foreground">خطأ</div>';
                    }}
                  />
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center gap-1">
                  <Eye className="h-3 w-3 text-white" />
                  {allImages.length > 1 && <span className="text-white text-[10px] font-bold">+{allImages.length - 1}</span>}
                </div>
              </button>
            ) : (
              <div className="h-10 w-14 bg-muted rounded flex items-center justify-center text-[10px] text-muted-foreground">لا صورة</div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={uploading && uploadingForChequeId === cheque.id}
              onClick={() => { setUploadingForChequeId(cheque.id); fileInputRef.current?.click(); }}
              title="رفع صورة"
            >
              {uploading && uploadingForChequeId === cheque.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
            </Button>
          </div>
        </TableCell>
        <TableCell className="font-mono text-sm">
          <div className="flex items-center gap-1.5 flex-wrap">
            <bdi>{cheque.cheque_number || "-"}</bdi>
            {/* "خارجي" badge marks cheques we wrote out (settlement
                vouchers). Customer cheques don't get a badge — they're
                the default for this page. */}
            {cheque.source && cheque.source !== 'customer' && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 gap-1 border-amber-300 text-amber-700 bg-amber-50">
                <Building2 className="h-2.5 w-2.5" />
                خارجي
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm">
          {cheque.bank_code ? (
            <div className="flex flex-col gap-0.5 min-w-[200px]">
              <span className="font-medium">
                {getBankName(cheque.bank_code) || cheque.bank_code}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono ltr-nums">
                {cheque.bank_code}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="font-mono text-sm ltr-nums">
          {cheque.branch_code || <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell className="font-medium">
          <bdi>{formatCurrency(cheque.amount)}</bdi>
        </TableCell>
        <TableCell className={cn(isOverdueCheck && "text-destructive font-medium")}>
          {/* Source of truth for the "تاريخ الاستحقاق" column is
              cheque_due_date. New rows always populate it; old rows
              had it backfilled to payment_date in the
              20260509200000_cheque_due_and_issue_dates migration. */}
          <div className="flex items-center gap-1">
            {formatDate(cheque.cheque_due_date || cheque.payment_date)}
            {isOverdueCheck && (
              <Badge variant="destructive" className="text-[10px] px-1 py-0">متأخر</Badge>
            )}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 flex-wrap">
              <Badge variant={statusLabels[effectiveStatus]?.variant || 'secondary'}>
                {statusLabels[effectiveStatus]?.label || effectiveStatus}
              </Badge>
            </div>
            {/* "تم استخدامه" — link points to the accounting page now,
                not the entity wallet, since the settlement record lives
                there. The page reads ?settlement=ID and switches to the
                right tab + sub-tab + scrolls to the row. */}
            {cheque.cheque_status === 'transferred_out' && cheque.transferred_to_name && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>
                  →{' '}
                  {cheque.transferred_to_type === 'broker'
                    ? 'وسيط'
                    : cheque.transferred_to_type === 'expense'
                    ? 'مصروف'
                    : 'شركة'}
                  : {cheque.transferred_to_name}
                </span>
                {cheque.transferred_to_type && cheque.transferred_payment_id && (
                  <button
                    className="underline hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      const tab =
                        cheque.transferred_to_type === 'broker'
                          ? 'brokers'
                          : cheque.transferred_to_type === 'expense'
                          ? 'expenses'
                          : 'companies';
                      navigate(
                        `/accounting?tab=${tab}&settlement=${cheque.transferred_payment_id}`,
                      );
                    }}
                  >
                    عرض في المحاسبة
                  </button>
                )}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="text-center">
          {/* Actions collapsed into a 3-dots menu so the row stays
              tight even with all the cheque-specific verbs. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">إجراءات</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {/* Outgoing cheques (شيكات صادرة) — same edit surface as
                  the accounting page, opens against the underlying
                  settlement / expense row so changes stay in sync
                  across both pages. The customer-cheque immutability
                  rules (no edit, only صرف/إلغاء/رجع) don't apply here
                  because outgoing rows live in *_settlements / expenses,
                  not policy_payments. */}
              {(cheque.source === 'company' ||
                cheque.source === 'broker' ||
                cheque.source === 'expense') && (
                <DropdownMenuItem onClick={() => openOutgoingEditFor(cheque)}>
                  <Pencil className="h-4 w-4 ml-2" />
                  تعديل الشيك
                </DropdownMenuItem>
              )}
              {/* Customer cheques: only the three voiding actions are
                  exposed — صرف, إلغاء, رجع. Per the immutable-accounting
                  rule the user wants going forward, we don't surface
                  inline edits anymore; correction goes through the
                  delete + re-enter flow once the voucher system lands.
                  transferred_out is a terminal state (the cheque is
                  already used as outgoing) so no actions show. */}
              {(cheque.source === 'customer' || !cheque.source) &&
                cheque.cheque_status !== 'transferred_out' && (
                  <>
                    {cheque.cheque_status !== 'cashed' && (
                      <DropdownMenuItem
                        onClick={() => handleStatusChange(cheque.id, 'cashed')}
                        className="text-green-600 focus:text-green-700"
                      >
                        <CheckCircle2 className="h-4 w-4 ml-2" />
                        صرف الشيك
                      </DropdownMenuItem>
                    )}
                    {cheque.cheque_status !== 'cancelled' && (
                      <DropdownMenuItem
                        onClick={() => openReasonDialog(cheque.id, 'cancelled')}
                        className="text-amber-600 focus:text-amber-700"
                      >
                        <XCircle className="h-4 w-4 ml-2" />
                        إلغاء الشيك
                      </DropdownMenuItem>
                    )}
                    {cheque.cheque_status !== 'returned' && (
                      <DropdownMenuItem
                        onClick={() => openReasonDialog(cheque.id, 'returned')}
                        className="text-destructive focus:text-destructive"
                      >
                        <RotateCcw className="h-4 w-4 ml-2" />
                        رجع الشيك
                      </DropdownMenuItem>
                    )}
                  </>
                )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <MainLayout>
      <Header title="الشيكات" subtitle="إدارة ومتابعة الشيكات" />

      <div className="md:p-6 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {/* Due today — clickable to toggle the filter. Staff asked
              to land on this page and immediately see which cheques
              come due today. */}
          <button
            type="button"
            onClick={() => {
              setDueTodayOnly((v) => !v);
              if (!dueTodayOnly) setOverdueOnly(false);
              setCurrentPage(1);
            }}
            className={cn(
              "p-4 rounded-xl border text-right transition-all",
              dueTodayOnly
                ? "border-primary bg-primary/10 shadow-sm"
                : "border-primary/30 bg-primary/5 hover:border-primary/60",
            )}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/15">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">استحقاق اليوم</p>
                <p className="text-xl font-bold text-primary ltr-nums">
                  {formatCurrency(summaryStats.dueTodayTotal || 0)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {summaryStats.dueTodayCount || 0} شيك
                </p>
              </div>
            </div>
          </button>
          <Card className="p-4 border-destructive/30 bg-destructive/5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">شيكات مرتجعة</p>
                <p className="text-xl font-bold text-destructive ltr-nums">
                  {formatCurrency(summaryStats.returnedTotal)}
                </p>
                <p className="text-xs text-muted-foreground">{summaryStats.returnedCount} شيك</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <AlertCircle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">شيكات متأخرة</p>
                <p className="text-xl font-bold text-amber-600 ltr-nums">
                  {formatCurrency(summaryStats.overdueTotal)}
                </p>
                <p className="text-xs text-muted-foreground">{summaryStats.overdueCount} شيك</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 border-blue-500/30 bg-blue-500/5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <CheckSquare className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">قيد الانتظار</p>
                <p className="text-xl font-bold text-blue-600 ltr-nums">
                  {formatCurrency(summaryStats.pendingTotal)}
                </p>
                <p className="text-xs text-muted-foreground">{summaryStats.pendingCount} شيك</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="list" className="gap-2">
              <CheckSquare className="h-4 w-4" />
              قائمة الشيكات
            </TabsTrigger>
            <TabsTrigger value="report" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              التقرير الشهري
            </TabsTrigger>
          </TabsList>

          <TabsContent value="report" className="mt-4">
            <Card className="overflow-hidden border shadow-sm">
              <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  <h3 className="text-base font-semibold">إحصائيات الشيكات الشهرية</h3>
                </div>
                <span className="text-xs text-muted-foreground">
                  {monthlyStats.length} {monthlyStats.length === 1 ? "شهر" : "أشهر"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/20 hover:bg-muted/20 border-border/60">
                      <TableHead className="font-semibold">الشهر</TableHead>
                      <TableHead className="text-center font-semibold">إجمالي الشيكات</TableHead>
                      <TableHead className="text-center font-semibold">قيد الانتظار</TableHead>
                      <TableHead className="text-center font-semibold">تم صرفها</TableHead>
                      <TableHead className="text-center font-semibold">مرتجعة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthlyStats.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                          لا توجد بيانات
                        </TableCell>
                      </TableRow>
                    ) : (
                      monthlyStats.map((month) => (
                        <TableRow key={month.month} className="border-border/40">
                          <TableCell className="font-semibold">
                            <div className="flex items-center gap-2">
                              <div className="h-8 w-1 rounded-full bg-primary/60" />
                              {formatMonthName(month.month)}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="font-medium ltr-nums">{month.total} شيك</div>
                            <div className="text-[11px] text-muted-foreground ltr-nums">{formatCurrency(month.totalAmount)}</div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className="ltr-nums border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            >
                              {month.pending}
                            </Badge>
                            <div className="text-[11px] text-muted-foreground mt-1 ltr-nums">{formatCurrency(month.pendingAmount)}</div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className="ltr-nums border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            >
                              {month.cashed}
                            </Badge>
                            <div className="text-[11px] text-muted-foreground mt-1 ltr-nums">{formatCurrency(month.cashedAmount)}</div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className="ltr-nums border-destructive/40 bg-destructive/10 text-destructive"
                            >
                              {month.returned}
                            </Badge>
                            <div className="text-[11px] text-muted-foreground mt-1 ltr-nums">{formatCurrency(month.returnedAmount)}</div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="list" className="mt-4 space-y-4">
            {/* Toolbar. Mobile: every control gets its own full-width
                row, with the date-toggle pills (اليوم فقط / متأخرة)
                and the expand/collapse pair sharing rows as 2-col
                grids. The primary "إضافة شيكات لعميل" CTA also goes
                full-width on mobile. Desktop preserves the original
                inline cluster via `sm:flex sm:items-center sm:gap-2
                sm:flex-wrap`. */}
            <div className="space-y-3 sm:space-y-0 sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="relative w-full sm:flex-1 sm:max-w-md">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="بحث بالعميل، رقم الشيك، أو رقم الهاتف..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="pr-9"
                />
              </div>
              <div className="space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2 sm:flex-wrap">
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                  <SelectTrigger className="w-full sm:w-[130px]">
                    <SelectValue placeholder="الحالة" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الحالات</SelectItem>
                    <SelectItem value="pending">قيد الانتظار</SelectItem>
                    <SelectItem value="cashed">تم صرفه</SelectItem>
                    <SelectItem value="returned">مرتجع</SelectItem>
                    <SelectItem value="transferred_out">تم استخدامه</SelectItem>
                  </SelectContent>
                </Select>
                <AgentBranchFilter
                  value={filterBranch}
                  onChange={(v) => { setFilterBranch(v); setCurrentPage(1); }}
                />

                {/* Date-toggle pills: 2-col grid on mobile so they
                    sit as equal-width tiles, inline on sm+. */}
                <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
                  <Button
                    variant={dueTodayOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setDueTodayOnly((v) => !v);
                      if (!dueTodayOnly) setOverdueOnly(false);
                      setCurrentPage(1);
                    }}
                    className={dueTodayOnly ? "bg-primary text-primary-foreground" : ""}
                  >
                    <Calendar className="ml-1 h-4 w-4" />
                    اليوم فقط
                  </Button>
                  <Button
                    variant={overdueOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setOverdueOnly((v) => !v);
                      if (!overdueOnly) setDueTodayOnly(false);
                      setCurrentPage(1);
                    }}
                  >
                    <AlertCircle className="ml-1 h-4 w-4" />
                    متأخرة
                  </Button>
                </div>

                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setAddChequeModalOpen(true)}
                  className="gap-1 w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4" />
                  إضافة شيكات لعميل
                </Button>
                <div className="grid grid-cols-2 gap-1 sm:flex sm:gap-1">
                  <Button variant="outline" size="sm" onClick={expandAll}>توسيع الكل</Button>
                  <Button variant="outline" size="sm" onClick={collapseAll}>طي الكل</Button>
                </div>
              </div>
            </div>

            {/* Bulk Actions */}
            {selectedCheques.size > 0 && (
              <Card className="p-3 bg-primary/5 border-primary/20">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-sm font-medium">تم تحديد {selectedCheques.size} شيك</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-500/50 text-green-600 hover:bg-green-500/10"
                    onClick={() => handleBulkStatusChange('cashed')}
                    disabled={bulkActionLoading}
                  >
                    <CheckCircle2 className="h-4 w-4 ml-1" />
                    صرف الكل
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                    onClick={() => handleBulkStatusChange('returned')}
                    disabled={bulkActionLoading}
                  >
                    <RotateCcw className="h-4 w-4 ml-1" />
                    إرجاع الكل
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedCheques(new Set())}
                  >
                    إلغاء التحديد
                  </Button>
                </div>
              </Card>
            )}

            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              multiple
              onChange={(e) => {
                if (uploadingForChequeId) {
                  handleImageUpload(uploadingForChequeId, e.target.files);
                }
              }}
            />

            {/* Tree View Table */}
            <Card className="border shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="w-[56px] [&:has([role=checkbox])]:!pr-4 [&:has([role=checkbox])]:!pl-2">
                        <Checkbox
                          checked={selectedCheques.size === cheques.length && cheques.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead className="text-muted-foreground font-medium w-[120px]">الصورة</TableHead>
                      <TableHead className="text-muted-foreground font-medium">رقم الشيك</TableHead>
                      <TableHead className="text-muted-foreground font-medium min-w-[220px]">البنك</TableHead>
                      <TableHead className="text-muted-foreground font-medium">الفرع</TableHead>
                      <TableHead className="text-muted-foreground font-medium">المبلغ</TableHead>
                      <TableHead className="text-muted-foreground font-medium">تاريخ الاستحقاق</TableHead>
                      <TableHead className="text-muted-foreground font-medium">الحالة</TableHead>
                      <TableHead className="text-muted-foreground font-medium w-[80px] text-center">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                          <TableCell><Skeleton className="h-10 w-14" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-6 w-8" /></TableCell>
                        </TableRow>
                      ))
                    ) : customerGroups.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          لا توجد شيكات
                        </TableCell>
                      </TableRow>
                    ) : (
                      customerGroups.map((group) => {
                        const isExpanded = expandedCustomers.has(group.customerId);
                        return (
                          <Fragment key={group.customerId}>
                            {/* Customer Header Row — clickable directly.
                                The old version wrapped a Radix Collapsible
                                with a Fragment as asChild, which breaks
                                ref forwarding and left the accordion
                                effectively dead. Plain conditional
                                rendering based on expandedCustomers state
                                is reliable and table-row-friendly. */}
                            <TableRow
                              className="bg-muted/50 hover:bg-muted/70 cursor-pointer border-b-2"
                              onClick={() => toggleCustomerExpanded(group.customerId)}
                            >
                              <TableCell colSpan={9}>
                                <div className="flex items-center justify-between w-full py-1">
                                  <div className="flex items-center gap-3">
                                    <ChevronDown className={cn(
                                      "h-4 w-4 transition-transform",
                                      !isExpanded && "-rotate-90"
                                    )} />
                                    {/* Outgoing groups (company/broker/expense recipients)
                                        get a building icon + a typed badge so they're
                                        visually distinct from the customer groups. */}
                                    {group.customerId.startsWith('company-') ||
                                    group.customerId.startsWith('broker-') ||
                                    group.customerId.startsWith('expense-') ? (
                                      <Building2 className="h-4 w-4 text-amber-600" />
                                    ) : (
                                      <User className="h-4 w-4 text-primary" />
                                    )}
                                    <span className="font-semibold">{group.customerName}</span>
                                    {group.customerId.startsWith('company-') && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-300 text-amber-700">
                                        شركة · شيكات صادرة
                                      </Badge>
                                    )}
                                    {group.customerId.startsWith('broker-') && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-300 text-amber-700">
                                        وسيط · شيكات صادرة
                                      </Badge>
                                    )}
                                    {group.customerId.startsWith('expense-') && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-300 text-amber-700">
                                        مصروف · شيكات صادرة
                                      </Badge>
                                    )}
                                    {group.phone && (
                                      <span className="text-xs text-muted-foreground ltr-nums">({group.phone})</span>
                                    )}
                                    <Badge variant="outline" className="text-xs">
                                      {group.cheques.length} شيك
                                    </Badge>
                                    {group.overdueCount > 0 && (
                                      <Badge variant="destructive" className="text-xs">
                                        {group.overdueCount} متأخر
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-4 text-sm">
                                    <div>
                                      <span className="text-muted-foreground">الإجمالي: </span>
                                      <span className="font-bold ltr-nums">{formatCurrency(group.totalAmount)}</span>
                                    </div>
                                    {group.pendingAmount > 0 && (
                                      <div>
                                        <span className="text-muted-foreground">قيد الانتظار: </span>
                                        <span className="font-bold text-amber-600 ltr-nums">{formatCurrency(group.pendingAmount)}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                            {/* Cheque rows — only rendered when the
                                group is expanded. */}
                            {isExpanded &&
                              group.cheques.map((cheque, index) =>
                                renderChequeRow(cheque, index, true),
                              )}
                          </Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-border/30 px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  {customerGroups.length} عميل، {cheques.length} شيك
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">صفحة {currentPage} من {totalPages || 1}</span>
                  <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Image / PDF Gallery Dialog */}
      <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
        <DialogContent className="sm:max-w-4xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>مرفقات الشيك</DialogTitle>
          </DialogHeader>
          <div className="relative">
            {galleryImages[galleryIndex] ? (
              isPdfUrl(galleryImages[galleryIndex]) ? (
                <div className="w-full h-[80vh] rounded-lg overflow-hidden bg-muted">
                  <PdfJsViewer url={galleryImages[galleryIndex]} className="h-full" />
                </div>
              ) : (
                <img
                  src={galleryImages[galleryIndex]}
                  alt={`صورة ${galleryIndex + 1}`}
                  className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '';
                    (e.target as HTMLImageElement).alt = 'فشل في تحميل الصورة';
                    (e.target as HTMLImageElement).className = 'hidden';
                    const parent = (e.target as HTMLImageElement).parentElement;
                    if (parent) {
                      const fallback = document.createElement('div');
                      fallback.className = 'w-full h-64 bg-muted rounded-lg flex items-center justify-center text-muted-foreground';
                      fallback.textContent = 'فشل في تحميل الصورة';
                      parent.insertBefore(fallback, e.target as HTMLImageElement);
                    }
                  }}
                />
              )
            ) : (
              <div className="w-full h-64 bg-muted rounded-lg flex items-center justify-center text-muted-foreground">
                لا يوجد مرفق
              </div>
            )}
            {galleryImages.length > 1 && (
              <>
                <Button variant="outline" size="icon" className="absolute left-2 top-1/2 -translate-y-1/2" onClick={() => setGalleryIndex((i) => (i + 1) % galleryImages.length)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setGalleryIndex((i) => (i - 1 + galleryImages.length) % galleryImages.length)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                  {galleryIndex + 1} / {galleryImages.length}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Cheque Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل رقم الشيك</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              الشيك الحالي: {editingCheque?.cheque_number || "غير محدد"}
            </p>
            <div className="space-y-2">
              <Label>رقم الشيك الجديد</Label>
              <Input
                value={editChequeNumber}
                onChange={(e) => handleEditChequeNumberChange(e.target.value)}
                placeholder="أدخل رقم الشيك الجديد"
                maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                className={cn("ltr-input font-mono", editChequeNumberError && "border-destructive")}
              />
              {editChequeNumberError && (
                <p className="text-xs text-destructive">{editChequeNumberError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                الحد الأقصى: {CHEQUE_NUMBER_MAX_LENGTH} أرقام
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              ملاحظة: سيتم إعادة حالة الشيك إلى "قيد الانتظار" بعد تغيير الرقم
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>إلغاء</Button>
            <Button onClick={saveEditedCheque} disabled={!!editChequeNumberError || !editChequeNumber}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SMS Dialog */}
      <Dialog open={smsDialogOpen} onOpenChange={setSmsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إرسال رسالة للعميل</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>رقم الهاتف</Label>
              <Input value={smsCheque?.policy?.client?.phone_number || "لا يوجد رقم"} disabled className="ltr-input" />
            </div>
            <div className="space-y-2">
              <Label>نص الرسالة</Label>
              <textarea
                value={smsMessage}
                onChange={(e) => setSmsMessage(e.target.value)}
                className="w-full min-h-[100px] p-3 border rounded-md text-sm"
                dir="rtl"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSmsDialogOpen(false)}>إلغاء</Button>
            <Button onClick={sendReturnedChequeSms} disabled={sendingSms || !smsCheque?.policy?.client?.phone_number}>
              {sendingSms ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
              إرسال
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reason prompt for إلغاء / رجع. Reason is required because
          accounting treats both as voiding the cheque (refused=true →
          dropped from the customer's paid total) and the bookkeeper
          needs a written explanation for the audit trail. Stored as
          a notes line for now; will move to a dedicated column with
          the cancellation-voucher work in step 5. */}
      <Dialog open={reasonDialogOpen} onOpenChange={(o) => {
        if (!o) {
          setReasonDialogOpen(false);
          setReasonAction(null);
          setReasonChequeId(null);
          setReasonText("");
          setReasonError(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reasonAction === 'cancelled' ? 'إلغاء الشيك' : 'رجع الشيك'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <Label htmlFor="reason-text">
              سبب {reasonAction === 'cancelled' ? 'الإلغاء' : 'الرجع'}
              <span className="text-destructive mr-1">*</span>
            </Label>
            <Textarea
              id="reason-text"
              value={reasonText}
              onChange={(e) => {
                setReasonText(e.target.value);
                if (e.target.value.trim()) setReasonError(null);
              }}
              placeholder={reasonAction === 'cancelled'
                ? 'مثال: العميل طلب الإلغاء، شيك مكرر، خطأ في الإصدار...'
                : 'مثال: لا يوجد رصيد، شيك مرتجع من البنك، تم إيقاف الصرف...'}
              rows={3}
              autoFocus
              disabled={reasonSubmitting}
            />
            {reasonError && <p className="text-sm text-destructive">{reasonError}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReasonDialogOpen(false)}
              disabled={reasonSubmitting}
            >
              إلغاء
            </Button>
            <Button
              variant={reasonAction === 'cancelled' ? 'default' : 'destructive'}
              onClick={confirmReasonAction}
              disabled={reasonSubmitting || !reasonText.trim()}
            >
              {reasonSubmitting ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
              تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Policy Details Drawer */}
      <PolicyDetailsDrawer
        open={policyDrawerOpen}
        onOpenChange={setPolicyDrawerOpen}
        policyId={selectedPolicyId}
        onViewRelatedPolicy={(newPolicyId) => {
          setSelectedPolicyId(newPolicyId);
        }}
      />
      {/* Add Customer Cheque Modal */}
      <AddCustomerChequeModal
        open={addChequeModalOpen}
        onOpenChange={setAddChequeModalOpen}
        onSuccess={() => {
          fetchCheques();
          fetchSummaryStats();
        }}
      />

      {/* Full payment edit dialog — same component used from the
          policy timeline / PaymentGroupDetailsDialog, so editing a
          cheque from here matches the rest of the app. */}
      <PaymentEditDialog
        open={paymentEditOpen}
        onOpenChange={(o) => {
          setPaymentEditOpen(o);
          if (!o) {
            setPaymentEditRecord(null);
            setPaymentEditMemberIds(undefined);
          }
        }}
        payment={paymentEditRecord}
        memberIds={paymentEditMemberIds}
        onSuccess={() => {
          setPaymentEditOpen(false);
          setPaymentEditRecord(null);
          setPaymentEditMemberIds(undefined);
          fetchCheques();
          fetchSummaryStats();
        }}
      />

      {/* Outgoing-cheque editor — covers company / broker settlements
          and expense cheques. The dialog writes back to the underlying
          *_settlements / expenses row so the accounting page sees the
          same data immediately. */}
      <EditSettlementDialog
        open={outgoingEditOpen}
        onOpenChange={(o) => {
          setOutgoingEditOpen(o);
          if (!o) setOutgoingEditRow(null);
        }}
        table={outgoingEditTable}
        row={outgoingEditRow}
        onSaved={() => {
          setOutgoingEditOpen(false);
          setOutgoingEditRow(null);
          fetchCheques();
          fetchSummaryStats();
        }}
      />
    </MainLayout>
  );
}

/**
 * Collapses customer cheque rows that share a batch_id into a single
 * logical cheque. The debt-settlement modal splits one physical
 * cheque across N policies (smallest-remaining first) and writes N
 * `policy_payments` rows with the same `batch_id` so the trigger
 * cap is respected per policy. From the user's standpoint the
 * customer signed ONE cheque, so the cheques page should render one
 * row at the cheque's face value (= SUM of splits) and let mutations
 * (status change, edit) propagate to all underlying rows via
 * `member_ids`.
 *
 * Rows pass through unchanged when:
 *  - source !== 'customer' (outgoing settlements/expenses don't have batch_id)
 *  - batch_id is null (the cheque wasn't split)
 *
 * Metadata (cheque_number, bank_code, branch_code, dates, status) is
 * identical across batch members because handleSubmit copies them
 * onto every split, so taking the first one is correct.
 */
function collapseCustomerChequesByBatch(rows: ChequeRecord[]): ChequeRecord[] {
  const result: ChequeRecord[] = [];
  const indexByBatch = new Map<string, number>();

  for (const row of rows) {
    const isOutgoing = row.source && row.source !== 'customer';

    if (isOutgoing || !row.batch_id) {
      result.push({
        ...row,
        member_ids: [row.id],
        member_policy_ids: row.policy_id ? [row.policy_id] : [],
      });
      continue;
    }

    const existingIdx = indexByBatch.get(row.batch_id);
    if (existingIdx === undefined) {
      indexByBatch.set(row.batch_id, result.length);
      result.push({
        ...row,
        member_ids: [row.id],
        member_policy_ids: row.policy_id ? [row.policy_id] : [],
      });
      continue;
    }

    const existing = result[existingIdx];
    existing.amount += row.amount;
    existing.member_ids!.push(row.id);
    if (row.policy_id) existing.member_policy_ids!.push(row.policy_id);
    if (!existing.cheque_image_url && row.cheque_image_url) {
      existing.cheque_image_url = row.cheque_image_url;
    }
    if (row.images && row.images.length > 0) {
      existing.images = [...(existing.images || []), ...row.images];
    }
  }

  return result;
}

/**
 * Fetches outgoing cheques (written from the office to companies or
 * brokers via the settlement vouchers) and shapes each row to look
 * like a ChequeRecord so it slots into the same grouped view as
 * customer cheques. The synthetic `policy.client.full_name` is the
 * recipient's name — that drives both the group header and the
 * search-by-name filter.
 */
async function fetchOutgoingCheques(): Promise<ChequeRecord[]> {
  const [csRes, bsRes, exRes] = await Promise.all([
    supabase
      .from('company_settlements')
      .select(
        'id, settlement_date, cheque_due_date, cheque_issue_date, total_amount, cheque_number, bank_code, branch_code, cheque_image_url, cheque_image_urls, status, refused, notes, company_id, insurance_companies(name, name_ar)',
      )
      .eq('payment_type', 'cheque'),
    supabase
      .from('broker_settlements')
      .select(
        'id, settlement_date, cheque_due_date, cheque_issue_date, total_amount, cheque_number, bank_code, branch_code, cheque_image_url, cheque_image_urls, status, refused, notes, broker_id, brokers(name)',
      )
      .eq('payment_type', 'cheque'),
    supabase
      .from('expenses')
      .select(
        'id, expense_date, cheque_due_date, cheque_issue_date, amount, cheque_number, bank_code, branch_code, cheque_image_url, cheque_image_urls, cheque_status, notes, contact_name, category, description',
      )
      .eq('payment_method', 'cheque'),
  ]);

  const out: ChequeRecord[] = [];

  ((csRes.data ?? []) as RawOutgoingSettlement[]).forEach((row) => {
    const recipientName =
      row.insurance_companies?.name_ar || row.insurance_companies?.name || 'شركة';
    out.push(buildOutgoingChequeRecord('company', `cs-${row.id}`, recipientName, row.company_id ?? null, row));
  });

  ((bsRes.data ?? []) as RawOutgoingSettlement[]).forEach((row) => {
    const recipientName = row.brokers?.name || 'وسيط';
    out.push(buildOutgoingChequeRecord('broker', `bs-${row.id}`, recipientName, row.broker_id ?? null, row));
  });

  ((exRes.data ?? []) as RawExpenseCheque[]).forEach((row) => {
    out.push(buildExpenseChequeRecord(row));
  });

  return out;
}

interface RawExpenseCheque {
  id: string;
  expense_date: string;
  cheque_due_date: string | null;
  cheque_issue_date: string | null;
  amount: number | null;
  cheque_number: string | null;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url: string | null;
  cheque_image_urls: string[] | null;
  cheque_status: string | null;
  notes: string | null;
  contact_name: string | null;
  category: string | null;
  description: string | null;
}

function buildExpenseChequeRecord(row: RawExpenseCheque): ChequeRecord {
  // Group label: prefer the contact (whoever we paid), fall back to
  // category/description so the row still reads cleanly when a contact
  // wasn't filled in. All expense cheques to the same contact land in
  // a single group via the synthetic client.id.
  const recipientName = row.contact_name || row.description || row.category || 'مصروف';
  const groupKey = (row.contact_name || row.category || 'misc').trim().toLowerCase();
  const status: string = row.cheque_status || 'pending';
  const firstImage =
    (Array.isArray(row.cheque_image_urls) && row.cheque_image_urls[0]) ||
    row.cheque_image_url ||
    null;
  // Same fix as buildOutgoingChequeRecord — surface the explicit due
  // date so the "تاريخ الاستحقاق" column doesn't fall back to the
  // expense_date (which is the issue date).
  const due = row.cheque_due_date || row.expense_date;
  return {
    id: `ex-${row.id}`,
    policy_id: '',
    amount: Number(row.amount ?? 0),
    payment_date: due,
    cheque_due_date: due,
    cheque_issue_date: row.cheque_issue_date || row.expense_date,
    cheque_number: row.cheque_number ?? null,
    cheque_date: row.expense_date,
    bank_code: row.bank_code ?? null,
    branch_code: row.branch_code ?? null,
    cheque_image_url: firstImage,
    cheque_status: status,
    refused: status === 'returned',
    notes: row.notes,
    policy: {
      id: `ex-${row.id}`,
      policy_type_parent: 'OUTGOING',
      client: {
        id: `expense-${groupKey}`,
        full_name: recipientName,
        broker_id: null,
        phone_number: null,
      },
      car: null,
    },
    images: firstImage
      ? [{ id: `ex-${row.id}-img`, image_url: firstImage, image_type: 'cheque' }]
      : [],
    transferred_to_type: 'expense',
    transferred_to_id: null,
    transferred_to_name: recipientName,
    transferred_payment_id: null,
    source: 'expense',
  };
}

interface RawOutgoingSettlement {
  id: string;
  settlement_date: string;
  cheque_due_date: string | null;
  cheque_issue_date: string | null;
  total_amount: number | null;
  cheque_number: string | null;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url: string | null;
  cheque_image_urls: string[] | null;
  status: string | null;
  refused: boolean | null;
  notes: string | null;
  company_id?: string | null;
  broker_id?: string | null;
  insurance_companies?: { name: string; name_ar: string | null } | null;
  brokers?: { name: string } | null;
}

function buildOutgoingChequeRecord(
  source: 'company' | 'broker',
  syntheticId: string,
  recipientName: string,
  recipientId: string | null,
  row: RawOutgoingSettlement,
): ChequeRecord {
  // Map the settlement's status + refused flag onto the customer-cheque
  // status enum so the same filter / badge code keeps working.
  const status: string = row.refused
    ? 'returned'
    : row.status === 'completed'
    ? 'cashed'
    : 'pending';
  const firstImage =
    (Array.isArray(row.cheque_image_urls) && row.cheque_image_urls[0]) ||
    row.cheque_image_url ||
    null;
  // The "تاريخ الاستحقاق" column on the Cheques page reads
  // `payment_date`. For outgoing settlements that field used to mirror
  // settlement_date (= the issue date), which is exactly the bug staff
  // reported: a cheque entered today with a future due date showed as
  // "today" because settlement_date won the race. Surface the explicit
  // due date instead, falling back to settlement_date for old rows
  // that pre-date the column.
  const due = row.cheque_due_date || row.settlement_date;
  return {
    id: syntheticId,
    policy_id: '',
    amount: Number(row.total_amount ?? 0),
    payment_date: due,
    cheque_due_date: due,
    cheque_issue_date: row.cheque_issue_date || row.settlement_date,
    cheque_number: row.cheque_number ?? null,
    cheque_date: row.settlement_date ?? null,
    bank_code: row.bank_code ?? null,
    branch_code: row.branch_code ?? null,
    cheque_image_url: firstImage,
    cheque_status: status,
    refused: row.refused ?? false,
    notes: row.notes ?? null,
    policy: {
      id: syntheticId,
      policy_type_parent: 'OUTGOING',
      // The "client" object is synthetic — it's just the simplest way
      // to reuse the existing group-by-client.id rendering. ID prefix
      // (`company-` / `broker-`) prevents collisions with real clients.
      client: {
        id: `${source}-${recipientId ?? 'unknown'}`,
        full_name: recipientName,
        broker_id: null,
        phone_number: null,
      },
      car: null,
    },
    images: firstImage
      ? [{ id: `${syntheticId}-img`, image_url: firstImage, image_type: 'cheque' }]
      : [],
    transferred_to_type: source,
    transferred_to_id: recipientId,
    transferred_to_name: recipientName,
    transferred_payment_id: null,
    source,
  };
}
