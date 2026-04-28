import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, endOfDay, endOfMonth, endOfWeek, endOfYear, startOfDay, startOfMonth, startOfWeek, startOfYear } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { Building2, ChevronLeft, ChevronRight, Copy, MessageSquare, Search, Trash2 } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ThiqaHeader } from "@/components/thiqa/ThiqaHeader";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface TicketRow {
  id: string;
  ticket_number: string;
  agent_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  subject: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

interface AgentRow {
  id: string;
  name: string;
  name_ar: string | null;
  short_code: string | null;
}

interface CategoryRow {
  id: string;
  name_ar: string;
  parent_id: string | null;
}

const STATUS_LABEL: Record<TicketRow["status"], string> = {
  open: "مفتوح",
  in_progress: "قيد المعالجة",
  done: "تم",
  cancelled: "ملغى",
};

const STATUS_TONE: Record<TicketRow["status"], string> = {
  open: "bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300",
  in_progress: "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300",
  done: "bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-300",
  cancelled: "bg-muted border-border text-muted-foreground",
};

type StatusFilter = "all" | "open" | "in_progress" | "done" | "cancelled";
type DatePeriod = "all" | "today" | "week" | "month" | "year" | "custom";

const PAGE_SIZE = 25;

// Resolve a date period to a [start, end] window. "all" returns null
// so callers can skip filtering entirely.
function resolveDateWindow(period: DatePeriod, customStart: string, customEnd: string): { start: Date; end: Date } | null {
  const now = new Date();
  switch (period) {
    case "all": return null;
    case "today": return { start: startOfDay(now), end: endOfDay(now) };
    case "week": return { start: startOfWeek(now, { locale: ar }), end: endOfWeek(now, { locale: ar }) };
    case "month": return { start: startOfMonth(now), end: endOfMonth(now) };
    case "year": return { start: startOfYear(now), end: endOfYear(now) };
    case "custom":
      if (!customStart && !customEnd) return null;
      return {
        start: customStart ? startOfDay(new Date(customStart)) : new Date(0),
        end: customEnd ? endOfDay(new Date(customEnd)) : endOfDay(now),
      };
  }
}

export default function ThiqaSupport() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentRow>>({});
  const [categories, setCategories] = useState<Record<string, CategoryRow>>({});
  const [allAgents, setAllAgents] = useState<AgentRow[]>([]);
  const [allTopCategories, setAllTopCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [datePeriod, setDatePeriod] = useState<DatePeriod>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // Pagination
  const [page, setPage] = useState(1);

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<TicketRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    // Tickets first; agent + category lookups come second so we can
    // populate from a single id list (avoids N joins client-side).
    const { data: tData } = await supabase
      .from("support_tickets")
      .select("*")
      .order("updated_at", { ascending: false });
    const ts = (tData as TicketRow[]) || [];
    setTickets(ts);

    if (ts.length > 0) {
      const agentIds = Array.from(new Set(ts.map((t) => t.agent_id)));
      const catIds = Array.from(
        new Set([
          ...ts.map((t) => t.category_id).filter(Boolean) as string[],
          ...ts.map((t) => t.subcategory_id).filter(Boolean) as string[],
        ]),
      );

      const [aRes, cRes, allCatsRes] = await Promise.all([
        supabase.from("agents").select("id, name, name_ar, short_code").in("id", agentIds),
        catIds.length > 0
          ? supabase.from("support_categories").select("id, name_ar, parent_id").in("id", catIds)
          : Promise.resolve({ data: [] }),
        // Top-level categories drive the filter dropdown — pulled in
        // full so the user can filter by a category that doesn't yet
        // appear on this page of tickets.
        supabase.from("support_categories").select("id, name_ar, parent_id").is("parent_id", null).order("sort_order"),
      ]);

      const am: Record<string, AgentRow> = {};
      const agentList: AgentRow[] = [];
      (aRes.data as any[] || []).forEach((a) => {
        am[a.id] = a as AgentRow;
        agentList.push(a as AgentRow);
      });
      setAgents(am);
      setAllAgents(agentList.sort((a, b) => (a.name_ar || a.name).localeCompare(b.name_ar || b.name, "ar")));

      const cm: Record<string, CategoryRow> = {};
      (cRes.data as CategoryRow[] || []).forEach((c) => (cm[c.id] = c));
      setCategories(cm);

      setAllTopCategories((allCatsRes.data as CategoryRow[]) || []);
    }

    setLoading(false);
  };

  const summary = useMemo(() => {
    const c = { open: 0, in_progress: 0, done: 0, cancelled: 0 };
    tickets.forEach((t) => { c[t.status] += 1; });
    return c;
  }, [tickets]);

  // Reset to page 1 whenever any filter changes — otherwise the user
  // could be paging past the end of an empty filtered list.
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, agentFilter, categoryFilter, datePeriod, customStart, customEnd]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const window = resolveDateWindow(datePeriod, customStart, customEnd);
    return tickets.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (agentFilter !== "all" && t.agent_id !== agentFilter) return false;
      if (categoryFilter !== "all" && t.category_id !== categoryFilter) return false;
      if (window) {
        const updated = new Date(t.updated_at);
        if (updated < window.start || updated > window.end) return false;
      }
      if (!q) return true;
      const a = agents[t.agent_id];
      const haystack = [
        t.ticket_number,
        t.subject,
        a?.name,
        a?.name_ar,
        a?.short_code,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [tickets, agents, statusFilter, agentFilter, categoryFilter, datePeriod, customStart, customEnd, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visiblePage = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const copyShortCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("تم نسخ الكود");
    } catch {
      toast.error("تعذّر النسخ");
    }
  };

  const performDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      // 1. Fetch every attachment under this ticket so we can wipe
      //    the storage bytes (the DB cascade only takes the rows).
      const { data: msgs } = await supabase
        .from("support_messages")
        .select("id")
        .eq("ticket_id", pendingDelete.id);
      const msgIds = (msgs || []).map((m: any) => m.id as string);
      if (msgIds.length > 0) {
        const { data: atts } = await supabase
          .from("support_attachments")
          .select("file_path")
          .in("message_id", msgIds);
        const paths = (atts || []).map((a: any) => a.file_path as string);
        if (paths.length > 0) {
          await supabase.storage.from("support-attachments").remove(paths);
        }
      }

      // 2. Delete the ticket — FK cascades take messages + attachments.
      const { error } = await supabase
        .from("support_tickets")
        .delete()
        .eq("id", pendingDelete.id);
      if (error) throw error;

      setTickets((prev) => prev.filter((t) => t.id !== pendingDelete.id));
      toast.success("تم حذف التذكرة");
      setPendingDelete(null);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "تعذّر حذف التذكرة");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <MainLayout>
      <div dir="rtl">
        <ThiqaHeader title="الدعم" subtitle="مركز تذاكر الدعم لجميع الوكلاء" />

        <div className="space-y-4 md:space-y-6">
          {/* Status summary tiles — click to filter. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["open", "in_progress", "done", "cancelled"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                className={cn(
                  "p-3 rounded-2xl border text-right transition-all hover:shadow-md",
                  STATUS_TONE[s].replace("text-", "border-").replace("/40", "/20"),
                  STATUS_TONE[s].includes("blue") && "bg-blue-500/5",
                  STATUS_TONE[s].includes("amber") && "bg-amber-500/5",
                  STATUS_TONE[s].includes("green") && "bg-green-500/5",
                  s === "cancelled" && "bg-muted/30",
                  statusFilter === s && "ring-2 ring-offset-2 ring-offset-background ring-foreground/30 shadow-md",
                )}
              >
                <div className="text-[11px] text-muted-foreground">{STATUS_LABEL[s]}</div>
                <div className="text-2xl font-bold ltr-nums">{summary[s]}</div>
              </button>
            ))}
          </div>

          {/* Filter bar */}
          <Card className="rounded-2xl">
            <CardContent className="p-3 md:p-4 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[220px] max-w-md">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث برقم التذكرة، الموضوع، اسم الوكيل، أو كود الوكيل..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pr-10"
                  />
                </div>

                <Select value={agentFilter} onValueChange={setAgentFilter}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="الوكيل" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الوكلاء</SelectItem>
                    {allAgents.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-right">
                        {a.name_ar || a.name}{a.short_code ? ` · ${a.short_code}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="الفئة" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الفئات</SelectItem>
                    {allTopCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-right">{c.name_ar}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={datePeriod} onValueChange={(v) => setDatePeriod(v as DatePeriod)}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="الفترة" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الفترات</SelectItem>
                    <SelectItem value="today">اليوم</SelectItem>
                    <SelectItem value="week">هذا الأسبوع</SelectItem>
                    <SelectItem value="month">هذا الشهر</SelectItem>
                    <SelectItem value="year">هذه السنة</SelectItem>
                    <SelectItem value="custom">تاريخ مخصص</SelectItem>
                  </SelectContent>
                </Select>

                {datePeriod === "custom" && (
                  <div className="flex items-center gap-2">
                    <ArabicDatePicker value={customStart} onChange={setCustomStart} placeholder="من تاريخ" />
                    <span className="text-muted-foreground text-xs">إلى</span>
                    <ArabicDatePicker value={customEnd} onChange={setCustomEnd} placeholder="إلى تاريخ" />
                  </div>
                )}
              </div>

              {(statusFilter !== "all" || agentFilter !== "all" || categoryFilter !== "all" || datePeriod !== "all" || search) && (
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-muted-foreground">نتائج: {filtered.length}</span>
                  {statusFilter !== "all" && (
                    <Badge variant="outline" className="cursor-pointer gap-1.5" onClick={() => setStatusFilter("all")}>
                      {STATUS_LABEL[statusFilter as TicketRow["status"]]} <span className="text-muted-foreground">×</span>
                    </Badge>
                  )}
                  {agentFilter !== "all" && agents[agentFilter] && (
                    <Badge variant="outline" className="cursor-pointer gap-1.5" onClick={() => setAgentFilter("all")}>
                      {agents[agentFilter].name_ar || agents[agentFilter].name} <span className="text-muted-foreground">×</span>
                    </Badge>
                  )}
                  {categoryFilter !== "all" && allTopCategories.find((c) => c.id === categoryFilter) && (
                    <Badge variant="outline" className="cursor-pointer gap-1.5" onClick={() => setCategoryFilter("all")}>
                      {allTopCategories.find((c) => c.id === categoryFilter)?.name_ar} <span className="text-muted-foreground">×</span>
                    </Badge>
                  )}
                  {datePeriod !== "all" && (
                    <Badge variant="outline" className="cursor-pointer gap-1.5" onClick={() => setDatePeriod("all")}>
                      {datePeriod === "custom" ? "تاريخ مخصص" : datePeriod === "today" ? "اليوم" : datePeriod === "week" ? "هذا الأسبوع" : datePeriod === "month" ? "هذا الشهر" : "هذه السنة"}
                      <span className="text-muted-foreground">×</span>
                    </Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="rounded-2xl border-dashed">
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-40" />
                لا توجد تذاكر مطابقة
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="space-y-2">
                {visiblePage.map((t) => {
                  const a = agents[t.agent_id];
                  const cat = t.category_id ? categories[t.category_id] : null;
                  const sub = t.subcategory_id ? categories[t.subcategory_id] : null;
                  return (
                    <Card
                      key={t.id}
                      className="rounded-2xl hover:shadow-md hover:border-primary/30 transition-all"
                    >
                      <CardContent className="p-4 flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => navigate(`/thiqa/support/${t.id}`)}
                          className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0 hover:bg-primary/15 transition-colors"
                          aria-label="فتح التذكرة"
                        >
                          <Building2 className="h-6 w-6 text-primary" />
                        </button>

                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => navigate(`/thiqa/support/${t.id}`)}
                        >
                          {/* Agent name + short-code (prominent — admin's
                              first scan signal). */}
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-base md:text-lg font-bold truncate">
                              {a ? (a.name_ar || a.name) : "—"}
                            </span>
                            {a?.short_code && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); copyShortCode(a.short_code!); }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted hover:bg-muted/70 transition-colors font-mono text-sm font-semibold ltr-nums"
                                title="نسخ الكود"
                              >
                                <span>{a.short_code}</span>
                                <Copy className="h-3 w-3 text-muted-foreground" />
                              </button>
                            )}
                          </div>

                          {/* Subject (secondary) */}
                          <div className="font-medium text-sm truncate text-foreground/90">{t.subject}</div>

                          {/* Meta line */}
                          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mt-1.5">
                            <span className="font-mono ltr-nums">{t.ticket_number}</span>
                            <Badge variant="outline" className={cn("text-[10px] font-medium", STATUS_TONE[t.status])}>
                              {STATUS_LABEL[t.status]}
                            </Badge>
                            {cat && <Badge variant="outline" className="text-[10px]">{cat.name_ar}{sub ? ` / ${sub.name_ar}` : ""}</Badge>}
                            <span className="ltr-nums">· {format(new Date(t.updated_at), "dd/MM/yyyy HH:mm")}</span>
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); setPendingDelete(t); }}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                          aria-label="حذف التذكرة"
                          title="حذف التذكرة"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-muted-foreground ltr-nums">
                    صفحة {page} من {totalPages} · {filtered.length} تذكرة
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                      السابق
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      التالي
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف التذكرة نهائياً؟</AlertDialogTitle>
            <AlertDialogDescription>
              ستُحذف التذكرة {pendingDelete?.ticket_number} مع كل رسائلها ومرفقاتها. لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); performDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "جاري الحذف..." : "حذف نهائي"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
