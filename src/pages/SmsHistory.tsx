import { useState, useEffect, Fragment } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { AgentBranchFilter } from "@/components/shared/AgentBranchFilter";
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
import { MessageSquare, Search, Filter, CheckCircle, XCircle, Clock, RefreshCw, ChevronDown, ChevronUp, FileText, Link2, Send, AlertCircle } from "lucide-react";
import { PolicyDetailsDrawer } from "@/components/policies/PolicyDetailsDrawer";

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
  clients?: { full_name: string; phone_number: string | null } | null;
  policies?: {
    policy_number: string | null;
    document_number: string | null;
    car: { car_number: string | null } | null;
  } | null;
}

const SMS_TYPE_LABELS: Record<string, string> = {
  invoice: "فاتورة",
  signature: "توقيع",
  reminder_1month: "تذكير شهر",
  reminder_1week: "تذكير أسبوع",
  manual: "يدوي",
  payment_request: "طلب دفع",
};

// Per-type accent colors used by the type chip. Keep values as tailwind
// utility strings so callers can slot them into `className` directly.
const SMS_TYPE_STYLES: Record<string, string> = {
  signature: "bg-primary/10 text-primary border-primary/20",
  invoice: "bg-success/10 text-success border-success/20",
  reminder_1month: "bg-warning/10 text-warning border-warning/20",
  reminder_1week: "bg-warning/10 text-warning border-warning/20",
  manual: "bg-muted text-muted-foreground border-border",
  payment_request: "bg-destructive/10 text-destructive border-destructive/20",
};

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  sent: { label: "تم الإرسال", icon: CheckCircle, variant: "default" },
  pending: { label: "قيد الانتظار", icon: Clock, variant: "secondary" },
  failed: { label: "فشل", icon: XCircle, variant: "destructive" },
};

// Most signature SMS carry a long CDN URL ("https://thiqacrm.b-cdn.net/
// signatures/...") that looks like noise in the message column. Strip the
// URL from the visible preview and return just the human prose — the
// expanded row still shows the full body.
const previewMessage = (message: string): string => {
  return message.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
};

export default function SmsHistory() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // Page-level branch filter — global admins only.
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [policyDrawerId, setPolicyDrawerId] = useState<string | null>(null);
  const [policyDrawerOpen, setPolicyDrawerOpen] = useState(false);
  const pageSize = 50;

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const openPolicyPreview = (policyId: string | null | undefined) => {
    if (!policyId) return;
    setPolicyDrawerId(policyId);
    setPolicyDrawerOpen(true);
  };

  useEffect(() => {
    fetchLogs();
  }, [typeFilter, statusFilter, branchFilter, page]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("sms_logs")
        .select(`
          *,
          clients(full_name, phone_number),
          policies(policy_number, document_number, car:cars(car_number))
        `)
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (typeFilter !== "all") {
        query = query.eq("sms_type", typeFilter as any);
      }
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      if (branchFilter) {
        query = query.eq("branch_id", branchFilter);
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

  // Accept bare ASCII digits (e.g. "03/2026") anywhere in the search
  // string — users type document/receipt numbers without ltr isolation.
  const filteredLogs = logs.filter((log) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      log.phone_number.includes(search) ||
      log.message.toLowerCase().includes(searchLower) ||
      log.clients?.full_name?.toLowerCase().includes(searchLower) ||
      log.policies?.policy_number?.toLowerCase().includes(searchLower) ||
      log.policies?.document_number?.toLowerCase().includes(searchLower) ||
      log.policies?.car?.car_number?.toLowerCase().includes(searchLower)
    );
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return format(new Date(dateStr), "dd/MM/yyyy HH:mm", { locale: ar });
  };

  // Summary over the currently loaded page. The filters up top already
  // scope the query, so these counts reflect what the user is actually
  // looking at — matches how the table header's total badge behaves.
  const statusCounts = logs.reduce(
    (acc, log) => {
      acc.total += 1;
      if (log.status === "sent") acc.sent += 1;
      else if (log.status === "failed") acc.failed += 1;
      else acc.pending += 1;
      return acc;
    },
    { total: 0, sent: 0, pending: 0, failed: 0 },
  );

  return (
    <MainLayout>
      <Header title="سجل الرسائل النصية" subtitle="عرض جميع الرسائل المرسلة" />

      <div className="md:p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">المجموع</p>
                <p className="text-2xl font-bold">{statusCounts.total}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <Send className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">تم الإرسال</p>
                <p className="text-2xl font-bold text-success">{statusCounts.sent}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <Clock className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">قيد الانتظار</p>
                <p className="text-2xl font-bold text-warning">{statusCounts.pending}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">فشل</p>
                <p className="text-2xl font-bold text-destructive">{statusCounts.failed}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5" />
              فلترة
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6">
            <div className="space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:gap-4">
              <div className="w-full sm:flex-1 sm:min-w-[200px]">
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
                <SelectTrigger className="w-full sm:w-[180px]">
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
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الحالات</SelectItem>
                  <SelectItem value="sent">تم الإرسال</SelectItem>
                  <SelectItem value="pending">قيد الانتظار</SelectItem>
                  <SelectItem value="failed">فشل</SelectItem>
                </SelectContent>
              </Select>

              <AgentBranchFilter
                value={branchFilter}
                onChange={(v) => { setBranchFilter(v); setPage(0); }}
              />

              <Button variant="outline" onClick={fetchLogs} className="w-full sm:w-auto">
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
                      <TableHead className="w-8" />
                      <TableHead className="text-right">العميل</TableHead>
                      <TableHead className="hidden md:table-cell text-right">الهاتف</TableHead>
                      <TableHead className="text-right">النوع</TableHead>
                      <TableHead className="hidden md:table-cell text-right">المعاملة</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="hidden md:table-cell text-right">تاريخ الإرسال</TableHead>
                      <TableHead className="hidden md:table-cell text-right max-w-xs">الرسالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-12">
                          <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                            <MessageSquare className="h-8 w-8 opacity-40" />
                            <p className="text-sm">لا توجد رسائل</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredLogs.map((log) => {
                        const statusConfig = STATUS_CONFIG[log.status] || STATUS_CONFIG.pending;
                        const StatusIcon = statusConfig.icon;
                        const isExpanded = expandedId === log.id;
                        // Prefer document_number (human-readable "34/2026"),
                        // fall back to the raw company policy_number, then
                        // surface the car number as a last-ditch hint for
                        // client-level SMS that don't carry a policy_id.
                        const docLabel =
                          log.policies?.document_number ||
                          log.policies?.policy_number ||
                          null;
                        const carLabel = log.policies?.car?.car_number || null;

                        return (
                          <Fragment key={log.id}>
                            <TableRow
                              className="cursor-pointer hover:bg-muted/40 transition-colors"
                              onClick={() => toggleExpand(log.id)}
                            >
                              <TableCell className="w-8">
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                              </TableCell>
                              <TableCell className="font-medium">
                                {log.clients?.full_name || "-"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-left">
                                <bdi>{log.phone_number}</bdi>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={SMS_TYPE_STYLES[log.sms_type] || ""}
                                >
                                  {SMS_TYPE_LABELS[log.sms_type] || log.sms_type}
                                </Badge>
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-xs">
                                {docLabel ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openPolicyPreview(log.policy_id);
                                    }}
                                    className="flex flex-col items-start gap-0.5 hover:text-primary transition-colors"
                                    title="عرض المعاملة"
                                  >
                                    <span className="font-mono ltr-nums font-semibold">{docLabel}</span>
                                    {carLabel && (
                                      <span className="text-muted-foreground font-mono ltr-nums">🚗 {carLabel}</span>
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
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
                              <TableCell className="hidden md:table-cell text-muted-foreground">
                                {formatDate(log.sent_at || log.created_at)}
                              </TableCell>
                              <TableCell className="hidden md:table-cell max-w-xs">
                                <div className="flex items-start gap-2">
                                  <p className="text-sm text-muted-foreground line-clamp-2 flex-1" title={log.message}>
                                    {previewMessage(log.message) || (
                                      <span className="italic">—</span>
                                    )}
                                  </p>
                                  {/https?:\/\//.test(log.message) && (
                                    <span
                                      className="inline-flex items-center gap-1 text-[11px] text-primary shrink-0 mt-0.5"
                                      title="تحتوي على رابط"
                                    >
                                      <Link2 className="h-3 w-3" />
                                      رابط
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow className="bg-muted/30 hover:bg-muted/30">
                                <TableCell colSpan={8} className="p-0">
                                  <div className="p-5 space-y-4 border-t border-border/40">
                                    {/* Meta strip — all the fields that
                                        don't fit in the summary row */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                      <div>
                                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">العميل</p>
                                        <p className="font-medium">{log.clients?.full_name || "-"}</p>
                                      </div>
                                      <div>
                                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">الهاتف</p>
                                        <p className="font-mono ltr-nums"><bdi>{log.phone_number}</bdi></p>
                                      </div>
                                      <div>
                                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">النوع</p>
                                        <p>
                                          <Badge
                                            variant="outline"
                                            className={SMS_TYPE_STYLES[log.sms_type] || ""}
                                          >
                                            {SMS_TYPE_LABELS[log.sms_type] || log.sms_type}
                                          </Badge>
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">الحالة</p>
                                        <p>
                                          <Badge variant={statusConfig.variant} className="gap-1">
                                            <StatusIcon className="h-3 w-3" />
                                            {statusConfig.label}
                                          </Badge>
                                        </p>
                                      </div>
                                      {docLabel && (
                                        <div>
                                          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">رقم المعاملة</p>
                                          <p className="font-mono ltr-nums font-semibold">{docLabel}</p>
                                        </div>
                                      )}
                                      {carLabel && (
                                        <div>
                                          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">رقم السيارة</p>
                                          <p className="font-mono ltr-nums">{carLabel}</p>
                                        </div>
                                      )}
                                      <div>
                                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">تاريخ الإرسال</p>
                                        <p>{formatDate(log.sent_at || log.created_at)}</p>
                                      </div>
                                    </div>

                                    {/* Full message body — wrapped in a
                                        card so it reads clearly from the
                                        rest of the meta. */}
                                    <div>
                                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">نص الرسالة</p>
                                      <div className="rounded-lg border bg-card p-4">
                                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                                          {log.message}
                                        </p>
                                      </div>
                                    </div>

                                    {log.error_message && (
                                      <div>
                                        <p className="text-[11px] text-destructive uppercase tracking-wide mb-1">سبب الفشل</p>
                                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                                          <p className="whitespace-pre-wrap break-words text-sm text-destructive">
                                            {log.error_message}
                                          </p>
                                        </div>
                                      </div>
                                    )}

                                    {log.policy_id && (
                                      <div className="pt-2">
                                        <Button
                                          variant="default"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openPolicyPreview(log.policy_id);
                                          }}
                                          className="gap-2"
                                        >
                                          <FileText className="h-4 w-4" />
                                          عرض المعاملة
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
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

      <PolicyDetailsDrawer
        policyId={policyDrawerId}
        open={policyDrawerOpen}
        onOpenChange={(open) => {
          setPolicyDrawerOpen(open);
          if (!open) setPolicyDrawerId(null);
        }}
        onViewRelatedPolicy={(id) => setPolicyDrawerId(id)}
      />
    </MainLayout>
  );
}
