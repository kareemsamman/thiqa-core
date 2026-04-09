import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Building2, RefreshCw, Calendar, TrendingDown } from "lucide-react";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ElzamiCostByCompany {
  companyId: string;
  companyName: string;
  companyNameAr: string;
  policyCount: number;
  totalCost: number;
}

export default function ElzamiCostsReport() {
  const [data, setData] = useState<ElzamiCostByCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [totalCost, setTotalCost] = useState(0);
  const [totalPolicies, setTotalPolicies] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('ab_ledger')
        .select(`
          counterparty_id,
          policy_id,
          amount,
          transaction_date,
          insurance_companies!inner(id, name, name_ar)
        `)
        .eq('category', 'commission_expense')
        .eq('status', 'posted')
        .eq('counterparty_type', 'insurance_company');

      if (fromDate) {
        query = query.gte('transaction_date', fromDate);
      }
      if (toDate) {
        query = query.lte('transaction_date', toDate);
      }

      const { data: entries, error } = await query;

      if (error) throw error;

      // Group by company
      const grouped = new Map<string, {
        companyId: string;
        companyName: string;
        companyNameAr: string;
        policies: Set<string>;
        totalCost: number;
      }>();

      for (const entry of entries || []) {
        const company = entry.insurance_companies as any;
        if (!company) continue;

        const key = company.id;
        if (!grouped.has(key)) {
          grouped.set(key, {
            companyId: company.id,
            companyName: company.name,
            companyNameAr: company.name_ar || company.name,
            policies: new Set(),
            totalCost: 0,
          });
        }

        const group = grouped.get(key)!;
        if (entry.policy_id) {
          group.policies.add(entry.policy_id);
        }
        // commission_expense is stored as negative, so we negate to show as positive cost
        group.totalCost += Math.abs(Number(entry.amount));
      }

      const result: ElzamiCostByCompany[] = Array.from(grouped.values()).map(g => ({
        companyId: g.companyId,
        companyName: g.companyName,
        companyNameAr: g.companyNameAr,
        policyCount: g.policies.size,
        totalCost: g.totalCost,
      })).sort((a, b) => b.totalCost - a.totalCost);

      setData(result);
      setTotalCost(result.reduce((sum, r) => sum + r.totalCost, 0));
      setTotalPolicies(result.reduce((sum, r) => sum + r.policyCount, 0));

    } catch (error) {
      console.error('Error fetching ELZAMI costs:', error);
      toast.error('حدث خطأ في جلب بيانات تكاليف الإلزامي');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatCurrency = (amount: number) => {
    return `₪${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  const handleClearFilters = () => {
    setFromDate("");
    setToDate("");
  };

  return (
    <MainLayout>
      <Header 
        title="تقرير تكاليف الإلزامي" 
        subtitle="عمولات شركات التأمين على بوالص الإلزامي"
      />

      <div className="p-6 space-y-6">
        {/* Filters */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              فلترة حسب الفترة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label>من تاريخ</Label>
                <ArabicDatePicker
                  value={fromDate}
                  onChange={(date) => setFromDate(date)}
                />
              </div>
              <div className="space-y-2">
                <Label>إلى تاريخ</Label>
                <ArabicDatePicker
                  value={toDate}
                  onChange={(date) => setToDate(date)}
                />
              </div>
              <Button variant="outline" onClick={handleClearFilters}>
                مسح الفلاتر
              </Button>
              <Button onClick={fetchData} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ml-2 ${loading ? 'animate-spin' : ''}`} />
                تحديث
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-l-4 border-l-warning">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                إجمالي تكلفة الإلزامي
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-32" />
              ) : (
                <div className="text-2xl font-bold text-warning">
                  {formatCurrency(totalCost)}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-primary">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                عدد الشركات
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold">{data.length}</div>
              )}
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-muted">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                عدد البوالص
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className="text-2xl font-bold">{totalPolicies}</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              تكاليف الإلزامي حسب الشركة
            </CardTitle>
            <CardDescription>
              تفاصيل عمولات الإلزامي المدفوعة لكل شركة تأمين
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : data.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="h-12 w-12 mx-auto mb-2" />
                <p>لا توجد تكاليف إلزامي في الفترة المحددة</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الشركة</TableHead>
                    <TableHead className="text-center">عدد البوالص</TableHead>
                    <TableHead className="text-left">التكلفة</TableHead>
                    <TableHead className="text-left">النسبة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={row.companyId}>
                      <TableCell className="font-medium">
                        {row.companyNameAr}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.policyCount}
                      </TableCell>
                      <TableCell className="text-left font-semibold text-warning">
                        {formatCurrency(row.totalCost)}
                      </TableCell>
                      <TableCell className="text-left text-muted-foreground">
                        {totalCost > 0 ? ((row.totalCost / totalCost) * 100).toFixed(1) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Total Row */}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell>الإجمالي</TableCell>
                    <TableCell className="text-center">{totalPolicies}</TableCell>
                    <TableCell className="text-left text-warning">
                      {formatCurrency(totalCost)}
                    </TableCell>
                    <TableCell className="text-left">100%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
