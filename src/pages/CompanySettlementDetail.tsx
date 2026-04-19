import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { ArrowRight, Building2, Download, TrendingUp, Wallet, FileText, Calculator, Printer, Eye, Pencil, RotateCcw, Loader2, CreditCard, Plus, Search, ArrowUpDown, Check, X, Receipt, RefreshCw, Trash2, Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { CalculationExplanationModal } from '@/components/reports/CalculationExplanationModal';
import { SupplementFormDialog } from '@/components/reports/SupplementFormDialog';
import { PolicyDetailsDrawer } from '@/components/policies/PolicyDetailsDrawer';
import { recalculatePolicyProfit } from '@/lib/pricingCalculator';
import { 
  POLICY_TYPE_LABELS, 
  POLICY_CHILD_LABELS, 
  getInsuranceTypeBadgeClass,
} from '@/lib/insuranceTypes';
import { cn } from '@/lib/utils';
import type { Enums } from '@/integrations/supabase/types';
import { toast } from 'sonner';

interface PolicyDetail {
  id: string;
  policy_type_parent: Enums<'policy_type_parent'>;
  policy_type_child: Enums<'policy_type_child'> | null;
  insurance_price: number;
  payed_for_company: number | null;
  profit: number | null;
  start_date: string;
  end_date: string;
  issue_date: string | null;
  is_under_24: boolean | null;
  created_at: string;
  cancelled: boolean | null;
  transferred: boolean | null;
  transferred_to_car_number: string | null;
  client: {
    id: string;
    full_name: string;
  } | null;
  car: {
    id: string;
    car_number: string;
    car_type: Enums<'car_type'> | null;
    car_value: number | null;
    year: number | null;
    manufacturer_name: string | null;
  } | null;
  creator: {
    id: string;
    full_name: string | null;
    email: string;
  } | null;
  // Flag to distinguish supplements from policies
  _isSupplement?: boolean;
  _supplementId?: string;
}

interface SettlementSupplement {
  id: string;
  company_id: string;
  description: string;
  insurance_price: number;
  company_payment: number;
  profit: number;
  settlement_date: string;
  created_at: string;
  customer_name?: string | null;
  car_number?: string | null;
  car_value?: number | null;
  policy_type?: string | null;
  is_cancelled?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
}

interface CompanyInfo {
  id: string;
  name: string;
  name_ar: string | null;
}

interface CompanyCheque {
  id: string;
  amount: number;
  payment_date: string;
  cheque_number: string | null;
  cheque_image_url: string | null;
  client_name: string | null;
  car_number: string | null;
}

export default function CompanySettlementDetail() {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const { toast: uiToast } = useToast();
  const { isAdmin } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [policies, setPolicies] = useState<PolicyDetail[]>([]);
  
  // Search & Sort
  const [searchQuery, setSearchQuery] = useState('');
  const [sortAsc, setSortAsc] = useState(true); // default old to new
  
  // Inline edit
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({
    insurance_price: 0, payed_for_company: 0, profit: 0, car_value: 0,
    policy_type_parent: '' as string,
    policy_type_child: '' as string | null,
    car_type: '' as string,
    client_name: '',
    issue_date: '' as string | null,
    start_date: '',
    end_date: '',
    company_id: '' as string | null,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [allCompanies, setAllCompanies] = useState<CompanyInfo[]>([]);
  const [showCompanyChangeWarning, setShowCompanyChangeWarning] = useState(false);
  
  // Cheques
  const [companyCheques, setCompanyCheques] = useState<CompanyCheque[]>([]);
  const [loadingCheques, setLoadingCheques] = useState(false);
  
  // Settlement supplements
  const [supplements, setSupplements] = useState<SettlementSupplement[]>([]);
  const [showSupplementForm, setShowSupplementForm] = useState(false);
  const [editingSupplement, setEditingSupplement] = useState<SettlementSupplement | null>(null);
  
  // Calculation modal
  const [selectedPolicyForCalc, setSelectedPolicyForCalc] = useState<PolicyDetail | null>(null);
  const [calculationModalOpen, setCalculationModalOpen] = useState(false);
  
  // Policy details drawer
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  
  // Recalculate profits
  const [recalculating, setRecalculating] = useState(false);
  const [recalcProgress, setRecalcProgress] = useState({ current: 0, total: 0 });
  const [showRecalcConfirm, setShowRecalcConfirm] = useState(false);

  // Filters - default to all time
  const [showAllTime, setShowAllTime] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return lastDay.toISOString().split('T')[0];
  });
  const [selectedPolicyType, setSelectedPolicyType] = useState<string>('all');
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [generatingTaxInvoice, setGeneratingTaxInvoice] = useState(false);
  const [showTaxInvoiceInput, setShowTaxInvoiceInput] = useState(false);
  const [profitPercent, setProfitPercent] = useState(10);

  // Filtered data
  const filteredPolicies = useMemo(() => {
    let result = policies.filter(policy => {
      if (selectedPolicyType !== 'all' && policy.policy_type_parent !== selectedPolicyType) {
        return false;
      }
      if (!includeCancelled && policy.cancelled) {
        return false;
      }
      return true;
    });

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(policy => {
        const safe = (val: unknown) => String(val ?? '').toLowerCase();
        const fields = [
          policy.client?.full_name,
          policy.car?.car_number,
          policy.car?.manufacturer_name,
          policy.car?.car_type,
          policy.car?.year,
          policy.car?.car_value,
          policy.insurance_price,
          policy.payed_for_company,
          policy.profit,
          policy.start_date,
          policy.policy_type_parent,
          policy.policy_type_child,
        ];
        return fields.some(f => safe(f).includes(q));
      });
    }

    // Sort by start_date
    result.sort((a, b) => {
      const dateA = new Date(a.start_date).getTime();
      const dateB = new Date(b.start_date).getTime();
      return sortAsc ? dateA - dateB : dateB - dateA;
    });

    return result;
  }, [policies, selectedPolicyType, includeCancelled, searchQuery, sortAsc]);

  // Summary totals (including supplements)
  const summary = useMemo(() => {
    const policySums = filteredPolicies.reduce(
      (acc, policy) => {
        const isTransferred = policy.transferred === true;
        return {
          totalPolicies: acc.totalPolicies + 1,
          totalInsurancePrice: acc.totalInsurancePrice + (Number(policy.insurance_price) || 0),
          totalCompanyPayment: acc.totalCompanyPayment + (isTransferred ? 0 : (Number(policy.payed_for_company) || 0)),
          totalProfit: acc.totalProfit + (isTransferred ? 0 : (Number(policy.profit) || 0)),
        };
      },
      { totalPolicies: 0, totalInsurancePrice: 0, totalCompanyPayment: 0, totalProfit: 0 }
    );
    // Add supplements
    for (const s of supplements) {
      policySums.totalInsurancePrice += Number(s.insurance_price) || 0;
      policySums.totalCompanyPayment += Number(s.company_payment) || 0;
      policySums.totalProfit += Number(s.profit) || 0;
    }
    return policySums;
  }, [filteredPolicies, supplements]);

  useEffect(() => {
    window.scrollTo(0, 0);
    // Fetch all companies for the company select
    supabase.from('insurance_companies').select('id, name, name_ar').order('name_ar').then(({ data }) => {
      setAllCompanies(data || []);
    });
  }, []);

  useEffect(() => {
    if (companyId) {
      fetchCompanyAndPolicies();
      fetchCompanyCheques();
      fetchSupplements();
    }
  }, [companyId, startDate, endDate, showAllTime]);

  const fetchSupplements = async () => {
    if (!companyId) return;
    let query = supabase.from('settlement_supplements').select('*').eq('company_id', companyId);
    if (!showAllTime) {
      query = query.gte('settlement_date', startDate).lte('settlement_date', endDate);
    }
    const { data } = await query.order('settlement_date', { ascending: true });
    setSupplements(data || []);
  };

  const handleSupplementSaved = () => {
    setEditingSupplement(null);
    fetchSupplements();
  };

  const handleDeleteSupplement = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا الملحق؟')) return;
    await supabase.from('settlement_supplements').delete().eq('id', id);
    fetchSupplements();
    toast.success('تم حذف الملحق');
  };

  const handleEditSupplement = (s: SettlementSupplement) => {
    setEditingSupplement({ ...s, _isEdit: true } as any);
    setShowSupplementForm(true);
  };

  const handleDuplicateSupplement = (s: SettlementSupplement) => {
    // Pre-fill with same data but open as "add new" (no _isEdit flag)
    setEditingSupplement({ ...s, id: '', _isEdit: false } as any);
    setShowSupplementForm(true);
  };

  const fetchCompanyAndPolicies = async () => {
    if (!companyId) return;
    
    setLoading(true);
    try {
      const { data: companyData, error: companyError } = await supabase
        .from('insurance_companies')
        .select('id, name, name_ar')
        .eq('id', companyId)
        .single();

      if (companyError) throw companyError;
      setCompany(companyData);

      let query = supabase
        .from('policies')
        .select(`
          id,
          policy_type_parent,
          policy_type_child,
          insurance_price,
          payed_for_company,
          profit,
          start_date,
          end_date,
          issue_date,
          is_under_24,
          created_at,
          cancelled,
          transferred,
          transferred_to_car_number,
          created_by_admin_id,
          clients!inner (
            id,
            full_name
          ),
          cars (
            id,
            car_number,
            car_type,
            car_value,
            year,
            manufacturer_name
          ),
          profiles:created_by_admin_id (
            id,
            full_name,
            email
          )
        `)
        .eq('company_id', companyId)
        .is('deleted_at', null);

      if (!showAllTime) {
        // Use issue_date for filtering (falls back to start_date via COALESCE in backfill)
        query = query
          .gte('issue_date', startDate)
          .lte('issue_date', endDate);
      }

      const { data: policiesData, error: policiesError } = await query.order('created_at', { ascending: true });

      if (policiesError) throw policiesError;

      const mappedPolicies: PolicyDetail[] = (policiesData || []).map((p: any) => ({
        id: p.id,
        policy_type_parent: p.policy_type_parent,
        policy_type_child: p.policy_type_child,
        insurance_price: p.insurance_price,
        payed_for_company: p.payed_for_company,
        profit: p.profit,
        start_date: p.start_date,
        end_date: p.end_date,
        issue_date: p.issue_date,
        is_under_24: p.is_under_24,
        created_at: p.created_at,
        cancelled: p.cancelled,
        transferred: p.transferred,
        transferred_to_car_number: p.transferred_to_car_number,
        client: p.clients ? { id: p.clients.id, full_name: p.clients.full_name } : null,
        car: p.cars ? {
          id: p.cars.id,
          car_number: p.cars.car_number,
          car_type: p.cars.car_type,
          car_value: p.cars.car_value,
          year: p.cars.year,
          manufacturer_name: p.cars.manufacturer_name,
        } : null,
        creator: p.profiles ? {
          id: p.profiles.id,
          full_name: p.profiles.full_name,
          email: p.profiles.email,
        } : null,
      }));

      setPolicies(mappedPolicies);
    } catch (error) {
      console.error('Error fetching data:', error);
      uiToast({
        title: 'خطأ',
        description: 'فشل في جلب البيانات',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanyCheques = async () => {
    if (!companyId) return;
    setLoadingCheques(true);
    try {
      const { data: cheques, error } = await supabase
        .from('policy_payments')
        .select('id, amount, payment_date, cheque_number, cheque_image_url, policy_id, policies(clients(full_name), cars(car_number))')
        .eq('transferred_to_type', 'company')
        .eq('transferred_to_id', companyId)
        .eq('cheque_status', 'transferred_out')
        .order('payment_date', { ascending: false });

      if (error) throw error;

      const mapped: CompanyCheque[] = (cheques || []).map((c: any) => ({
        id: c.id,
        amount: c.amount,
        payment_date: c.payment_date,
        cheque_number: c.cheque_number,
        cheque_image_url: c.cheque_image_url,
        client_name: c.policies?.clients?.full_name || null,
        car_number: c.policies?.cars?.car_number || null,
      }));

      setCompanyCheques(mapped);
    } catch (error) {
      console.error('Error fetching company cheques:', error);
    } finally {
      setLoadingCheques(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB');
  };

  const getInsuranceTypeLabelLocal = (policy: PolicyDetail) => {
    if (policy.policy_type_parent === 'THIRD_FULL' && policy.policy_type_child) {
      return POLICY_CHILD_LABELS[policy.policy_type_child] || policy.policy_type_child;
    }
    return POLICY_TYPE_LABELS[policy.policy_type_parent] || policy.policy_type_parent || '';
  };

  const getCarTypeLabel = (carType: string | null) => {
    const labels: Record<string, string> = {
      car: 'خصوصي',
      cargo: 'شحن',
      small: 'اوتوبس زعير',
      taxi: 'تاكسي',
      tjeradown4: 'تجاري < 4 طن',
      tjeraup4: 'تجاري > 4 طن',
    };
    return carType ? labels[carType] || carType : '-';
  };

  const isFullPolicy = (policy: PolicyDetail) => {
    return policy.policy_type_parent === 'THIRD_FULL' && policy.policy_type_child === 'FULL';
  };

  // Inline edit handlers
  const handleStartEdit = (policy: PolicyDetail) => {
    setEditingPolicyId(policy.id);
    setEditValues({
      insurance_price: Number(policy.insurance_price) || 0,
      payed_for_company: Number(policy.payed_for_company) || 0,
      profit: Number(policy.profit) || 0,
      car_value: Number(policy.car?.car_value) || 0,
      policy_type_parent: policy.policy_type_parent || '',
      policy_type_child: policy.policy_type_child || null,
      car_type: policy.car?.car_type || '',
      client_name: policy.client?.full_name || '',
      issue_date: policy.issue_date || null,
      start_date: policy.start_date || '',
      end_date: policy.end_date || '',
      company_id: companyId || null,
    });
  };

  const handleCancelEdit = () => {
    setEditingPolicyId(null);
  };

  const handleSaveEdit = async () => {
    if (!editingPolicyId) return;

    // Check if company changed
    if (editValues.company_id && editValues.company_id !== companyId) {
      setShowCompanyChangeWarning(true);
      return;
    }

    await executeSaveEdit();
  };

  const executeSaveEdit = async () => {
    if (!editingPolicyId) return;
    setSavingEdit(true);
    setShowCompanyChangeWarning(false);
    
    const editedPolicy = policies.find(p => p.id === editingPolicyId);
    const savedEditingId = editingPolicyId;
    
    try {
      setEditingPolicyId(null);

      // Update policy
      const policyUpdate: Record<string, unknown> = {
        insurance_price: editValues.insurance_price,
        payed_for_company: editValues.payed_for_company,
        profit: editValues.profit,
        policy_type_parent: editValues.policy_type_parent,
        policy_type_child: editValues.policy_type_parent === 'THIRD_FULL' ? editValues.policy_type_child : null,
        issue_date: editValues.issue_date || null,
        start_date: editValues.start_date,
        end_date: editValues.end_date,
      };
      if (editValues.company_id) {
        policyUpdate.company_id = editValues.company_id;
      }

      const { error } = await supabase
        .from('policies')
        .update(policyUpdate)
        .eq('id', savedEditingId);

      if (error) throw error;

      // Update car if exists
      if (editedPolicy?.car?.id) {
        const { error: carError } = await supabase
          .from('cars')
          .update({ car_value: editValues.car_value, car_type: editValues.car_type as any })
          .eq('id', editedPolicy.car.id);
        
        if (carError) throw carError;
      }

      // Update client name if exists
      if (editedPolicy?.client?.id && editValues.client_name) {
        const { error: clientError } = await supabase
          .from('clients')
          .update({ full_name: editValues.client_name })
          .eq('id', editedPolicy.client.id);
        
        if (clientError) throw clientError;
      }

      toast.success('تم تحديث البوليصة بنجاح');
      fetchCompanyAndPolicies();
    } catch (error) {
      console.error('Error saving edit:', error);
      toast.error('فشل في حفظ التعديلات');
      fetchCompanyAndPolicies();
    } finally {
      setSavingEdit(false);
    }
  };

  const handleResetFilters = () => {
    setShowAllTime(true);
    setSelectedPolicyType('all');
    setIncludeCancelled(false);
    setSearchQuery('');
  };

  const exportToCSV = () => {
    const headers = [
      'رقم المعاملة', 'اسم العميل', 'رقم السيارة', 'الشركة المصنعة', 'تصنيف السيارة',
      'نوع التأمين', 'قيمة السيارة', 'تاريخ البداية', 'تاريخ النهاية',
      'سعر التأمين', 'المستحق للشركة', 'الربح', 'أنشئ بواسطة', 'تاريخ الإنشاء',
    ];
    
    const rows = filteredPolicies.map(policy => [
      policy.id.substring(0, 8),
      policy.client?.full_name || '-',
      policy.car?.car_number || '-',
      policy.car?.manufacturer_name || '-',
      getCarTypeLabel(policy.car?.car_type || null),
      getInsuranceTypeLabelLocal(policy),
      isFullPolicy(policy) ? (policy.car?.car_value || 0) : '',
      formatDate(policy.start_date),
      formatDate(policy.end_date),
      policy.insurance_price,
      policy.payed_for_company || 0,
      policy.profit || 0,
      policy.creator?.full_name || policy.creator?.email || '-',
      formatDate(policy.created_at),
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `company-settlement-detail-${company?.name_ar || company?.name}-${showAllTime ? 'all-time' : `${startDate}-${endDate}`}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleGenerateReport = async () => {
    if (!companyId) return;
    
    setGeneratingReport(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-settlement-report', {
        body: {
          company_id: companyId,
          start_date: showAllTime ? null : startDate,
          end_date: showAllTime ? null : endDate,
          policy_type: selectedPolicyType !== 'all' ? selectedPolicyType : null,
          include_cancelled: includeCancelled,
        },
      });

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, '_blank');
        uiToast({
          title: 'تم إنشاء التقرير',
          description: `تقرير ${company?.name_ar || company?.name} جاهز للطباعة`,
        });
      }
    } catch (error) {
      console.error('Error generating report:', error);
      uiToast({
        title: 'خطأ',
        description: 'فشل في إنشاء التقرير',
        variant: 'destructive',
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleGenerateTaxInvoice = async () => {
    if (!companyId) return;
    setGeneratingTaxInvoice(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-tax-invoice', {
        body: {
          company_id: companyId,
          start_date: showAllTime ? null : startDate,
          end_date: showAllTime ? null : endDate,
          policy_type: selectedPolicyType !== 'all' ? selectedPolicyType : null,
          include_cancelled: includeCancelled,
          profit_percent: profitPercent,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, '_blank');
        uiToast({ title: 'تم إنشاء الفاتورة الضريبية', description: 'الفاتورة جاهزة للطباعة' });
      }
      setShowTaxInvoiceInput(false);
    } catch (error) {
      console.error('Error generating tax invoice:', error);
      uiToast({ title: 'خطأ', description: 'فشل في إنشاء الفاتورة الضريبية', variant: 'destructive' });
    } finally {
      setGeneratingTaxInvoice(false);
    }
  };

  const handleExplainCalculation = (policy: PolicyDetail) => {
    setSelectedPolicyForCalc(policy);
    setCalculationModalOpen(true);
  };

  const handleViewPolicy = (policyId: string) => {
    setSelectedPolicyId(policyId);
    setDetailsDrawerOpen(true);
  };

  const handlePolicyUpdated = () => {
    fetchCompanyAndPolicies();
  };

  const handleRecalculateProfits = async () => {
    setShowRecalcConfirm(false);
    const eligiblePolicies = filteredPolicies.filter(p => !p.cancelled && !p.transferred);
    if (eligiblePolicies.length === 0) return;

    setRecalculating(true);
    setRecalcProgress({ current: 0, total: eligiblePolicies.length });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < eligiblePolicies.length; i++) {
      const result = await recalculatePolicyProfit(eligiblePolicies[i].id);
      if (result) successCount++;
      else failCount++;
      setRecalcProgress({ current: i + 1, total: eligiblePolicies.length });
    }

    setRecalculating(false);
    await fetchCompanyAndPolicies();

    toast.success(`تم إعادة احتساب ${successCount} معاملة${failCount > 0 ? ` (${failCount} فشل)` : ''}`);
  };

  const getFilterDescription = () => {
    const parts: string[] = [];
    if (showAllTime) {
      parts.push('كل الفترات');
    } else {
      parts.push(`من ${formatDate(startDate)} إلى ${formatDate(endDate)}`);
    }
    if (!includeCancelled) {
      parts.push('بدون الملغية');
    }
    return parts.join(' • ');
  };

  if (!isAdmin) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-4">
            <Building2 className="h-16 w-16 mx-auto text-muted-foreground" />
            <h2 className="text-xl font-semibold">غير مصرح</h2>
            <p className="text-muted-foreground">هذه الصفحة متاحة للمسؤولين فقط</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Header
        title={`تفاصيل تسوية ${company?.name_ar || company?.name || 'الشركة'}`}
        subtitle="عرض جميع المعاملات وتفاصيل الحسابات"
      />

      <div className="p-6 space-y-6 print:p-0">
        {/* Back button and Wallet access */}
        <div className="flex items-center justify-between flex-wrap gap-4 print:hidden">
          <Button
            variant="ghost"
            onClick={() => navigate('/reports/company-settlement')}
          >
            <ArrowRight className="h-4 w-4 ml-2" />
            العودة للتقرير الرئيسي
          </Button>
          
          <Button
            variant="default"
            onClick={() => navigate(`/reports/company-settlement/${companyId}/wallet`)}
            className="gap-2"
          >
            <CreditCard className="h-4 w-4" />
            محفظة الشركة / دفعة جديدة
          </Button>
        </div>


        {/* Filters */}
        <Card className="print:hidden">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>من تاريخ</Label>
                <ArabicDatePicker
                  value={startDate}
                  onChange={(date) => {
                    setStartDate(date);
                    setShowAllTime(false);
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label>إلى تاريخ</Label>
                <ArabicDatePicker
                  value={endDate}
                  onChange={(date) => {
                    setEndDate(date);
                    setShowAllTime(false);
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label>نوع التأمين</Label>
                <Select value={selectedPolicyType} onValueChange={setSelectedPolicyType}>
                  <SelectTrigger>
                    <SelectValue placeholder="جميع الأنواع" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="all">جميع الأنواع</SelectItem>
                    {Object.entries(POLICY_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>الملغية</Label>
                <Select 
                  value={includeCancelled ? 'include' : 'exclude'} 
                  onValueChange={(v) => setIncludeCancelled(v === 'include')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="exclude">استبعاد الملغية</SelectItem>
                    <SelectItem value="include">تضمين الملغية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Action buttons row */}
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-border">
              <Button 
                variant="default" 
                onClick={handleGenerateReport}
                disabled={generatingReport}
              >
                {generatingReport ? (
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 ml-2" />
                )}
                تقرير PDF
              </Button>
              <Button variant="outline" onClick={exportToCSV}>
                <Download className="h-4 w-4 ml-2" />
                CSV
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowTaxInvoiceInput(!showTaxInvoiceInput)}
              >
                <Receipt className="h-4 w-4 ml-2" />
                فاتورة ضريبية
              </Button>
              <Button variant="ghost" onClick={handleResetFilters} disabled={showAllTime}>
                <RotateCcw className="h-4 w-4 ml-2" />
                كل الفترات
              </Button>
              <div className="mr-auto">
                <Button 
                  variant="outline"
                  onClick={() => setShowRecalcConfirm(true)}
                  disabled={recalculating || filteredPolicies.filter(p => !p.cancelled && !p.transferred).length === 0}
                >
                  <RefreshCw className="h-4 w-4 ml-2" />
                  إعادة احتساب الأرباح ({filteredPolicies.filter(p => !p.cancelled && !p.transferred).length})
                </Button>
              </div>
            </div>

            {/* Recalculation Progress */}
            {recalculating && (
              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>جاري إعادة الاحتساب...</span>
                  <span>{recalcProgress.current} / {recalcProgress.total}</span>
                </div>
                <Progress value={(recalcProgress.current / recalcProgress.total) * 100} />
              </div>
            )}

            {/* Tax Invoice Percent Input */}
            {showTaxInvoiceInput && (
              <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border">
                <Label className="whitespace-nowrap">نسبة المربح:</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={profitPercent}
                  onChange={(e) => setProfitPercent(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
                <Button 
                  onClick={handleGenerateTaxInvoice}
                  disabled={generatingTaxInvoice}
                >
                  {generatingTaxInvoice ? (
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  ) : (
                    <Receipt className="h-4 w-4 ml-2" />
                  )}
                  إنشاء الفاتورة
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Print Header */}
        <div className="hidden print:block text-center mb-6">
          <h1 className="text-2xl font-bold">تفاصيل تسوية {company?.name_ar || company?.name}</h1>
          <p className="text-muted-foreground">{getFilterDescription()}</p>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">عدد المعاملات</p>
                  <p className="text-2xl font-bold">{summary.totalPolicies.toLocaleString('en-US')}</p>
                </div>
                <div className="rounded-xl bg-primary/10 p-3 print:hidden">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">إجمالي المحصل</p>
                  <p className="text-2xl font-bold">₪{summary.totalInsurancePrice.toLocaleString('en-US')}</p>
                </div>
                <div className="rounded-xl bg-primary/10 p-3 print:hidden">
                  <Wallet className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">المستحق للشركة</p>
                  <p className="text-2xl font-bold text-destructive">₪{summary.totalCompanyPayment.toLocaleString('en-US')}</p>
                </div>
                <div className="rounded-xl bg-destructive/10 p-3 print:hidden">
                  <Building2 className="h-6 w-6 text-destructive" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">إجمالي الربح</p>
                  <p className="text-2xl font-bold text-success">₪{summary.totalProfit.toLocaleString('en-US')}</p>
                </div>
                <div className="rounded-xl bg-success/10 p-3 print:hidden">
                  <TrendingUp className="h-6 w-6 text-success" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Policies Table */}
        <Card>
          <CardHeader className="print:pb-2">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle>المعاملات ({filteredPolicies.length})</CardTitle>
              <div className="flex items-center gap-2 flex-1 max-w-md print:hidden">
                <Button size="sm" variant="outline" onClick={() => { setEditingSupplement(null); setShowSupplementForm(true); }}>
                  <Plus className="h-4 w-4 ml-1" />
                  ملحق
                </Button>
                <div className="relative flex-1">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث: اسم، رقم سيارة، مبلغ..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pr-10"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortAsc(!sortAsc)}
                  className="gap-2"
                >
                  <ArrowUpDown className="h-4 w-4" />
                  {sortAsc ? 'من الأقدم للأحدث' : 'من الأحدث للأقدم'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
             <div className="rounded-lg border max-h-[70vh] overflow-y-auto overflow-x-scroll scrollbar-always-visible-grey">
              <Table>
                <TableHeader>
                    <TableRow>
                     <TableHead className="text-right">العميل</TableHead>
                     <TableHead className="text-right">السيارة</TableHead>
                     <TableHead className="text-right">الشركة المصنعة</TableHead>
                     <TableHead className="text-right">تصنيف السيارة</TableHead>
                     <TableHead className="text-right">نوع التأمين</TableHead>
                     <TableHead className="text-right">الشركة</TableHead>
                     <TableHead className="text-right">قيمة السيارة</TableHead>
                     <TableHead className="text-right">تاريخ البداية</TableHead>
                     <TableHead className="text-right">تاريخ النهاية</TableHead>
                     <TableHead className="text-right">تاريخ الإصدار</TableHead>
                     <TableHead className="text-right">سعر التأمين</TableHead>
                     <TableHead className="text-right">المستحق للشركة</TableHead>
                     <TableHead className="text-right">الربح</TableHead>
                     <TableHead className="text-right print:hidden sticky left-0 bg-background z-10">إجراءات</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 15 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : filteredPolicies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={15} className="text-center py-8 text-muted-foreground">
                        لا توجد معاملات للفترة المحددة
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredPolicies.map((policy) => {
                      const isEditing = editingPolicyId === policy.id;
                      return (
                        <TableRow 
                          key={policy.id}
                          className={cn(
                            "transition-colors",
                            policy.cancelled && "opacity-50 bg-muted/30",
                            policy.transferred && "opacity-50 bg-amber-500/5"
                          )}
                        >
                          {/* Client Name */}
                          <TableCell className="font-medium">
                            {isEditing ? (
                              <div>
                                <Input
                                  value={editValues.client_name}
                                  onChange={(e) => setEditValues(v => ({ ...v, client_name: e.target.value }))}
                                  className="w-28 h-8 text-sm"
                                />
                                {policy.cancelled && (
                                  <Badge variant="destructive" className="mr-2 mt-1 text-xs">ملغية</Badge>
                                )}
                              </div>
                            ) : (
                              <>
                                <span 
                                  className="text-primary cursor-pointer hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (policy.client?.id) navigate(`/clients?clientId=${policy.client.id}`);
                                  }}
                                >
                                  {policy.client?.full_name || '-'}
                                </span>
                                {policy.cancelled && (
                                  <Badge variant="destructive" className="mr-2 text-xs">ملغية</Badge>
                                )}
                                {policy.transferred && (
                                  <Badge variant="warning" className="mr-2 text-xs gap-1">
                                    محولة ← {policy.transferred_to_car_number || ''}
                                  </Badge>
                                )}
                              </>
                            )}
                          </TableCell>
                          {/* Car Number - not editable */}
                          <TableCell className="font-mono">
                            <bdi>{policy.car?.car_number || '-'}</bdi>
                          </TableCell>
                          {/* Manufacturer - not editable */}
                          <TableCell>
                            {policy.car?.manufacturer_name || '-'}
                          </TableCell>
                          {/* Car Type */}
                          <TableCell>
                            {isEditing ? (
                              <Select value={editValues.car_type} onValueChange={(v) => setEditValues(ev => ({ ...ev, car_type: v }))}>
                                <SelectTrigger className="w-24 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries({ car: 'خصوصي', cargo: 'شحن', small: 'اوتوبس زعير', taxi: 'تاكسي', tjeradown4: 'تجاري < 4 طن', tjeraup4: 'تجاري > 4 طن' }).map(([val, label]) => (
                                    <SelectItem key={val} value={val}>{label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              getCarTypeLabel(policy.car?.car_type || null)
                            )}
                          </TableCell>
                          {/* Insurance Type */}
                          <TableCell>
                            {isEditing ? (
                              <div className="flex flex-col gap-1">
                                <Select value={editValues.policy_type_parent} onValueChange={(v) => setEditValues(ev => ({ ...ev, policy_type_parent: v, policy_type_child: v === 'THIRD_FULL' ? (ev.policy_type_child || 'THIRD') : null }))}>
                                  <SelectTrigger className="w-24 h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(POLICY_TYPE_LABELS).map(([val, label]) => (
                                      <SelectItem key={val} value={val}>{label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {editValues.policy_type_parent === 'THIRD_FULL' && (
                                  <Select value={editValues.policy_type_child || 'THIRD'} onValueChange={(v) => setEditValues(ev => ({ ...ev, policy_type_child: v }))}>
                                    <SelectTrigger className="w-24 h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Object.entries(POLICY_CHILD_LABELS).map(([val, label]) => (
                                        <SelectItem key={val} value={val}>{label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>
                            ) : (
                              <Badge variant="outline" className={getInsuranceTypeBadgeClass(policy.policy_type_parent)}>
                                {getInsuranceTypeLabelLocal(policy)}
                              </Badge>
                            )}
                          </TableCell>
                          {/* Company */}
                          <TableCell>
                            {isEditing ? (
                              <Select value={editValues.company_id || ''} onValueChange={(v) => setEditValues(ev => ({ ...ev, company_id: v }))}>
                                <SelectTrigger className="w-28 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {allCompanies.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>{c.name_ar || c.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-xs">{company?.name_ar || company?.name || '-'}</span>
                            )}
                          </TableCell>
                          {/* Car Value */}
                          <TableCell className="font-mono">
                            {isEditing ? (
                              <Input
                                type="number"
                                value={editValues.car_value}
                                onChange={(e) => setEditValues(v => ({ ...v, car_value: Number(e.target.value) }))}
                                className="w-24 h-8 text-sm"
                              />
                            ) : (
                              policy.car?.car_value ? `₪${policy.car.car_value.toLocaleString('en-US')}` : '-'
                            )}
                          </TableCell>
                          {/* Start Date */}
                          <TableCell>
                            {isEditing ? (
                              <ArabicDatePicker value={editValues.start_date} onChange={(d) => setEditValues(v => ({ ...v, start_date: d }))} compact />
                            ) : (
                              formatDate(policy.start_date)
                            )}
                          </TableCell>
                          {/* End Date */}
                          <TableCell>
                            {isEditing ? (
                              <ArabicDatePicker value={editValues.end_date} onChange={(d) => setEditValues(v => ({ ...v, end_date: d }))} compact />
                            ) : (
                              formatDate(policy.end_date)
                            )}
                          </TableCell>
                          {/* Issue Date */}
                          <TableCell className={cn(!isEditing && policy.issue_date && policy.issue_date !== policy.start_date && "text-primary font-medium")}>
                            {isEditing ? (
                              <ArabicDatePicker value={editValues.issue_date || ''} onChange={(d) => setEditValues(v => ({ ...v, issue_date: d || null }))} compact />
                            ) : (
                              policy.issue_date ? formatDate(policy.issue_date) : formatDate(policy.start_date)
                            )}
                          </TableCell>
                          
                          {/* Insurance Price */}
                          <TableCell className="font-mono">
                            {isEditing ? (
                              <Input
                                type="number"
                                value={editValues.insurance_price}
                                onChange={(e) => setEditValues(v => ({ ...v, insurance_price: Number(e.target.value) }))}
                                className="w-24 h-8 text-sm"
                              />
                            ) : (
                              `₪${Number(policy.insurance_price).toLocaleString('en-US')}`
                            )}
                          </TableCell>
                          
                          {/* Company Payment */}
                          <TableCell className={cn("font-mono", !isEditing && (policy.transferred ? "text-muted-foreground" : "text-destructive"))}>
                            {isEditing ? (
                              <Input
                                type="number"
                                value={editValues.payed_for_company}
                                onChange={(e) => setEditValues(v => ({ ...v, payed_for_company: Number(e.target.value) }))}
                                className="w-24 h-8 text-sm"
                              />
                            ) : policy.transferred ? (
                              <span className="line-through">₪0</span>
                            ) : (
                              `₪${Number(policy.payed_for_company || 0).toLocaleString('en-US')}`
                            )}
                          </TableCell>
                          
                          {/* Profit */}
                          <TableCell className={cn("font-mono", !isEditing && (policy.transferred ? "text-muted-foreground" : "text-success"))}>
                            {isEditing ? (
                              <Input
                                type="number"
                                value={editValues.profit}
                                onChange={(e) => setEditValues(v => ({ ...v, profit: Number(e.target.value) }))}
                                className="w-24 h-8 text-sm"
                              />
                            ) : policy.transferred ? (
                              <span className="line-through">₪0</span>
                            ) : (
                              `₪${Number(policy.profit || 0).toLocaleString('en-US')}`
                            )}
                          </TableCell>
                          
                          {/* Actions */}
                          <TableCell className="print:hidden sticky left-0 bg-background z-10">
                            <div className="flex items-center gap-1">
                              {isEditing ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleSaveEdit}
                                    disabled={savingEdit}
                                    title="حفظ"
                                    className="text-success"
                                  >
                                    {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCancelEdit}
                                    title="إلغاء"
                                    className="text-destructive"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleViewPolicy(policy.id)}
                                    title="عرض التفاصيل"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleStartEdit(policy)}
                                    title="تعديل المبالغ"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleExplainCalculation(policy)}
                                    title="شرح الحسبة"
                                  >
                                    <Calculator className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                  {/* Supplement Rows - Rich ones look like policy rows */}
                   {supplements.filter(s => {
                     if (!searchQuery.trim()) return true;
                     const q = searchQuery.toLowerCase();
                     return (s.description || '').toLowerCase().includes(q) 
                       || (s.customer_name || '').toLowerCase().includes(q)
                       || (s.car_number || '').toLowerCase().includes(q)
                       || String(s.company_payment).includes(q)
                       || String(s.insurance_price).includes(q);
                   }).map((s) => {
                    const isRich = !!(s.customer_name || s.car_number);
                    return (
                    <TableRow key={`supp-${s.id}`} className={cn("border-amber-200", s.is_cancelled && "opacity-50 bg-muted/30", !s.is_cancelled && "bg-amber-50/50")}>
                      <TableCell className="font-medium">
                        {isRich ? (
                          <span>{s.customer_name || '-'}</span>
                        ) : (
                          <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">ملحق</Badge>
                        )}
                        {isRich && (
                          <Badge variant="outline" className="mr-2 text-xs bg-amber-100 text-amber-800 border-amber-300">يدوي</Badge>
                        )}
                        {s.is_cancelled && (
                          <Badge variant="destructive" className="mr-2 text-xs">ملغية</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono">
                        {isRich ? <bdi>{s.car_number || '-'}</bdi> : '-'}
                      </TableCell>
                      <TableCell>{isRich ? '-' : ''}</TableCell>
                      <TableCell>{isRich ? '-' : ''}</TableCell>
                      <TableCell>
                        {s.policy_type ? (
                          <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">{s.policy_type}</Badge>
                        ) : isRich ? '-' : (
                          <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">ملحق</Badge>
                        )}
                      </TableCell>
                      <TableCell><span className="text-xs">{company?.name_ar || company?.name || '-'}</span></TableCell>
                      <TableCell className="font-mono">
                        {s.car_value ? `₪${Number(s.car_value).toLocaleString('en-US')}` : '-'}
                      </TableCell>
                      <TableCell>{s.start_date ? formatDate(s.start_date) : formatDate(s.settlement_date)}</TableCell>
                      <TableCell>{s.end_date ? formatDate(s.end_date) : '-'}</TableCell>
                      <TableCell>{s.end_date ? formatDate(s.end_date) : '-'}</TableCell>
                      <TableCell className="font-mono">₪{Number(s.insurance_price).toLocaleString('en-US')}</TableCell>
                      <TableCell className="font-mono text-destructive">₪{Number(s.company_payment).toLocaleString('en-US')}</TableCell>
                      <TableCell className="font-mono text-success">₪{Number(s.profit).toLocaleString('en-US')}</TableCell>
                      <TableCell className="print:hidden">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleDuplicateSupplement(s)} title="نسخ"><Copy className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => handleEditSupplement(s)} title="تعديل"><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteSupplement(s.id)} title="حذف"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Company Cheques Section */}
        <Card className="print:hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                شيكات محولة لهذه الشركة ({companyCheques.length})
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/reports/company-settlement/${companyId}/wallet`)}
                className="gap-2"
              >
                <Wallet className="h-4 w-4" />
                عرض محفظة الشركة
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingCheques ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : companyCheques.length === 0 ? (
              <p className="text-center py-6 text-muted-foreground">لا توجد شيكات محولة لهذه الشركة</p>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">رقم الشيك</TableHead>
                      <TableHead className="text-right">المبلغ</TableHead>
                      <TableHead className="text-right">تاريخ الاستحقاق</TableHead>
                      <TableHead className="text-right">العميل</TableHead>
                      <TableHead className="text-right">السيارة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {companyCheques.map((cheque) => (
                      <TableRow key={cheque.id}>
                        <TableCell className="font-mono">{cheque.cheque_number || '-'}</TableCell>
                        <TableCell className="font-mono">₪{cheque.amount.toLocaleString('en-US')}</TableCell>
                        <TableCell>{formatDate(cheque.payment_date)}</TableCell>
                        <TableCell>{cheque.client_name || '-'}</TableCell>
                        <TableCell className="font-mono"><bdi>{cheque.car_number || '-'}</bdi></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Calculation Explanation Modal */}
      <CalculationExplanationModal
        open={calculationModalOpen}
        onOpenChange={setCalculationModalOpen}
        policy={selectedPolicyForCalc}
        company={company}
      />

      {/* Policy Details Drawer */}
      <PolicyDetailsDrawer
        open={detailsDrawerOpen}
        onOpenChange={setDetailsDrawerOpen}
        policyId={selectedPolicyId}
        onUpdated={handlePolicyUpdated}
        onViewRelatedPolicy={(newPolicyId) => {
          setSelectedPolicyId(newPolicyId);
        }}
      />

      {/* Recalculate Profits Confirmation */}
      <AlertDialog open={showRecalcConfirm} onOpenChange={setShowRecalcConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إعادة احتساب الأرباح</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إعادة احتساب الأرباح لـ {filteredPolicies.filter(p => !p.cancelled && !p.transferred).length} معاملة حسب قواعد التسعير الحالية.
              هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecalculateProfits}>
              <RefreshCw className="h-4 w-4 ml-2" />
              إعادة احتساب
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Supplement Form Dialog */}
      <SupplementFormDialog
        open={showSupplementForm}
        onOpenChange={setShowSupplementForm}
        editingSupplement={editingSupplement}
        companyId={companyId || ''}
        onSaved={handleSupplementSaved}
      />

      {/* Company Change Warning */}
      <AlertDialog open={showCompanyChangeWarning} onOpenChange={setShowCompanyChangeWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تغيير الشركة</AlertDialogTitle>
            <AlertDialogDescription>
              أنت تقوم بنقل هذه البوليصة لشركة أخرى. ستختفي البوليصة من هذا التقرير بعد الحفظ.
              هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={executeSaveEdit}>
              نعم، نقل الشركة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
