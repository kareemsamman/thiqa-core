import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { Building2, Download, Wallet, FileText, ChevronLeft, Calendar, RotateCcw, AlertCircle, Printer, AlertTriangle, Eye, Pencil, Search, Receipt, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { POLICY_TYPE_LABELS, getInsuranceTypeBadgeClass, POLICY_CHILD_LABELS } from '@/lib/insuranceTypes';
import { PolicyDetailsDrawer } from '@/components/policies/PolicyDetailsDrawer';
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter';
import type { Tables, Enums } from '@/integrations/supabase/types';

type Broker = Tables<'brokers'>;

interface CompanySettlementData {
  company_id: string;
  company_name: string;
  company_name_ar: string | null;
  policy_count: number;
  total_insurance_price: number;
  total_company_payment: number;
}

interface CompanyOption {
  company_id: string;
  company_name: string;
  company_name_ar: string | null;
}

interface PolicyWithoutCompany {
  id: string;
  policy_type_parent: Enums<'policy_type_parent'>;
  policy_type_child: Enums<'policy_type_child'> | null;
  insurance_price: number;
  start_date: string;
  cancelled: boolean | null;
  client_name: string | null;
  car_number: string | null;
}

export default function CompanySettlement() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CompanySettlementData[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [filteredCompanies, setFilteredCompanies] = useState<CompanyOption[]>([]);
  
  // Policies without company
  const [policiesWithoutCompany, setPoliciesWithoutCompany] = useState<PolicyWithoutCompany[]>([]);
  const [loadingNoCompany, setLoadingNoCompany] = useState(false);
  const [activeTab, setActiveTab] = useState('with-company');
  
  // Policy details drawer
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  
  // Tax invoice
  const [profitPercent, setProfitPercent] = useState(10);
  const [generatingTaxInvoice, setGeneratingTaxInvoice] = useState(false);
  const [showTaxInvoicePopover, setShowTaxInvoicePopover] = useState(false);
  
  // Filters - default to all time
  const [showAllTime, setShowAllTime] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedBrokers, setSelectedBrokers] = useState<string[]>([]);
  const [includeCancelled, setIncludeCancelled] = useState(false);

  // Summary totals
  const [summary, setSummary] = useState({
    totalPolicies: 0,
    totalInsurancePrice: 0,
    totalCompanyPayment: 0,
  });

  useEffect(() => {
    fetchBrokers();
    fetchPoliciesWithoutCompany();
  }, []);

  useEffect(() => {
    fetchFilteredCompanies();
  }, [selectedMonth, selectedCategories, selectedBrokers, showAllTime]);

  useEffect(() => {
    fetchSettlementData();
  }, [selectedMonth, selectedCompanies, selectedCategories, selectedBrokers, includeCancelled, showAllTime]);

  const fetchBrokers = async () => {
    try {
      const { data: brokersData, error } = await supabase
        .from('brokers')
        .select('*')
        .order('name');

      if (error) throw error;
      setBrokers(brokersData || []);
    } catch (error) {
      console.error('Error fetching brokers:', error);
    }
  };

  const fetchPoliciesWithoutCompany = async () => {
    setLoadingNoCompany(true);
    try {
      const { data: policies, error } = await supabase
        .from('policies')
        .select(`
          id,
          policy_type_parent,
          policy_type_child,
          insurance_price,
          start_date,
          cancelled,
          clients (full_name),
          cars (car_number)
        `)
        .is('company_id', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      const mapped: PolicyWithoutCompany[] = (policies || []).map((p: any) => ({
        id: p.id,
        policy_type_parent: p.policy_type_parent,
        policy_type_child: p.policy_type_child,
        insurance_price: p.insurance_price,
        start_date: p.start_date,
        cancelled: p.cancelled,
        client_name: p.clients?.full_name || null,
        car_number: p.cars?.car_number || null,
      }));

      setPoliciesWithoutCompany(mapped);
    } catch (error) {
      console.error('Error fetching policies without company:', error);
    } finally {
      setLoadingNoCompany(false);
    }
  };

  // Get date range based on current filter mode
  const getDateRange = () => {
    if (showAllTime) {
      return { startDate: null, endDate: null };
    }
    const [year, month] = selectedMonth.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];
    return { startDate, endDate };
  };

  // Fetch companies that have policies matching current filters (using RPC)
  const fetchFilteredCompanies = async () => {
    try {
      const { startDate, endDate } = getDateRange();

      const { data: companies, error } = await supabase.rpc('report_company_settlement_company_options', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_policy_type_parent: null,
        p_broker_id: null,
        p_policy_types: selectedCategories.length > 0 ? selectedCategories : null,
        p_broker_ids: selectedBrokers.length > 0 ? selectedBrokers : null,
      });

      if (error) throw error;

      const options: CompanyOption[] = (companies || []).map((c: any) => ({
        company_id: c.company_id,
        company_name: c.company_name,
        company_name_ar: c.company_name_ar,
      }));

      setFilteredCompanies(options);

      // Clear selected companies if they're no longer valid
      if (selectedCompanies.length > 0) {
        const validIds = new Set(options.map(c => c.company_id));
        const stillValid = selectedCompanies.filter(id => validIds.has(id));
        if (stillValid.length !== selectedCompanies.length) {
          setSelectedCompanies(stillValid);
        }
      }
    } catch (error) {
      console.error('Error fetching filtered companies:', error);
      setFilteredCompanies([]);
    }
  };

  const fetchSettlementData = async () => {
    setLoading(true);
    try {
      const { startDate, endDate } = getDateRange();

      const { data: result, error } = await supabase.rpc('report_company_settlement', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_company_id: null,
        p_policy_type_parent: null,
        p_broker_id: null,
        p_include_cancelled: includeCancelled,
        p_company_ids: selectedCompanies.length > 0 ? selectedCompanies : null,
        p_policy_types: selectedCategories.length > 0 ? selectedCategories : null,
        p_broker_ids: selectedBrokers.length > 0 ? selectedBrokers : null,
      });

      if (error) throw error;

      const mapped: CompanySettlementData[] = (result || []).map((r: any) => ({
        company_id: r.company_id,
        company_name: r.company_name,
        company_name_ar: r.company_name_ar,
        policy_count: Number(r.policy_count),
        total_insurance_price: Number(r.total_insurance_price),
        total_company_payment: Number(r.total_company_payment),
      }));

      setData(mapped);

      // Calculate summary
      const totals = mapped.reduce(
        (acc, item) => ({
          totalPolicies: acc.totalPolicies + item.policy_count,
          totalInsurancePrice: acc.totalInsurancePrice + item.total_insurance_price,
          totalCompanyPayment: acc.totalCompanyPayment + item.total_company_payment,
        }),
        { totalPolicies: 0, totalInsurancePrice: 0, totalCompanyPayment: 0 }
      );

      setSummary(totals);
    } catch (error) {
      console.error('Error fetching settlement data:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في جلب بيانات التسوية',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetFilters = () => {
    const now = new Date();
    setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    setSelectedCompanies([]);
    setSelectedCategories([]);
    setSelectedBrokers([]);
    setIncludeCancelled(false);
    setShowAllTime(true);
  };

  const exportToCSV = () => {
    const headers = ['الشركة', 'عدد المعاملات', 'إجمالي المحصل', 'المستحق للشركة'];
    const rows = data.map(item => [
      item.company_name_ar || item.company_name,
      item.policy_count,
      item.total_insurance_price,
      item.total_company_payment,
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `company-settlement-${showAllTime ? 'all-time' : selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB');
  };

  const getInsuranceTypeLabelLocal = (policy: PolicyWithoutCompany) => {
    if (policy.policy_type_parent === 'THIRD_FULL' && policy.policy_type_child) {
      return POLICY_CHILD_LABELS[policy.policy_type_child] || policy.policy_type_child;
    }
    return POLICY_TYPE_LABELS[policy.policy_type_parent];
  };

  const handleViewPolicy = (policyId: string) => {
    setSelectedPolicyId(policyId);
    setDetailsDrawerOpen(true);
  };

  const handlePolicyUpdated = () => {
    fetchSettlementData();
    fetchPoliciesWithoutCompany();
  };

  const handleGenerateTaxInvoice = async () => {
    setGeneratingTaxInvoice(true);
    try {
      const { startDate, endDate } = getDateRange();
      const response = await supabase.functions.invoke('generate-tax-invoice', {
        body: {
          company_ids: selectedCompanies.length > 0 ? selectedCompanies : null,
          start_date: startDate,
          end_date: endDate,
          policy_types: selectedCategories.length > 0 ? selectedCategories : null,
          broker_ids: selectedBrokers.length > 0 ? selectedBrokers : null,
          include_cancelled: includeCancelled,
          profit_percent: profitPercent,
        },
      });
      if (response.error) throw response.error;
      const result = response.data;
      if (result?.url) {
        window.open(result.url, '_blank');
      } else if (typeof result === 'string') {
        const blob = new Blob([result], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
      setShowTaxInvoicePopover(false);
      toast({ title: 'تم إنشاء الفاتورة الضريبية بنجاح' });
    } catch (error: any) {
      console.error('Error generating tax invoice:', error);
      toast({ title: 'خطأ', description: error.message || 'فشل في إنشاء الفاتورة', variant: 'destructive' });
    } finally {
      setGeneratingTaxInvoice(false);
    }
  };

  // Format the current filter description
  const getFilterDescription = () => {
    const parts: string[] = [];
    
    if (showAllTime) {
      parts.push('كل الفترات');
    } else {
      const [year, month] = selectedMonth.split('-');
      const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      parts.push(`${monthNames[parseInt(month) - 1]} ${year}`);
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
        title="تقرير تسوية الشركات"
        subtitle="ملخص المبالغ المستحقة للشركات والأرباح"
      />

      <div className="p-6 space-y-6 print:p-0" dir="rtl">
        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="print:hidden">
          <TabsList>
            <TabsTrigger value="with-company" className="gap-2">
              <Building2 className="h-4 w-4" />
              المعاملات مع شركات ({summary.totalPolicies.toLocaleString('en-US')})
            </TabsTrigger>
            <TabsTrigger value="no-company" className="gap-2">
              <AlertTriangle className="h-4 w-4" />
              بدون شركة ({policiesWithoutCompany.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="with-company" className="space-y-6 mt-6">
            {/* Filter Status Banner */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">النتائج المعروضة:</span>
                <Badge variant="secondary">{getFilterDescription()}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleResetFilters}>
                  <RotateCcw className="h-4 w-4 ml-2" />
                  إعادة ضبط
                </Button>
              </div>
            </div>

            {/* Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4" dir="rtl">
                  <div className="space-y-2">
                    <Label>الشهر</Label>
                    <Input
                      type="month"
                      value={selectedMonth}
                      onChange={(e) => {
                        setSelectedMonth(e.target.value);
                        setShowAllTime(false);
                      }}
                      className="text-left"
                    />
                    {!showAllTime && (
                      <Button 
                        variant="link" 
                        size="sm" 
                        className="p-0 h-auto text-xs"
                        onClick={() => setShowAllTime(true)}
                      >
                        <Calendar className="h-3 w-3 ml-1" />
                        عرض كل الفترات
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>الوسيط</Label>
                    <MultiSelectFilter
                      options={brokers.map((b) => ({ value: b.id, label: b.name }))}
                      selected={selectedBrokers}
                      onChange={setSelectedBrokers}
                      placeholder="جميع الوسطاء"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>الشركة</Label>
                    <MultiSelectFilter
                      options={filteredCompanies.map((c) => ({
                        value: c.company_id,
                        label: c.company_name_ar || c.company_name,
                      }))}
                      selected={selectedCompanies}
                      onChange={setSelectedCompanies}
                      placeholder={`جميع الشركات (${filteredCompanies.length})`}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>نوع المعاملة</Label>
                    <MultiSelectFilter
                      options={Object.entries(POLICY_TYPE_LABELS).map(([value, label]) => ({
                        value,
                        label,
                      }))}
                      selected={selectedCategories}
                      onChange={setSelectedCategories}
                      placeholder="جميع الأنواع"
                    />
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
                  <Button variant="outline" onClick={exportToCSV}>
                    <Download className="h-4 w-4 ml-2" />
                    CSV
                  </Button>
                  <Popover open={showTaxInvoicePopover} onOpenChange={setShowTaxInvoicePopover}>
                    <PopoverTrigger asChild>
                      <Button variant="outline">
                        <Receipt className="h-4 w-4 ml-2" />
                        فاتورة ضريبية
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64">
                      <div className="space-y-3">
                        <h4 className="font-medium text-sm">فاتورة ضريبية</h4>
                        <div className="space-y-1">
                          <Label className="text-xs">نسبة المربح %</Label>
                          <Input
                            type="number"
                            value={profitPercent}
                            onChange={(e) => setProfitPercent(Number(e.target.value))}
                            min={0}
                            max={100}
                            className="h-8"
                          />
                        </div>
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={generatingTaxInvoice}
                          onClick={() => handleGenerateTaxInvoice()}
                        >
                          {generatingTaxInvoice ? (
                            <><Loader2 className="h-4 w-4 animate-spin ml-2" />جاري الإنشاء...</>
                          ) : (
                            'إنشاء فاتورة'
                          )}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button variant="ghost" onClick={() => setShowAllTime(true)} disabled={showAllTime}>
                    <RotateCcw className="h-4 w-4 ml-2" />
                    كل الفترات
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">عدد المعاملات</p>
                      <p className="text-2xl font-bold">{summary.totalPolicies.toLocaleString('en-US')}</p>
                    </div>
                    <div className="rounded-xl bg-primary/10 p-3">
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
                    <div className="rounded-xl bg-blue-500/10 p-3">
                      <Wallet className="h-6 w-6 text-blue-500" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">المستحق للشركات</p>
                      <p className="text-2xl font-bold text-destructive">₪{summary.totalCompanyPayment.toLocaleString('en-US')}</p>
                    </div>
                    <div className="rounded-xl bg-destructive/10 p-3">
                      <Building2 className="h-6 w-6 text-destructive" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Data Table */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <CardTitle>تفاصيل التسوية حسب الشركة</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="relative w-64">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="بحث باسم الشركة..."
                        value={companySearch}
                        onChange={(e) => setCompanySearch(e.target.value)}
                        className="pr-10"
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      />
                    </div>
                    <Button variant="default" size="sm" onClick={() => {/* search already reactive */}}>
                      <Search className="h-4 w-4 ml-1" />
                      بحث
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">الشركة</TableHead>
                          <TableHead className="text-right">عدد المعاملات</TableHead>
                          <TableHead className="text-right">إجمالي المحصل</TableHead>
                          <TableHead className="text-right">المستحق للشركة</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                          Array.from({ length: 5 }).map((_, i) => (
                             <TableRow key={i}>
                              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                             </TableRow>
                          ))
                      ) : data.length === 0 ? (
                        <TableRow>
                           <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                            لا توجد بيانات للفترة المحددة
                          </TableCell>
                        </TableRow>
                      ) : (() => {
                        const filtered = companySearch.trim()
                          ? data.filter(item => 
                              (item.company_name_ar || '').includes(companySearch) || 
                              item.company_name.toLowerCase().includes(companySearch.toLowerCase())
                            )
                          : data;
                        return filtered.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                              لا توجد نتائج للبحث
                            </TableCell>
                          </TableRow>
                        ) : filtered.map((item, index) => (
                          <TableRow 
                            key={index}
                            onClick={() => navigate(`/reports/company-settlement/${item.company_id}`)}
                            className={cn(
                              "cursor-pointer transition-colors",
                              "hover:bg-secondary/50"
                            )}
                          >
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                {item.company_name_ar || item.company_name}
                                <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                              </div>
                            </TableCell>
                            <TableCell>{item.policy_count.toLocaleString('en-US')}</TableCell>
                            <TableCell>₪{item.total_insurance_price.toLocaleString('en-US')}</TableCell>
                            <TableCell className="text-destructive font-medium">
                              ₪{item.total_company_payment.toLocaleString('en-US')}
                            </TableCell>
                           </TableRow>
                        ));
                      })()}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="no-company" className="space-y-6 mt-6">
            {/* Warning Banner */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <div>
                <p className="font-medium">معاملات بدون شركة تأمين</p>
                <p className="text-sm text-muted-foreground">
                  هذه المعاملات لم يتم تحديد شركة التأمين لها. يجب تحديث كل معاملة وإضافة الشركة المناسبة.
                </p>
              </div>
            </div>

            {/* No Company Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-warning" />
                  معاملات بدون شركة ({policiesWithoutCompany.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">العميل</TableHead>
                        <TableHead className="text-right">السيارة</TableHead>
                        <TableHead className="text-right">نوع التأمين</TableHead>
                        <TableHead className="text-right">تاريخ البداية</TableHead>
                        <TableHead className="text-right">السعر</TableHead>
                        <TableHead className="text-right">الحالة</TableHead>
                        <TableHead className="text-right">إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingNoCompany ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i}>
                            {Array.from({ length: 7 }).map((_, j) => (
                              <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : policiesWithoutCompany.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                            لا توجد معاملات بدون شركة 🎉
                          </TableCell>
                        </TableRow>
                      ) : (
                        policiesWithoutCompany.map((policy) => (
                          <TableRow key={policy.id}>
                            <TableCell className="font-medium">
                              {policy.client_name || '-'}
                            </TableCell>
                            <TableCell className="font-mono">
                              <bdi>{policy.car_number || '-'}</bdi>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getInsuranceTypeBadgeClass(policy.policy_type_parent)}>
                                {getInsuranceTypeLabelLocal(policy)}
                              </Badge>
                            </TableCell>
                            <TableCell>{formatDate(policy.start_date)}</TableCell>
                            <TableCell className="font-mono">
                              ₪{Number(policy.insurance_price).toLocaleString('en-US')}
                            </TableCell>
                            <TableCell>
                              {policy.cancelled ? (
                                <Badge variant="destructive">ملغية</Badge>
                              ) : (
                                <Badge variant="secondary">نشطة</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleViewPolicy(policy.id)}
                                  title="عرض وتعديل"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Print-only content */}
        <div className="hidden print:block">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold">تقرير تسوية الشركات</h1>
            <p className="text-muted-foreground">{getFilterDescription()}</p>
          </div>

          {/* Summary for print */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="border p-4 text-center">
              <p className="text-sm text-muted-foreground">عدد المعاملات</p>
              <p className="text-xl font-bold">{summary.totalPolicies.toLocaleString('en-US')}</p>
            </div>
            <div className="border p-4 text-center">
              <p className="text-sm text-muted-foreground">إجمالي المحصل</p>
              <p className="text-xl font-bold">₪{summary.totalInsurancePrice.toLocaleString('en-US')}</p>
            </div>
            <div className="border p-4 text-center">
              <p className="text-sm text-muted-foreground">المستحق للشركات</p>
              <p className="text-xl font-bold">₪{summary.totalCompanyPayment.toLocaleString('en-US')}</p>
            </div>
          </div>

          {/* Table for print */}
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border p-2 text-right bg-muted">الشركة</th>
                <th className="border p-2 text-right bg-muted">عدد المعاملات</th>
                <th className="border p-2 text-right bg-muted">إجمالي المحصل</th>
                <th className="border p-2 text-right bg-muted">المستحق للشركة</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item, index) => (
                <tr key={index}>
                  <td className="border p-2">{item.company_name_ar || item.company_name}</td>
                  <td className="border p-2">{item.policy_count.toLocaleString('en-US')}</td>
                  <td className="border p-2">₪{item.total_insurance_price.toLocaleString('en-US')}</td>
                  <td className="border p-2">₪{item.total_company_payment.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
    </MainLayout>
  );
}
