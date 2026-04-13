import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { MessageSquare, Search, Filter, CheckCircle, XCircle, Clock, RefreshCw } from "lucide-react";

interface SmsLog {
  id: string;
  phone_number: string;
  message: string;
  sms_type: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  client_id: string | null;
  policy_id: string | null;
  clients?: { full_name: string } | null;
  policies?: { policy_number: string | null } | null;
}

const SMS_TYPE_LABELS: Record<string, string> = {
  invoice: "فاتورة",
  signature: "توقيع",
  reminder_1month: "تذكير شهر",
  reminder_1week: "تذكير أسبوع",
  manual: "يدوي",
  payment_request: "طلب دفع",
};

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  sent: { label: "تم الإرسال", icon: CheckCircle, variant: "default" },
  pending: { label: "قيد الانتظار", icon: Clock, variant: "secondary" },
  failed: { label: "فشل", icon: XCircle, variant: "destructive" },
};

export default function SmsHistory() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 50;

  useEffect(() => {
    fetchLogs();
  }, [typeFilter, statusFilter, page]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("sms_logs")
        .select(`
          *,
          clients(full_name),
          policies(policy_number)
        `)
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (typeFilter !== "all") {
        query = query.eq("sms_type", typeFilter as any);
      }
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;

      if (error) throw error;

      setLogs(data || []);
      setHasMore((data?.length || 0) === pageSize);
    } catch (error: any) {
      console.error("Error fetching SMS logs:", error);
      toast({
        title: "خطأ",
        description: "فشل في تحميل سجلات الرسائل",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      log.phone_number.includes(search) ||
      log.message.toLowerCase().includes(searchLower) ||
      log.clients?.full_name?.toLowerCase().includes(searchLower) ||
      log.policies?.policy_number?.toLowerCase().includes(searchLower)
    );
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return format(new Date(dateStr), "dd/MM/yyyy HH:mm", { locale: ar });
  };

  return (
    <MainLayout>
      <Header title="سجل الرسائل النصية" subtitle="عرض جميع الرسائل المرسلة" />

      <div className="p-6 space-y-6">
        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5" />
              فلترة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث بالاسم أو الهاتف..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pr-10"
                  />
                </div>
              </div>

              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="نوع الرسالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الأنواع</SelectItem>
                  {Object.entries(SMS_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الحالات</SelectItem>
                  <SelectItem value="sent">تم الإرسال</SelectItem>
                  <SelectItem value="pending">قيد الانتظار</SelectItem>
                  <SelectItem value="failed">فشل</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" onClick={fetchLogs}>
                <RefreshCw className="h-4 w-4 ml-2" />
                تحديث
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* SMS Logs Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              سجل الرسائل
              <Badge variant="secondary" className="mr-2">{filteredLogs.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">العميل</TableHead>
                      <TableHead className="text-right">الهاتف</TableHead>
                      <TableHead className="text-right">النوع</TableHead>
                      <TableHead className="text-right">الوثيقة</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="text-right">تاريخ الإرسال</TableHead>
                      <TableHead className="text-right max-w-xs">الرسالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          لا توجد رسائل
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredLogs.map((log) => {
                        const statusConfig = STATUS_CONFIG[log.status] || STATUS_CONFIG.pending;
                        const StatusIcon = statusConfig.icon;
                        
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="font-medium">
                              {log.clients?.full_name || "-"}
                            </TableCell>
                            <TableCell className="text-left">
                              <bdi>{log.phone_number}</bdi>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {SMS_TYPE_LABELS[log.sms_type] || log.sms_type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {log.policies?.policy_number || "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusConfig.variant} className="gap-1">
                                <StatusIcon className="h-3 w-3" />
                                {statusConfig.label}
                              </Badge>
                              {log.error_message && (
                                <p className="text-xs text-destructive mt-1 max-w-[150px] truncate" title={log.error_message}>
                                  {log.error_message}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(log.sent_at || log.created_at)}
                            </TableCell>
                            <TableCell className="max-w-xs">
                              <p className="text-sm text-muted-foreground line-clamp-2" title={log.message}>
                                {log.message}
                              </p>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>

                {/* Pagination */}
                <div className="flex justify-between items-center mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    السابق
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    صفحة {page + 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasMore}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    التالي
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
