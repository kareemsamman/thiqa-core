import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { 
  Plus, 
  Receipt,
  ArrowDownRight,
  ArrowUpRight,
  Wallet,
  Search,
  Trash2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Banknote,
  CreditCard,
  Building,
  FileText,
  ShieldCheck,
  FileDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { he } from "date-fns/locale";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { POLICY_TYPE_LABELS } from "@/lib/insuranceTypes";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { buildExpenseInvoiceHtml, openExpenseInvoicePrint } from "@/lib/expenseInvoiceBuilder";

interface Expense {
  id: string;
  category: string;
  description: string | null;
  amount: number;
  expense_date: string;
  notes: string | null;
  receipt_url: string | null;
  created_at: string;
  voucher_type: string;
  payment_method: string;
  reference_number: string | null;
  contact_name: string | null;
  created_by_name?: string | null;
  is_policy_payment?: boolean;
  is_company_due?: boolean;
  is_elzami_commission?: boolean;
}

// Payment categories
const paymentCategories: Record<string, string> = {
  rent: 'إيجار المكتب',
  salaries: 'معاشات الموظفين',
  food: 'طعام المكتب',
  utilities: 'فواتير (كهرباء/ماء/إنترنت)',
  insurance_company: 'دفع لشركة تأمين',
  insurance_company_due: 'مستحق لشركة تأمين',
  other: 'مصاريف أخرى',
};

// Receipt categories
const receiptCategories: Record<string, string> = {
  insurance_premium: 'قسط تأمين',
  commission: 'عمولة',
  elzami_office_commission: 'عمولة مكتب إلزامي',
  debt_collection: 'تحصيل دين',
  other_income: 'إيرادات أخرى',
};

const paymentMethodLabels: Record<string, { label: string; icon: any }> = {
  cash: { label: 'نقدي', icon: Banknote },
  cheque: { label: 'شيك', icon: FileText },
  bank_transfer: { label: 'تحويل بنكي', icon: Building },
  visa: { label: 'فيزا', icon: CreditCard },
};

// Access is controlled by admin role — no hardcoded email restriction

export default function Expenses() {
  const { profile, isAdmin, user } = useAuth();
  const { data: siteSettings } = useSiteSettings();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  
  // Summary
  const [totalReceipts, setTotalReceipts] = useState(0);
  const [totalPayments, setTotalPayments] = useState(0);
  const [totalCompanyDues, setTotalCompanyDues] = useState(0);
  
  // Filters
  const [voucherFilter, setVoucherFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  
  // Form state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [formData, setFormData] = useState({
    voucher_type: 'payment' as 'payment' | 'receipt',
    category: 'other',
    description: '',
    amount: '',
    expense_date: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
    payment_method: 'cash',
    reference_number: '',
    contact_name: '',
  });
  const [saving, setSaving] = useState(false);
  
  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Map policy payment_type to our payment_method keys
  const mapPaymentType = (pt: string): string => {
    switch (pt) {
      case 'cash': return 'cash';
      case 'cheque': return 'cheque';
      case 'visa': return 'visa';
      case 'transfer': return 'bank_transfer';
      default: return 'cash';
    }
  };

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const monthStart = format(startOfMonth(selectedMonth), 'yyyy-MM-dd');
      const monthEnd = format(endOfMonth(selectedMonth), 'yyyy-MM-dd');
      
      // Query 1: Manual expenses
      let query = supabase
        .from('expenses')
        .select('*, profiles:created_by_admin_id(full_name)')
        .gte('expense_date', monthStart)
        .lte('expense_date', monthEnd)
        .order('expense_date', { ascending: false });
      
      // For manual expenses, filter by voucher type only for receipt/payment tabs
      if (voucherFilter === 'payment') {
        query = query.eq('voucher_type', 'payment');
      } else if (voucherFilter === 'receipt') {
        query = query.eq('voucher_type', 'receipt');
      } else if (voucherFilter === 'company_dues') {
        // company_dues tab: no manual expenses needed (they don't have this type)
        query = query.eq('voucher_type', '__none__'); // return nothing
      }
      if (categoryFilter !== 'all' && categoryFilter !== 'insurance_premium' && categoryFilter !== 'insurance_company_due') {
        query = query.eq('category', categoryFilter);
      }
      if (paymentMethodFilter !== 'all') {
        query = query.eq('payment_method', paymentMethodFilter);
      }
      
      // Query 2: Policy payments for receipts (exclude ELZAMI)
      const shouldFetchPolicyPayments = (voucherFilter === 'all' || voucherFilter === 'receipt') && 
        (categoryFilter === 'all' || categoryFilter === 'insurance_premium');
      
      // Query 3: Company dues (policies with payed_for_company > 0)
      const shouldFetchCompanyDues = voucherFilter === 'all' || voucherFilter === 'payment' || voucherFilter === 'company_dues';

      // Query 4: ELZAMI policies for office_commission (receipt) and elzami_commission (payment)
      const shouldFetchElzami = voucherFilter === 'all' || voucherFilter === 'receipt' || voucherFilter === 'payment';

      const [expensesResult, policyPaymentsResult, companyDuesResult, elzamiResult] = await Promise.all([
        query,
        shouldFetchPolicyPayments
          ? supabase
              .from('policy_payments')
              .select('id, amount, payment_date, payment_type, notes, policy_id, refused, locked, created_at, created_by_admin_id, creator:profiles!policy_payments_created_by_admin_id_fkey(full_name), policies!inner(policy_number, policy_type_parent, clients!inner(full_name), cars(car_number))')
              .gte('payment_date', monthStart)
              .lte('payment_date', monthEnd)
              .eq('refused', false)
              .neq('policies.policy_type_parent', 'ELZAMI')
          : Promise.resolve({ data: [], error: null }),
        shouldFetchCompanyDues
          ? supabase
              .from('policies')
              .select('id, policy_number, policy_type_parent, payed_for_company, start_date, created_at, created_by_admin_id, creator:profiles!policies_created_by_admin_id_fkey(full_name), insurance_companies(name), clients!inner(full_name), cars(car_number)')
              .gte('start_date', monthStart)
              .lte('start_date', monthEnd)
              .eq('cancelled', false)
              .is('deleted_at', null)
              .gt('payed_for_company', 0)
              .neq('policy_type_parent', 'ELZAMI')
          : Promise.resolve({ data: [], error: null }),
        shouldFetchElzami
          ? supabase
              .from('policies')
              .select('id, policy_number, policy_type_parent, office_commission, start_date, created_at, created_by_admin_id, creator:profiles!policies_created_by_admin_id_fkey(full_name), insurance_companies(name, elzami_commission), clients!inner(full_name), cars(car_number)')
              .gte('start_date', monthStart)
              .lte('start_date', monthEnd)
              .eq('policy_type_parent', 'ELZAMI')
              .eq('cancelled', false)
              .is('deleted_at', null)
          : Promise.resolve({ data: [], error: null }),
      ]);
      
      if (expensesResult.error) throw expensesResult.error;
      if (policyPaymentsResult.error) throw policyPaymentsResult.error;
      if (companyDuesResult.error) throw companyDuesResult.error;
      if (elzamiResult.error) throw elzamiResult.error;
      
      let manualExpenses: Expense[] = (expensesResult.data || []).map((e: any) => ({
        ...e,
        created_by_name: e.profiles?.full_name || null,
      }));
      
      // Convert policy payments to Expense shape (receipts)
      const policyExpenses: Expense[] = (policyPaymentsResult.data || [])
        .filter((pp: any) => {
          if (paymentMethodFilter !== 'all' && mapPaymentType(pp.payment_type) !== paymentMethodFilter) return false;
          return true;
        })
        .map((pp: any) => {
          const policy = pp.policies;
          const clientName = policy?.clients?.full_name || '';
          const carNumber = policy?.cars?.car_number || '';
          const typeLabel = POLICY_TYPE_LABELS[policy?.policy_type_parent as keyof typeof POLICY_TYPE_LABELS] || '';
          const desc = [typeLabel, carNumber ? `رقم ${carNumber}` : '', policy?.policy_number ? `بوليصة ${policy.policy_number}` : ''].filter(Boolean).join(' - ');
          
          return {
            id: `pp_${pp.id}`,
            category: 'insurance_premium',
            description: desc,
            amount: Number(pp.amount),
            expense_date: pp.payment_date,
            notes: pp.notes,
            receipt_url: null,
            created_at: pp.created_at || pp.payment_date,
            voucher_type: 'receipt',
            payment_method: mapPaymentType(pp.payment_type),
            reference_number: null,
            contact_name: clientName,
            created_by_name: (pp.creator as any)?.full_name || null,
            is_policy_payment: true,
          } as Expense;
        });
      
      // Convert company dues to Expense shape (payment vouchers)
      const companyDueExpenses: Expense[] = (companyDuesResult.data || [])
        .map((p: any) => {
          const companyName = p.insurance_companies?.name || 'شركة تأمين';
          const typeLabel = POLICY_TYPE_LABELS[p.policy_type_parent as keyof typeof POLICY_TYPE_LABELS] || '';
          const carNumber = p.cars?.car_number || '';
          const clientName = p.clients?.full_name || '';
          const desc = [typeLabel, carNumber ? `رقم ${carNumber}` : '', clientName, p.policy_number ? `بوليصة ${p.policy_number}` : ''].filter(Boolean).join(' - ');
          
          return {
            id: `cp_${p.id}`,
            category: 'insurance_company_due',
            description: desc,
            amount: Number(p.payed_for_company),
            expense_date: p.start_date,
            notes: null,
            receipt_url: null,
            created_at: p.created_at || p.start_date,
            voucher_type: 'payment',
            payment_method: 'bank_transfer',
            reference_number: null,
            contact_name: companyName,
            created_by_name: (p.creator as any)?.full_name || null,
            is_policy_payment: true,
            is_company_due: true,
          } as Expense;
        });
      
      // Convert ELZAMI policies to commission vouchers
      const elzamiVouchers: Expense[] = (elzamiResult.data || []).flatMap((p: any) => {
        const clientName = p.clients?.full_name || '';
        const companyName = p.insurance_companies?.name || 'شركة تأمين';
        const carNumber = p.cars?.car_number || '';
        const desc = ['إلزامي', carNumber ? `رقم ${carNumber}` : '', p.policy_number ? `بوليصة ${p.policy_number}` : ''].filter(Boolean).join(' - ');
        const results: Expense[] = [];
        
        // Office commission → receipt voucher (AB's revenue)
        if (Number(p.office_commission) > 0) {
          results.push({
            id: `oc_${p.id}`,
            category: 'elzami_office_commission',
            description: desc,
            amount: Number(p.office_commission),
            expense_date: p.start_date,
            notes: null,
            receipt_url: null,
            created_at: p.created_at || p.start_date,
            voucher_type: 'receipt',
            payment_method: 'cash',
            reference_number: null,
            contact_name: clientName,
            created_by_name: (p.creator as any)?.full_name || null,
            is_policy_payment: true,
            is_elzami_commission: true,
          } as Expense);
        }
        
        
        return results;
      });

      // Filter elzami vouchers by tab
      const filteredElzamiVouchers = elzamiVouchers.filter(v => {
        if (voucherFilter === 'receipt') return v.voucher_type === 'receipt';
        if (voucherFilter === 'payment') return v.voucher_type === 'payment';
        if (voucherFilter === 'company_dues') return false;
        return true; // 'all'
      });

      // Merge and sort
      let allExpenses = [...manualExpenses, ...policyExpenses, ...companyDueExpenses, ...filteredElzamiVouchers];
      // Sort by created_at descending (newest first)
      allExpenses.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      // Client-side date range filter
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        allExpenses = allExpenses.filter(e => new Date(e.created_at) >= from);
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        allExpenses = allExpenses.filter(e => new Date(e.created_at) <= to);
      }
      
      // Client-side search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        allExpenses = allExpenses.filter(e => 
          (e.description && e.description.toLowerCase().includes(q)) ||
          (e.notes && e.notes.toLowerCase().includes(q)) ||
          (e.contact_name && e.contact_name.toLowerCase().includes(q))
        );
      }
      
      setExpenses(allExpenses);
      
      // Calculate totals from ALL data for the month (reuse already-fetched elzami data)
      const [totalsResult, policyTotalsResult, companyDuesTotalsResult] = await Promise.all([
        supabase
          .from('expenses')
          .select('amount, voucher_type')
          .gte('expense_date', monthStart)
          .lte('expense_date', monthEnd),
        supabase
          .from('policy_payments')
          .select('amount, policies!inner(policy_type_parent)')
          .gte('payment_date', monthStart)
          .lte('payment_date', monthEnd)
          .eq('refused', false)
          .neq('policies.policy_type_parent', 'ELZAMI'),
        supabase
          .from('policies')
          .select('payed_for_company')
          .gte('start_date', monthStart)
          .lte('start_date', monthEnd)
          .eq('cancelled', false)
          .is('deleted_at', null)
          .gt('payed_for_company', 0)
          .neq('policy_type_parent', 'ELZAMI'),
      ]);
      
      let receipts = 0, payments = 0, companyDues = 0;
      (totalsResult.data || []).forEach(e => {
        if (e.voucher_type === 'receipt') receipts += Number(e.amount);
        else payments += Number(e.amount);
      });
      // Add policy payments to receipts (excluding ELZAMI)
      (policyTotalsResult.data || []).forEach(pp => {
        receipts += Number(pp.amount);
      });
      // Add ELZAMI office commissions to receipts
      elzamiVouchers.forEach(v => {
        if (v.voucher_type === 'receipt') receipts += v.amount;
      });
      // Company dues total
      (companyDuesTotalsResult.data || []).forEach(p => {
        companyDues += Number(p.payed_for_company);
      });
      
      setTotalReceipts(receipts);
      setTotalPayments(payments);
      setTotalCompanyDues(companyDues);
      
    } catch (error) {
      console.error('Error fetching expenses:', error);
      toast.error('حدث خطأ في جلب البيانات');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, voucherFilter, categoryFilter, paymentMethodFilter, searchQuery, dateFrom, dateTo]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  const handleSubmit = async () => {
    if (!formData.category || !formData.amount || !formData.expense_date) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }
    
    setSaving(true);
    try {
      const expenseData: any = {
        category: formData.category,
        description: formData.description || null,
        amount: parseFloat(formData.amount),
        expense_date: formData.expense_date,
        notes: formData.notes || null,
        created_by_admin_id: profile?.id,
        voucher_type: formData.voucher_type,
        payment_method: formData.payment_method,
        reference_number: formData.reference_number || null,
        contact_name: formData.contact_name || null,
      };
      
      if (editingExpense) {
        const { error } = await supabase
          .from('expenses')
          .update(expenseData)
          .eq('id', editingExpense.id);
        if (error) throw error;
        toast.success('تم تحديث السند');
      } else {
        const { error } = await supabase
          .from('expenses')
          .insert(expenseData);
        if (error) throw error;
        toast.success(formData.voucher_type === 'receipt' ? 'تم إضافة سند القبض' : 'تم إضافة سند الصرف');
      }
      
      setIsDialogOpen(false);
      setEditingExpense(null);
      resetForm();
      fetchExpenses();
    } catch (error) {
      console.error('Error saving:', error);
      toast.error('حدث خطأ في الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      voucher_type: 'payment',
      category: 'other',
      description: '',
      amount: '',
      expense_date: format(new Date(), 'yyyy-MM-dd'),
      notes: '',
      payment_method: 'cash',
      reference_number: '',
      contact_name: '',
    });
  };

  const handleEdit = (expense: Expense) => {
    setEditingExpense(expense);
    setFormData({
      voucher_type: (expense.voucher_type || 'payment') as 'payment' | 'receipt',
      category: expense.category,
      description: expense.description || '',
      amount: expense.amount.toString(),
      expense_date: expense.expense_date,
      notes: expense.notes || '',
      payment_method: expense.payment_method || 'cash',
      reference_number: expense.reference_number || '',
      contact_name: expense.contact_name || '',
    });
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (id: string) => {
    setDeletingId(id);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('expenses').delete().eq('id', deletingId);
      if (error) throw error;
      toast.success('تم حذف السند');
      setDeleteDialogOpen(false);
      setDeletingId(null);
      fetchExpenses();
    } catch (error) {
      console.error('Error deleting:', error);
      toast.error('حدث خطأ في الحذف');
    } finally {
      setDeleting(false);
    }
  };

  const formatCurrency = (amount: number) => `₪${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-GB');
  const prevMonth = () => setSelectedMonth(prev => subMonths(prev, 1));
  const nextMonth = () => setSelectedMonth(prev => addMonths(prev, 1));

  const currentCategories = formData.voucher_type === 'receipt' ? receiptCategories : paymentCategories;
  const allCategories = { ...paymentCategories, ...receiptCategories };
  const netMonth = totalReceipts - totalPayments - totalCompanyDues;

  const handleExportInvoice = (type: 'receipt' | 'payment') => {
    const monthLabel = format(selectedMonth, 'MMMM yyyy', { locale: he });
    const logoUrl = siteSettings?.logo_url || null;
    const businessName = siteSettings?.site_title || 'ثقة للتأمين';
    const filtered = expenses.filter(e => e.voucher_type === type && !e.is_company_due);
    const html = buildExpenseInvoiceHtml(
      filtered as any,
      type,
      monthLabel,
      logoUrl,
      businessName,
    );
    openExpenseInvoicePrint(html);
  };

  const showExportButton = voucherFilter === 'receipt' || voucherFilter === 'payment' || voucherFilter === 'all';
  // Access control: only admin or specific email
  const canAccess = isAdmin;
  if (!canAccess) return <Navigate to="/" replace />;

  return (
    <MainLayout>
      <Header 
        title="سندات القبض والصرف" 
        subtitle="إدارة الحركات المالية"
        action={{
          label: "سند جديد",
          onClick: () => {
            setEditingExpense(null);
            resetForm();
            setIsDialogOpen(true);
          },
        }}
      />

      <div className="p-6 space-y-6">
        {/* Month Navigation */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <Button variant="outline" size="icon" onClick={prevMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <h3 className="text-xl font-bold">
                {format(selectedMonth, 'MMMM yyyy', { locale: ar })}
              </h3>
              <Button variant="outline" size="icon" onClick={nextMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards - 4 cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-l-4 border-l-success">
            <CardContent className="py-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-success/10">
                  <ArrowDownRight className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي سندات القبض</p>
                  <p className="text-2xl font-bold text-success">{formatCurrency(totalReceipts)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-l-4 border-l-destructive">
            <CardContent className="py-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-destructive/10">
                  <ArrowUpRight className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي سندات الصرف</p>
                  <p className="text-2xl font-bold text-destructive">{formatCurrency(totalPayments)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-warning">
            <CardContent className="py-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-warning/10">
                  <Building className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">المستحق للشركات</p>
                  <p className="text-2xl font-bold text-warning">{formatCurrency(totalCompanyDues)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-l-4 border-l-primary">
            <CardContent className="py-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10">
                  <Wallet className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">صافي الشهر</p>
                  <p className={`text-2xl font-bold ${netMonth >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {netMonth >= 0 ? '+' : ''}{formatCurrency(netMonth)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col gap-4">
              {/* Tabs - 4 tabs */}
              <div className="flex items-center justify-between gap-3">
                <Tabs value={voucherFilter} onValueChange={setVoucherFilter} dir="rtl">
                  <TabsList className="w-full md:w-auto">
                    <TabsTrigger value="all">الكل</TabsTrigger>
                    <TabsTrigger value="receipt">سند قبض</TabsTrigger>
                    <TabsTrigger value="payment">سند صرف</TabsTrigger>
                    <TabsTrigger value="company_dues">المستحق للشركات</TabsTrigger>
                  </TabsList>
                </Tabs>
                {showExportButton && (
                  <div className="flex gap-2">
                    {(voucherFilter === 'receipt' || voucherFilter === 'all') && (
                      <Button variant="outline" size="sm" onClick={() => handleExportInvoice('receipt')} className="gap-1.5">
                        <FileDown className="h-4 w-4" />
                        ייצוא קבלה
                      </Button>
                    )}
                    {(voucherFilter === 'payment' || voucherFilter === 'all') && (
                      <Button variant="outline" size="sm" onClick={() => handleExportInvoice('payment')} className="gap-1.5">
                        <FileDown className="h-4 w-4" />
                        ייצוא חשבונית זיכוי
                      </Button>
                    )}
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث في الوصف / الملاحظات / الجهة..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pr-10"
                  />
                </div>
                
                {/* Category filter */}
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="التصنيف" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل التصنيفات</SelectItem>
                    {Object.entries(allCategories).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {/* Payment method filter */}
                <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="طريقة الدفع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الطرق</SelectItem>
                    {Object.entries(paymentMethodLabels).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date range filter */}
              <div className="flex flex-wrap items-center gap-3">
                <Label className="text-sm whitespace-nowrap">فلتر تاريخ الإنشاء:</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">من</span>
                  <ArabicDatePicker value={dateFrom} onChange={(v) => setDateFrom(v)} placeholder="من تاريخ" compact />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">إلى</span>
                  <ArabicDatePicker value={dateTo} onChange={(v) => setDateTo(v)} placeholder="إلى تاريخ" compact />
                </div>
                {(dateFrom || dateTo) && (
                  <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>
                    مسح
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              سجل السندات
            </CardTitle>
            <CardDescription>
              {expenses.length} سند لشهر {format(selectedMonth, 'MMMM yyyy', { locale: ar })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : expenses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Receipt className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>لا توجد سندات لهذا الشهر</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>نوع السند</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>وقت الإنشاء</TableHead>
                      <TableHead>بواسطة</TableHead>
                      <TableHead>التصنيف</TableHead>
                      <TableHead>الوصف</TableHead>
                      <TableHead>الجهة</TableHead>
                      <TableHead>طريقة الدفع</TableHead>
                      <TableHead>المبلغ</TableHead>
                      <TableHead>رقم مرجعي</TableHead>
                      <TableHead className="w-[100px]">إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((expense) => {
                      const isReceipt = expense.voucher_type === 'receipt';
                      const isPP = expense.is_policy_payment;
                      const isCompanyDue = expense.is_company_due;
                      const isElzamiComm = expense.is_elzami_commission;
                      const catLabel = allCategories[expense.category] || expense.category;
                      const pm = paymentMethodLabels[expense.payment_method] || paymentMethodLabels.cash;
                      const PmIcon = pm.icon;
                      return (
                        <TableRow key={expense.id} className={isCompanyDue ? 'bg-warning/[0.04]' : isElzamiComm ? 'bg-accent/[0.06]' : isPP ? 'bg-success/[0.03]' : ''}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {isCompanyDue ? (
                                <Badge className="bg-warning/10 text-warning border-warning/20 hover:bg-warning/20">
                                  <Building className="h-3 w-3 ml-1" />مستحق شركة
                                </Badge>
                              ) : (
                                <Badge className={isReceipt 
                                  ? 'bg-success/10 text-success border-success/20 hover:bg-success/20' 
                                  : 'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20'
                                }>
                                  {isReceipt ? (
                                    <><ArrowDownRight className="h-3 w-3 ml-1" />سند قبض</>
                                  ) : (
                                    <><ArrowUpRight className="h-3 w-3 ml-1" />سند صرف</>
                                  )}
                                </Badge>
                              )}
                              {isElzamiComm && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-accent-foreground/30 text-accent-foreground">
                                  <ShieldCheck className="h-3 w-3 ml-0.5" />{isReceipt ? 'عمولة مكتب' : 'عمولة إلزامي'}
                                </Badge>
                              )}
                              {isPP && !isElzamiComm && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">
                                  <ShieldCheck className="h-3 w-3 ml-0.5" />بوليصة
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{formatDate(expense.expense_date)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {format(new Date(expense.created_at), 'dd/MM/yyyy HH:mm')}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {expense.created_by_name || '-'}
                          </TableCell>
                          <TableCell className="text-sm">{catLabel}</TableCell>
                          <TableCell className="text-sm max-w-[200px]">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="block truncate cursor-default">{expense.description || '-'}</span>
                                </TooltipTrigger>
                                {expense.description && (
                                  <TooltipContent side="top" className="max-w-xs text-right">
                                    <p>{expense.description}</p>
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                          <TableCell className="text-sm">{expense.contact_name || '-'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-sm">
                              <PmIcon className="h-3.5 w-3.5 text-muted-foreground" />
                              {pm.label}
                            </div>
                          </TableCell>
                          <TableCell className={`font-bold ${isCompanyDue ? 'text-warning' : isReceipt ? 'text-success' : 'text-destructive'}`}>
                            {isReceipt ? '+' : '-'}{formatCurrency(expense.amount)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {expense.reference_number || '-'}
                          </TableCell>
                          <TableCell>
                            {isPP ? (
                              <span className="text-xs text-muted-foreground">للعرض فقط</span>
                            ) : (
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" onClick={() => handleEdit(expense)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteClick(expense.id)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingExpense ? 'تعديل السند' : 'سند جديد'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            {/* Voucher Type Selector */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, voucher_type: 'receipt', category: 'insurance_premium' }))}
                className={`p-4 rounded-xl border-2 transition-all text-center ${
                  formData.voucher_type === 'receipt'
                    ? 'border-success bg-success/5 ring-2 ring-success/20'
                    : 'border-border hover:border-success/40'
                }`}
              >
                <ArrowDownRight className={`h-6 w-6 mx-auto mb-1 ${formData.voucher_type === 'receipt' ? 'text-success' : 'text-muted-foreground'}`} />
                <p className={`font-bold ${formData.voucher_type === 'receipt' ? 'text-success' : ''}`}>سند قبض</p>
                <p className="text-xs text-muted-foreground">مبلغ داخل</p>
              </button>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, voucher_type: 'payment', category: 'other' }))}
                className={`p-4 rounded-xl border-2 transition-all text-center ${
                  formData.voucher_type === 'payment'
                    ? 'border-destructive bg-destructive/5 ring-2 ring-destructive/20'
                    : 'border-border hover:border-destructive/40'
                }`}
              >
                <ArrowUpRight className={`h-6 w-6 mx-auto mb-1 ${formData.voucher_type === 'payment' ? 'text-destructive' : 'text-muted-foreground'}`} />
                <p className={`font-bold ${formData.voucher_type === 'payment' ? 'text-destructive' : ''}`}>سند صرف</p>
                <p className="text-xs text-muted-foreground">مبلغ خارج</p>
              </button>
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label>التصنيف *</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(currentCategories).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Contact name */}
            <div className="space-y-2">
              <Label>اسم الجهة</Label>
              <Input
                value={formData.contact_name}
                onChange={(e) => setFormData(prev => ({ ...prev, contact_name: e.target.value }))}
                placeholder={formData.voucher_type === 'receipt' ? 'من دفع؟' : 'لمن دفعت؟'}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>الوصف</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="وصف السند"
              />
            </div>

            {/* Amount + Date + Payment Method */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>المبلغ *</Label>
                <Input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>التاريخ *</Label>
                <ArabicDatePicker
                  value={formData.expense_date}
                  onChange={(date) => setFormData(prev => ({ ...prev, expense_date: date }))}
                />
              </div>
              <div className="space-y-2">
                <Label>طريقة الدفع</Label>
                <Select
                  value={formData.payment_method}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, payment_method: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(paymentMethodLabels).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Reference number */}
            <div className="space-y-2">
              <Label>رقم مرجعي (اختياري)</Label>
              <Input
                value={formData.reference_number}
                onChange={(e) => setFormData(prev => ({ ...prev, reference_number: e.target.value }))}
                placeholder="رقم الشيك أو الحوالة..."
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="ملاحظات إضافية..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">إلغاء</Button>
            </DialogClose>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'جاري الحفظ...' : editingExpense ? 'تحديث' : 'إضافة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        title="حذف السند"
        description="هل أنت متأكد من حذف هذا السند؟ لا يمكن التراجع عن هذا الإجراء."
        loading={deleting}
      />
    </MainLayout>
  );
}
