import { useState, useEffect, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Search, CreditCard, TrendingUp, Users, Calendar, Download } from "lucide-react";

export default function ThiqaPayments() {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");

  useEffect(() => {
    fetchPayments();
  }, []);

  const fetchPayments = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('agent_subscription_payments')
      .select('*, agents(name, name_ar, email, plan, subscription_status)')
      .order('payment_date', { ascending: false })
      .limit(500);
    
    if (data) setPayments(data);
    setLoading(false);
  };

  // Compute months for filter
  const months = useMemo(() => {
    const set = new Set<string>();
    payments.forEach(p => {
      const d = new Date(p.payment_date);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
    return Array.from(set).sort().reverse();
  }, [payments]);

  // Filtered payments
  const filtered = useMemo(() => {
    return payments.filter(p => {
      const agentName = p.agents?.name_ar || p.agents?.name || '';
      const agentEmail = p.agents?.email || '';
      const matchSearch = !search || 
        agentName.toLowerCase().includes(search.toLowerCase()) ||
        agentEmail.toLowerCase().includes(search.toLowerCase());
      const matchPlan = planFilter === 'all' || p.plan === planFilter;
      const matchMonth = monthFilter === 'all' || (() => {
        const d = new Date(p.payment_date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === monthFilter;
      })();
      return matchSearch && matchPlan && matchMonth;
    });
  }, [payments, search, planFilter, monthFilter]);

  // Stats
  const stats = useMemo(() => {
    const total = filtered.reduce((sum, p) => sum + (p.amount || 0), 0);
    const agents = new Set(filtered.map(p => p.agent_id)).size;
    const thisMonth = filtered.filter(p => {
      const d = new Date(p.payment_date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((sum, p) => sum + (p.amount || 0), 0);
    return { total, agents, thisMonth, count: filtered.length };
  }, [filtered]);

  const exportCsv = () => {
    const headers = ['الوكيل', 'الإيميل', 'المبلغ', 'الخطة', 'من تاريخ', 'إلى تاريخ', 'تاريخ الدفع', 'ملاحظات'];
    const rows = filtered.map(p => [
      p.agents?.name_ar || p.agents?.name || '',
      p.agents?.email || '',
      p.amount,
      p.plan,
      p.period_start ? format(new Date(p.period_start), 'dd/MM/yyyy') : '',
      p.period_end ? format(new Date(p.period_end), 'dd/MM/yyyy') : '',
      format(new Date(p.payment_date), 'dd/MM/yyyy'),
      p.notes || '',
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thiqa-payments-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  const monthLabel = (m: string) => {
    const [y, mo] = m.split('-');
    const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return `${months[parseInt(mo) - 1]} ${y}`;
  };

  return (
    <MainLayout>
      <div className="space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="h-6 w-6 text-primary" />
              سجل المدفوعات
            </h1>
            <p className="text-muted-foreground text-sm">جميع مدفوعات اشتراكات الوكلاء في منصة ثقة</p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2 self-start">
            <Download className="h-4 w-4" />
            تصدير CSV
          </Button>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-0 shadow-sm bg-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <CreditCard className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">إجمالي المدفوعات</p>
                  <p className="text-lg font-bold">₪{stats.total.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">هذا الشهر</p>
                  <p className="text-lg font-bold">₪{stats.thisMonth.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Users className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">عدد الوكلاء</p>
                  <p className="text-lg font-bold">{stats.agents}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm bg-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">عدد العمليات</p>
                  <p className="text-lg font-bold">{stats.count}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="بحث بالاسم أو الإيميل..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          <Select value={planFilter} onValueChange={setPlanFilter}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="الخطة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الخطط</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="basic">Basic</SelectItem>
            </SelectContent>
          </Select>
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="الشهر" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأشهر</SelectItem>
              {months.map(m => (
                <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        ) : (
          <Card className="border-0 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-right p-3 font-medium text-muted-foreground">الوكيل</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">الإيميل</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">الخطة</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">المبلغ</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">من تاريخ</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">إلى تاريخ</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">تاريخ الدفع</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">الحالة</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p: any) => {
                    const isExpired = p.period_end && new Date(p.period_end) < new Date();
                    const isActive = p.agents?.subscription_status === 'active';
                    return (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="p-3 font-medium">
                          {p.agents?.name_ar || p.agents?.name || '—'}
                        </td>
                        <td className="p-3 text-muted-foreground text-xs" dir="ltr">
                          {p.agents?.email || '—'}
                        </td>
                        <td className="p-3">
                          <Badge variant={p.plan === 'pro' ? 'default' : 'secondary'} className="text-xs">
                            {p.plan}
                          </Badge>
                        </td>
                        <td className="p-3 font-semibold">₪{p.amount?.toLocaleString()}</td>
                        <td className="p-3 text-xs">
                          {p.period_start ? format(new Date(p.period_start), 'dd/MM/yyyy') : '—'}
                        </td>
                        <td className="p-3 text-xs">
                          {p.period_end ? format(new Date(p.period_end), 'dd/MM/yyyy') : '—'}
                        </td>
                        <td className="p-3 text-xs">
                          {format(new Date(p.payment_date), 'dd/MM/yyyy')}
                        </td>
                        <td className="p-3">
                          {isExpired ? (
                            <Badge variant="destructive" className="text-xs">منتهي</Badge>
                          ) : isActive ? (
                            <Badge className="bg-green-600 hover:bg-green-700 text-xs">فعال</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">غير فعال</Badge>
                          )}
                        </td>
                        <td className="p-3 text-muted-foreground text-xs max-w-[200px] truncate">
                          {p.notes || '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-12 text-center text-muted-foreground">
                        <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p>لا توجد مدفوعات مسجلة</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
