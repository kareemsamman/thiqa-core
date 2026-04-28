import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Building2, MessageSquare, Search } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ThiqaHeader } from "@/components/thiqa/ThiqaHeader";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const supabase = supabaseTyped as any;

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

export default function ThiqaSupport() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentRow>>({});
  const [categories, setCategories] = useState<Record<string, CategoryRow>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");

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

      const [aRes, cRes] = await Promise.all([
        supabaseTyped.from("agents").select("id, name, name_ar, short_code").in("id", agentIds),
        catIds.length > 0
          ? supabase.from("support_categories").select("id, name_ar, parent_id").in("id", catIds)
          : Promise.resolve({ data: [] }),
      ]);

      const am: Record<string, AgentRow> = {};
      (aRes.data as any[] || []).forEach((a) => (am[a.id] = a as AgentRow));
      setAgents(am);

      const cm: Record<string, CategoryRow> = {};
      (cRes.data as CategoryRow[] || []).forEach((c) => (cm[c.id] = c));
      setCategories(cm);
    }

    setLoading(false);
  };

  const summary = useMemo(() => {
    const c = { open: 0, in_progress: 0, done: 0, cancelled: 0 };
    tickets.forEach((t) => { c[t.status] += 1; });
    return c;
  }, [tickets]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
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
  }, [tickets, agents, statusFilter, search]);

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

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-full sm:max-w-md">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث برقم التذكرة، الموضوع، اسم الوكيل، أو كود الوكيل..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10"
              />
            </div>
            {statusFilter !== "all" && (
              <Badge
                variant="outline"
                className="cursor-pointer gap-1.5"
                onClick={() => setStatusFilter("all")}
              >
                <span>{STATUS_LABEL[statusFilter as TicketRow["status"]]}</span>
                <span className="text-muted-foreground">×</span>
              </Badge>
            )}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
            </div>
          ) : visible.length === 0 ? (
            <Card className="rounded-2xl border-dashed">
              <CardContent className="p-10 text-center text-sm text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-40" />
                لا توجد تذاكر مطابقة
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {visible.map((t) => {
                const a = agents[t.agent_id];
                const cat = t.category_id ? categories[t.category_id] : null;
                const sub = t.subcategory_id ? categories[t.subcategory_id] : null;
                return (
                  <Card
                    key={t.id}
                    onClick={() => navigate(`/support/${t.id}`)}
                    className="rounded-2xl cursor-pointer hover:shadow-md hover:border-primary/30 transition-all"
                  >
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground ltr-nums">{t.ticket_number}</span>
                          <Badge variant="outline" className={cn("text-[10px] font-medium", STATUS_TONE[t.status])}>
                            {STATUS_LABEL[t.status]}
                          </Badge>
                          {cat && <Badge variant="outline" className="text-[10px]">{cat.name_ar}{sub ? ` / ${sub.name_ar}` : ""}</Badge>}
                        </div>
                        <div className="font-semibold truncate mt-0.5">{t.subject}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span className="truncate">{a ? (a.name_ar || a.name) : "—"}</span>
                          {a?.short_code && (
                            <span className="font-mono ltr-nums">{a.short_code}</span>
                          )}
                          <span className="ltr-nums">· {format(new Date(t.updated_at), "dd/MM/yyyy HH:mm")}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
