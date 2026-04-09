import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users, Car, TrendingUp, CreditCard, Building2, FileText, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfitSummary } from "@/hooks/useProfitSummary";
import { useAuth } from "@/hooks/useAuth";
import { ExpiringPolicies } from "@/components/dashboard/ExpiringPolicies";
import { RecentActivity } from "@/components/dashboard/RecentActivity";

interface CompanyProduction {
  company_id: string;
  company_name: string;
  third_count: number;
  third_amount: number;
  full_count: number;
  full_amount: number;
  total_count: number;
  total_amount: number;
}

interface CompanyDebt {
  company_id: string;
  company_name: string;
  outstanding: number;
}

// Generate month options for selectors
function getMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('ar', { year: 'numeric', month: 'long' });
    options.push({ value, label });
  }
  return options;
}

function getMonthRange(monthStr: string) {
  const [year, month] = monthStr.split('-').map(Number);
  const start = new Date(year, month - 1, 1).toISOString().split('T')[0];
  const end = new Date(year, month, 0).toISOString().split('T')[0];
  return { start, end };
}

const profitPeriodOptions = [
  { value: 'today', label: 'اليوم' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'year', label: 'هذه السنة' },
];

export default function Dashboard() {
  const { isAdmin, profile } = useAuth();
  const { summary: profitSummary, loading: profitLoading, refetch: refetchProfit } = useProfitSummary();
  
  // Stats
  const [totalClients, setTotalClients] = useState(0);
  const [insuredCars, setInsuredCars] = useState(0);
  const [clientDebt, setClientDebt] = useState(0);
  const [companyDebt, setCompanyDebt] = useState(0);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const monthOptions = getMonthOptions();
  const currentMonth = monthOptions[0].value;
  const [carsMonth, setCarsMonth] = useState(currentMonth);
  const [profitPeriod, setProfitPeriod] = useState('today');
  const [productionMonth, setProductionMonth] = useState(currentMonth);
  
  // Production data
  const [production, setProduction] = useState<CompanyProduction[]>([]);
  const [productionLoading, setProductionLoading] = useState(true);
  
  // Company debts data
  const [companyDebts, setCompanyDebts] = useState<CompanyDebt[]>([]);
  const [companyDebtsLoading, setCompanyDebtsLoading] = useState(true);

  // Fetch basic stats
  useEffect(() => {
    const fetchBasicStats = async () => {
      setLoading(true);
      try {
        const { count } = await supabase
          .from('clients')
          .select('*', { count: 'exact', head: true })
          .is('deleted_at', null);
        setTotalClients(count || 0);
        
        // Client debt
        const { data: debtData } = await supabase.rpc('dashboard_total_client_debt');
        setClientDebt(Number(debtData) || 0);
      } catch (e) {
        console.error('Error fetching stats:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchBasicStats();
  }, []);

  // Fetch insured cars based on selected month
  useEffect(() => {
    const fetchCars = async () => {
      const { start, end } = getMonthRange(carsMonth);
      const { data } = await supabase.rpc('dashboard_insured_cars_count', {
        p_start_date: start,
        p_end_date: end,
      });
      setInsuredCars(Number(data) || 0);
    };
    fetchCars();
  }, [carsMonth]);

  // Fetch production data based on selected month
  const fetchProduction = useCallback(async () => {
    setProductionLoading(true);
    try {
      const { start, end } = getMonthRange(productionMonth);
      const { data, error } = await supabase.rpc('dashboard_company_production', {
        p_start_date: start,
        p_end_date: end,
      });
      if (error) throw error;
      setProduction((data as CompanyProduction[]) || []);
    } catch (e) {
      console.error('Error fetching production:', e);
    } finally {
      setProductionLoading(false);
    }
  }, [productionMonth]);

  useEffect(() => {
    fetchProduction();
  }, [fetchProduction]);

  // Fetch company debts
  const fetchCompanyDebts = useCallback(async () => {
    setCompanyDebtsLoading(true);
    try {
      const { data, error } = await supabase.rpc('dashboard_company_debts');
      if (error) throw error;
      setCompanyDebts((data as CompanyDebt[]) || []);
    } catch (e) {
      console.error('Error fetching company debts:', e);
    } finally {
      setCompanyDebtsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanyDebts();
  }, [fetchCompanyDebts]);

  // Get profit value based on selected period
  const getProfitValue = () => {
    if (profitLoading) return '...';
    switch (profitPeriod) {
      case 'today': return profitSummary.todayProfit;
      case 'month': return profitSummary.monthProfit;
      case 'year': return profitSummary.yearProfit;
      default: return profitSummary.todayProfit;
    }
  };

  const getProfitLabel = () => {
    switch (profitPeriod) {
      case 'today': return 'أرباح اليوم';
      case 'month': return 'أرباح الشهر';
      case 'year': return 'أرباح السنة';
      default: return 'أرباح اليوم';
    }
  };

  // Production totals
  const productionTotals = production.reduce(
    (acc, row) => ({
      third_count: acc.third_count + Number(row.third_count),
      third_amount: acc.third_amount + Number(row.third_amount),
      full_count: acc.full_count + Number(row.full_count),
      full_amount: acc.full_amount + Number(row.full_amount),
      total_count: acc.total_count + Number(row.total_count),
      total_amount: acc.total_amount + Number(row.total_amount),
    }),
    { third_count: 0, third_amount: 0, full_count: 0, full_amount: 0, total_count: 0, total_amount: 0 }
  );

  // Company debts total
  const companyDebtsTotal = companyDebts.reduce((sum, d) => sum + Number(d.outstanding), 0);

  const handlePolicyComplete = () => {
    refetchProfit();
    fetchProduction();
    fetchCompanyDebts();
  };

  return (
    <MainLayout onPolicyComplete={handlePolicyComplete}>
      <Header
        title="لوحة التحكم"
        subtitle={`مرحباً بك، ${profile?.full_name || 'مستخدم'}`}
      />

      <div className="p-6 space-y-6" dir="rtl">
        {/* Row 1: Main stat cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* 1. Total Clients */}
          <Card className="p-6 border shadow-sm hover:shadow-md transition-shadow bg-primary/5 border-primary/20">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">إجمالي العملاء</p>
                <p className="text-2xl font-bold text-foreground">
                  {loading ? '...' : totalClients.toLocaleString('en-US')}
                </p>
              </div>
              <div className="rounded-xl bg-primary/10 p-3">
                <Users className="h-6 w-6 text-primary" />
              </div>
            </div>
          </Card>

          {/* 2. Insured Cars (with month filter) */}
          <Card className="p-6 border shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-muted-foreground">السيارات المؤمنة</p>
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {insuredCars.toLocaleString('en-US')}
                </p>
                <Select value={carsMonth} onValueChange={setCarsMonth}>
                  <SelectTrigger className="h-7 text-xs w-fit min-w-[120px]">
                    <Calendar className="h-3 w-3 ml-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-xl bg-secondary p-3">
                <Car className="h-6 w-6 text-muted-foreground" />
              </div>
            </div>
          </Card>

          {/* 3. Profits (with period filter) */}
          <Card className="p-6 border shadow-sm hover:shadow-md transition-shadow bg-success/5 border-success/20">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">{getProfitLabel()}</p>
                <p className="text-2xl font-bold text-success ltr-nums">
                  {profitLoading ? '...' : `₪${getProfitValue().toLocaleString('en-US')}`}
                </p>
                <Select value={profitPeriod} onValueChange={setProfitPeriod}>
                  <SelectTrigger className="h-7 text-xs w-fit min-w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {profitPeriodOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-xl bg-success/10 p-3">
                <TrendingUp className="h-6 w-6 text-success" />
              </div>
            </div>
          </Card>

          {/* 4. Client Debts */}
          <Card className="p-6 border shadow-sm hover:shadow-md transition-shadow bg-destructive/5 border-destructive/20">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">ديون العملاء</p>
                <p className="text-2xl font-bold text-destructive ltr-nums">
                  {loading ? '...' : `₪${clientDebt.toLocaleString('en-US')}`}
                </p>
                <p className="text-xs text-muted-foreground">إجمالي المبالغ المتبقية</p>
              </div>
              <div className="rounded-xl bg-destructive/10 p-3">
                <CreditCard className="h-6 w-6 text-destructive" />
              </div>
            </div>
          </Card>
        </div>

        {/* Row 2: Production summary + Company debt total */}
        {isAdmin && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Production summary card */}
            <Card className="p-6 border shadow-sm hover:shadow-md transition-shadow bg-primary/5 border-primary/20">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">إجمالي الإنتاج</p>
                  <p className="text-2xl font-bold text-primary ltr-nums">
                    {productionLoading ? '...' : `${productionTotals.total_count} وثيقة`}
                  </p>
                  <p className="text-sm text-muted-foreground ltr-nums">
                    {productionLoading ? '' : `₪${productionTotals.total_amount.toLocaleString('en-US')}`}
                  </p>
                </div>
                <div className="rounded-xl bg-primary/10 p-3">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
              </div>
            </Card>

            {/* Company debt total card */}
            <Card className="p-6 border shadow-sm hover:shadow-md transition-shadow bg-destructive/5 border-destructive/20">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">الدين لدى شركات التأمين</p>
                  <p className="text-2xl font-bold text-destructive ltr-nums">
                    {companyDebtsLoading ? '...' : `₪${companyDebtsTotal.toLocaleString('en-US')}`}
                  </p>
                  <p className="text-xs text-muted-foreground">المبالغ المستحقة لشركات التأمين</p>
                </div>
                <div className="rounded-xl bg-destructive/10 p-3">
                  <Building2 className="h-6 w-6 text-destructive" />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Row 3: Company Production Table */}
        {isAdmin && (
          <Card className="border shadow-sm">
            <div className="p-4 flex items-center justify-between border-b">
              <div>
                <h3 className="text-lg font-bold">الإنتاج في شركات التأمين</h3>
                <p className="text-sm text-muted-foreground">تفصيل ثالث / شامل لكل شركة</p>
              </div>
              <Select value={productionMonth} onValueChange={setProductionMonth}>
                <SelectTrigger className="w-[180px]">
                  <Calendar className="h-4 w-4 ml-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الشركة</TableHead>
                  <TableHead className="text-center">ثالث (عدد)</TableHead>
                  <TableHead className="text-center">ثالث (مبلغ)</TableHead>
                  <TableHead className="text-center">شامل (عدد)</TableHead>
                  <TableHead className="text-center">شامل (مبلغ)</TableHead>
                  <TableHead className="text-center">المجموع (عدد)</TableHead>
                  <TableHead className="text-center">المجموع (مبلغ)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productionLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : production.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      لا يوجد إنتاج في هذه الفترة
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {production.map((row) => (
                      <TableRow key={row.company_id}>
                        <TableCell className="font-medium">{row.company_name}</TableCell>
                        <TableCell className="text-center">{Number(row.third_count)}</TableCell>
                        <TableCell className="text-center ltr-nums">₪{Number(row.third_amount).toLocaleString('en-US')}</TableCell>
                        <TableCell className="text-center">{Number(row.full_count)}</TableCell>
                        <TableCell className="text-center ltr-nums">₪{Number(row.full_amount).toLocaleString('en-US')}</TableCell>
                        <TableCell className="text-center font-bold">{Number(row.total_count)}</TableCell>
                        <TableCell className="text-center font-bold ltr-nums">₪{Number(row.total_amount).toLocaleString('en-US')}</TableCell>
                      </TableRow>
                    ))}
                    {/* Totals row */}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell>المجموع الكلي</TableCell>
                      <TableCell className="text-center">{productionTotals.third_count}</TableCell>
                      <TableCell className="text-center ltr-nums">₪{productionTotals.third_amount.toLocaleString('en-US')}</TableCell>
                      <TableCell className="text-center">{productionTotals.full_count}</TableCell>
                      <TableCell className="text-center ltr-nums">₪{productionTotals.full_amount.toLocaleString('en-US')}</TableCell>
                      <TableCell className="text-center">{productionTotals.total_count}</TableCell>
                      <TableCell className="text-center ltr-nums">₪{productionTotals.total_amount.toLocaleString('en-US')}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Row 4: Company Debts Table */}
        {isAdmin && (
          <Card className="border shadow-sm">
            <div className="p-4 flex items-center justify-between border-b">
              <div>
                <h3 className="text-lg font-bold">ديون شركات التأمين</h3>
                <p className="text-sm text-muted-foreground">المبالغ المستحقة لكل شركة</p>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الشركة</TableHead>
                  <TableHead className="text-left">المبلغ المستحق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companyDebtsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : companyDebts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                      لا توجد ديون مستحقة
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {companyDebts.map((row) => (
                      <TableRow key={row.company_id}>
                        <TableCell className="font-medium">{row.company_name}</TableCell>
                        <TableCell className="text-left ltr-nums">₪{Number(row.outstanding).toLocaleString('en-US')}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell>المجموع الكلي</TableCell>
                      <TableCell className="text-left ltr-nums">₪{companyDebtsTotal.toLocaleString('en-US')}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </Card>
        )}

        {/* Row 5: Expiring Policies + Recent Activity */}
        {isAdmin && (
          <div className="grid gap-4 md:grid-cols-2">
            <ExpiringPolicies />
            <RecentActivity />
          </div>
        )}
      </div>
    </MainLayout>
  );
}
