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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PdfJsViewer } from "@/components/policies/PdfJsViewer";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { useToast } from "@/hooks/use-toast";
import { PolicyDetailsDrawer } from "@/components/policies/PolicyDetailsDrawer";
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH, getEffectiveChequeStatus, isChequeOverdue } from "@/lib/chequeUtils";
import { AddCustomerChequeModal } from "@/components/cheques/AddCustomerChequeModal";
import { PaymentEditDialog } from "@/components/clients/PaymentEditDialog";
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
  payment_date: string;
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
  const [cheques, setCheques] = useState<ChequeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
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

  // Unique customers for filter
  const [uniqueCustomers, setUniqueCustomers] = useState<{ id: string; name: string }[]>([]);

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
          cheque_date, bank_code, branch_code, cheque_image_url,
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
      setPaymentEditRecord({
        id: (data as any).id,
        amount: (data as any).amount,
        payment_date: (data as any).payment_date,
        payment_type: (data as any).payment_type,
        cheque_number: (data as any).cheque_number,
        cheque_date: (data as any).cheque_date,
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

  // Fetch summary stats separately (not affected by filters)
  const fetchSummaryStats = useCallback(async () => {
    try {
      const { data: allCheques } = await supabase
        .from('policy_payments')
        .select('amount, cheque_status, payment_date')
        .eq('payment_type', 'cheque');

      if (allCheques) {
        const todayIso = new Date().toISOString().split('T')[0];
        const returnedCheques = allCheques.filter(c => c.cheque_status === 'returned');
        const pendingCheques = allCheques.filter(c => c.cheque_status === 'pending' || !c.cheque_status);
        const overdueCheques = allCheques.filter(c => isChequeOverdue(c.payment_date, c.cheque_status));
        // Cheques whose استحقاق is exactly today and aren't already
        // cashed or returned — that's what staff want to collect today.
        const dueTodayCheques = allCheques.filter(
          (c) => c.payment_date === todayIso && c.cheque_status !== 'cashed' && c.cheque_status !== 'returned',
        );

        setSummaryStats({
          returnedCount: returnedCheques.length,
          returnedTotal: returnedCheques.reduce((sum, c) => sum + Number(c.amount), 0),
          pendingCount: pendingCheques.length,
          pendingTotal: pendingCheques.reduce((sum, c) => sum + Number(c.amount), 0),
          overdueCount: overdueCheques.length,
          overdueTotal: overdueCheques.reduce((sum, c) => sum + Number(c.amount), 0),
          dueTodayCount: dueTodayCheques.length,
          dueTodayTotal: dueTodayCheques.reduce((sum, c) => sum + Number(c.amount), 0),
        });

        // Calculate monthly stats
        const monthlyMap: Record<string, MonthlyStats> = {};
        allCheques.forEach(c => {
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
          monthlyMap[monthKey].totalAmount += Number(c.amount);
          
          const status = c.cheque_status || 'pending';
          if (status === 'pending') {
            monthlyMap[monthKey].pending++;
            monthlyMap[monthKey].pendingAmount += Number(c.amount);
          } else if (status === 'cashed') {
            monthlyMap[monthKey].cashed++;
            monthlyMap[monthKey].cashedAmount += Number(c.amount);
          } else if (status === 'returned') {
            monthlyMap[monthKey].returned++;
            monthlyMap[monthKey].returnedAmount += Number(c.amount);
          }
        });

        const sortedMonths = Object.values(monthlyMap).sort((a, b) => b.month.localeCompare(a.month));
        setMonthlyStats(sortedMonths);
      }
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
          id, policy_id, amount, payment_date, cheque_number, cheque_date,
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
        };
      });

      // Search filter (includes customer name search)
      let filtered = searchQuery 
        ? formattedCheques.filter(c => 
            c.policy?.client?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.cheque_number?.includes(searchQuery) ||
            c.policy?.client?.phone_number?.includes(searchQuery)
          )
        : formattedCheques;

      if (customerFilter !== "all") {
        filtered = filtered.filter(c => c.policy?.client?.id === customerFilter);
      }

      // Build unique customers list
      const customers = [...new Map(
        formattedCheques
          .filter(c => c.policy?.client?.id && c.policy?.client?.full_name)
          .map(c => [c.policy!.client!.id, { id: c.policy!.client!.id, name: c.policy!.client!.full_name }])
      ).values()];
      setUniqueCustomers(customers.sort((a, b) => a.name.localeCompare(b.name, 'ar')));

      setCheques(filtered);
      setTotalCount(count || 0);
      
      // Expand all customers by default if there are few
      if (customers.length <= 10) {
        setExpandedCustomers(new Set(customers.map(c => c.id)));
      }
    } catch (error) {
      console.error('Error fetching cheques:', error);
      toast({ title: "خطأ", description: "فشل في تحميل الشيكات", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentPage, statusFilter, overdueOnly, dueTodayOnly, searchQuery, customerFilter, toast]);

  useEffect(() => { fetchSummaryStats(); }, [fetchSummaryStats]);
  useEffect(() => { fetchCheques(); }, [fetchCheques]);

  const handleStatusChange = async (chequeId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('policy_payments')
        .update({ cheque_status: newStatus, refused: newStatus === 'returned' })
        .eq('id', chequeId);

      if (error) throw error;
      toast({ title: "تم التحديث", description: "تم تحديث حالة الشيك" });
      
      // Auto SMS on returned cheque
      if (newStatus === 'returned') {
        const cheque = cheques.find(c => c.id === chequeId);
        if (cheque?.policy?.client?.phone_number) {
          const clientName = cheque.policy.client.full_name || "العميل";
          const chequeNum = cheque.cheque_number || "";
          const autoMessage = `مرحباً ${clientName}، نود إعلامك بأن الشيك رقم ${chequeNum} بمبلغ ${formatCurrency(cheque.amount)} قد تم إرجاعه. يرجى التواصل معنا لتسوية الأمر.`;
          
          try {
            const { error: autoSmsError } = await supabase.functions.invoke('send-sms', {
              body: {
                phone: cheque.policy.client.phone_number,
                message: autoMessage,
                clientId: cheque.policy.client.id,
                policyId: cheque.policy_id,
                smsType: 'manual',
              }
            });
            if (autoSmsError) throw autoSmsError;
            toast({ title: "تم إرسال SMS", description: "تم إرسال إشعار للعميل بالشيك المرتجع" });
          } catch (smsError) {
            console.error('Failed to send auto SMS:', smsError);
            const msg = await extractFunctionErrorMessage(smsError);
            if (msg) {
              toast({ title: "تنبيه", description: msg });
            }
          }
        }
      }
      
      fetchCheques();
      fetchSummaryStats();
    } catch (error) {
      toast({ title: "خطأ", description: "فشل في تحديث الحالة", variant: "destructive" });
    }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedCheques.size === 0) return;
    
    setBulkActionLoading(true);
    try {
      const { error } = await supabase
        .from('policy_payments')
        .update({ cheque_status: newStatus, refused: newStatus === 'returned' })
        .in('id', Array.from(selectedCheques));

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
      const { error } = await supabase
        .from('policy_payments')
        .update({ 
          cheque_number: sanitized,
          cheque_status: 'pending',
          refused: false,
        })
        .eq('id', editingCheque.id);

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
          <bdi>{cheque.cheque_number || "-"}</bdi>
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
          <div className="flex items-center gap-1">
            {formatDate(cheque.payment_date)}
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
            {/* Show transfer info if transferred */}
            {cheque.cheque_status === 'transferred_out' && cheque.transferred_to_name && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>
                  → {cheque.transferred_to_type === 'broker' ? 'وسيط' : 'شركة'}: {cheque.transferred_to_name}
                </span>
                {cheque.transferred_to_type && cheque.transferred_to_id && cheque.transferred_payment_id && (
                  <button
                    className="underline hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (cheque.transferred_to_type === 'broker') {
                        navigate(`/brokers/${cheque.transferred_to_id}/wallet?settlement=${cheque.transferred_payment_id}`);
                      } else {
                        navigate(`/companies/${cheque.transferred_to_id}/wallet?settlement=${cheque.transferred_payment_id}`);
                      }
                    }}
                  >
                    عرض في المحفظة
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
              <DropdownMenuItem
                disabled={loadingPaymentEdit}
                onClick={() => openPaymentEditFor(cheque)}
              >
                <Pencil className="h-4 w-4 ml-2" />
                تعديل الدفعة
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setSelectedPolicyId(cheque.policy_id);
                  setPolicyDrawerOpen(true);
                }}
              >
                <ExternalLink className="h-4 w-4 ml-2" />
                عرض المعاملة
              </DropdownMenuItem>
              {cheque.cheque_status !== 'cashed' &&
                cheque.cheque_status !== 'returned' &&
                cheque.cheque_status !== 'transferred_out' && (
                  <DropdownMenuItem
                    onClick={() => handleStatusChange(cheque.id, 'cashed')}
                    className="text-green-600 focus:text-green-700"
                  >
                    <CheckCircle2 className="h-4 w-4 ml-2" />
                    صرف الشيك
                  </DropdownMenuItem>
                )}
              {cheque.cheque_status !== 'returned' &&
                cheque.cheque_status !== 'transferred_out' && (
                  <DropdownMenuItem
                    onClick={() => handleStatusChange(cheque.id, 'returned')}
                    className="text-destructive focus:text-destructive"
                  >
                    <RotateCcw className="h-4 w-4 ml-2" />
                    رجع الشيك
                  </DropdownMenuItem>
                )}
              {cheque.cheque_status === 'returned' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleEditCheque(cheque)}>
                    <Edit className="h-4 w-4 ml-2" />
                    تغيير رقم الشيك
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openSmsDialog(cheque)}>
                    <MessageSquare className="h-4 w-4 ml-2" />
                    إرسال SMS للعميل
                  </DropdownMenuItem>
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

      <div className="p-6 space-y-4">
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
            {/* Toolbar */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="بحث بالعميل، رقم الشيك، أو رقم الهاتف..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="pr-9"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={customerFilter} onValueChange={(v) => { setCustomerFilter(v); setCurrentPage(1); }}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="العميل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع العملاء</SelectItem>
                    {uniqueCustomers.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                  <SelectTrigger className="w-[130px]">
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
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setAddChequeModalOpen(true)}
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" />
                  إضافة شيكات لعميل
                </Button>
                <div className="flex gap-1">
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
                                    <User className="h-4 w-4 text-primary" />
                                    <span className="font-semibold">{group.customerName}</span>
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
                  {customerGroups.length} عميل، {cheques.length} شيك من {totalCount}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">صفحة {currentPage} من {totalPages || 1}</span>
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>
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
          if (!o) setPaymentEditRecord(null);
        }}
        payment={paymentEditRecord}
        onSuccess={() => {
          setPaymentEditOpen(false);
          setPaymentEditRecord(null);
          fetchCheques();
          fetchSummaryStats();
        }}
      />
    </MainLayout>
  );
}
