import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ThiqaHeader } from "@/components/thiqa/ThiqaHeader";
import { PlanBadge, StatusBadge, PriceCell } from "@/components/thiqa/labels";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Building2, Activity, Clock, AlertCircle, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format, differenceInCalendarDays } from "date-fns";
import { cn } from "@/lib/utils";

interface Agent {
  id: string;
  name: string;
  name_ar: string | null;
  email: string;
  phone: string | null;
  plan: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  monthly_price: number | null;
  billing_cycle: "monthly" | "yearly" | null;
  created_at: string;
  email_confirmed?: boolean;
  /** Max last_seen_at across the agent's whole team. null = nobody on
   *  the team has ever logged in (or sessions exist outside the
   *  fetched window). */
  last_activity_at?: string | null;
}

type ActivityFilter = "all" | "active" | "dormant" | "never";
type SortMode = "newest" | "activity";

const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = {
  all: "الكل",
  active: "نشط",
  dormant: "خامل",
  never: "لم يدخل أبداً",
};

// Color the last-activity chip by recency. Anything within a week is
// healthy, 8-30 days is amber, >30 days is the cleanup target the
// admin asked about, and "never logged in" is the most prominent.
function activityChip(lastActivityAt: string | null | undefined) {
  if (!lastActivityAt) {
    return { label: "لم يدخل أبداً", className: "bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300" };
  }
  const days = differenceInCalendarDays(new Date(), new Date(lastActivityAt));
  let label: string;
  if (days <= 0) label = "اليوم";
  else if (days === 1) label = "أمس";
  else if (days < 7) label = `منذ ${days} أيام`;
  else if (days < 30) label = `منذ ${Math.floor(days / 7)} أسابيع`;
  else if (days < 365) label = `منذ ${Math.floor(days / 30)} شهور`;
  else label = `منذ ${Math.floor(days / 365)} سنوات`;

  if (days <= 7) {
    return { label, className: "bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-300" };
  }
  if (days <= 30) {
    return { label, className: "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300" };
  }
  return { label, className: "bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300" };
}

function isDormant(lastActivityAt: string | null | undefined) {
  if (!lastActivityAt) return false;
  return differenceInCalendarDays(new Date(), new Date(lastActivityAt)) > 30;
}

export default function ThiqaAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const navigate = useNavigate();

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      const agentIds = data.map((a: any) => a.id);

      // Email confirmation status (one user is enough to mark the
      // whole agent as activated).
      const { data: auData } = await supabase
        .from("agent_users")
        .select("agent_id, user_id, profiles!agent_users_user_id_profiles_fkey(email_confirmed)")
        .in("agent_id", agentIds);

      const confirmMap: Record<string, boolean> = {};
      (auData || []).forEach((au: any) => {
        const confirmed = au.profiles?.email_confirmed === true;
        if (confirmed || !(au.agent_id in confirmMap)) {
          confirmMap[au.agent_id] = confirmed || (confirmMap[au.agent_id] ?? false);
        }
      });

      // Last team-wide activity per agent. user_sessions has an
      // agent_id column auto-populated by trigger, so a single ordered
      // SELECT is enough — keep just the newest row per agent in
      // memory. We cap the fetch at 5000 to bound the payload; the
      // table is heartbeat-driven so a busy agent generates many rows
      // per session.
      const { data: sessionData } = await supabase
        .from("user_sessions")
        .select("agent_id, last_seen_at")
        .in("agent_id", agentIds)
        .order("last_seen_at", { ascending: false })
        .limit(5000);

      const activityMap: Record<string, string> = {};
      (sessionData || []).forEach((s: any) => {
        if (!s.agent_id || !s.last_seen_at) return;
        if (!activityMap[s.agent_id]) {
          activityMap[s.agent_id] = s.last_seen_at;
        }
      });

      setAgents(
        (data as Agent[]).map((a) => ({
          ...a,
          email_confirmed: confirmMap[a.id] ?? false,
          last_activity_at: activityMap[a.id] ?? null,
        })),
      );
    }
    setLoading(false);
  };

  const summary = useMemo(() => {
    let active = 0;
    let dormant = 0;
    let never = 0;
    agents.forEach((a) => {
      if (!a.last_activity_at) {
        never += 1;
        return;
      }
      const d = differenceInCalendarDays(new Date(), new Date(a.last_activity_at));
      if (d <= 7) active += 1;
      else if (d > 30) dormant += 1;
    });
    return { total: agents.length, active, dormant, never };
  }, [agents]);

  const visibleAgents = useMemo(() => {
    const q = search.toLowerCase();
    let list = agents.filter((a) => {
      const matchesSearch =
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.name_ar && a.name_ar.includes(search));
      if (!matchesSearch) return false;
      if (activityFilter === "all") return true;
      if (activityFilter === "never") return !a.last_activity_at;
      if (activityFilter === "active") {
        return a.last_activity_at && differenceInCalendarDays(new Date(), new Date(a.last_activity_at)) <= 7;
      }
      if (activityFilter === "dormant") return isDormant(a.last_activity_at);
      return true;
    });

    if (sortMode === "activity") {
      list = [...list].sort((a, b) => {
        // Never-logged-in goes to the bottom in this mode so the most
        // recently active rises to the top.
        const aT = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
        const bT = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
        return bT - aT;
      });
    }
    return list;
  }, [agents, search, activityFilter, sortMode]);

  const renderStatus = (agent: Agent) => {
    if (!agent.email_confirmed) {
      return <Badge variant="outline" className="border-amber-500 text-amber-600">غير مفعّل</Badge>;
    }
    return <StatusBadge status={agent.subscription_status} />;
  };

  const isNew = (createdAt: string) => differenceInCalendarDays(new Date(), new Date(createdAt)) <= 7;

  return (
    <MainLayout>
      <div dir="rtl">
        <ThiqaHeader
          title="إدارة الوكلاء"
          subtitle="إدارة وكلاء التأمين المشتركين في منصة ثقة"
          actions={
            <Button onClick={() => navigate("/thiqa/agents/new")} className="h-11 rounded-full gap-2">
              <Plus className="h-4 w-4" />
              وكيل جديد
            </Button>
          }
        />

        <div className="space-y-4 md:space-y-6">
          {/* Activity summary — a quick read on how many agents are
              actually using the system, with click-through into each
              filter so the cleanup workflow is one tap away. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile
              tone="default"
              icon={Building2}
              label="إجمالي"
              value={summary.total}
              active={activityFilter === "all"}
              onClick={() => setActivityFilter("all")}
            />
            <SummaryTile
              tone="success"
              icon={Activity}
              label="نشط (7 أيام)"
              value={summary.active}
              active={activityFilter === "active"}
              onClick={() => setActivityFilter("active")}
            />
            <SummaryTile
              tone="amber"
              icon={Clock}
              label="خامل (>30 يوم)"
              value={summary.dormant}
              active={activityFilter === "dormant"}
              onClick={() => setActivityFilter("dormant")}
            />
            <SummaryTile
              tone="destructive"
              icon={AlertCircle}
              label="لم يدخل أبداً"
              value={summary.never}
              active={activityFilter === "never"}
              onClick={() => setActivityFilter("never")}
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-full sm:max-w-sm">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو الإيميل..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10"
              />
            </div>

            {/* Sort toggle — newest registered (default) keeps the
                fresh-signup experience the admin asked for; flipping
                to "by activity" surfaces the most recently active so
                "who's actually using this" is one click away. */}
            <div className="inline-flex rounded-full border bg-muted/40 p-1 gap-1">
              <button
                type="button"
                onClick={() => setSortMode("newest")}
                className={cn(
                  "h-8 px-3 text-xs rounded-full transition-colors",
                  sortMode === "newest" ? "bg-background shadow-sm font-semibold" : "text-muted-foreground hover:text-foreground",
                )}
              >
                الأحدث تسجيلاً
              </button>
              <button
                type="button"
                onClick={() => setSortMode("activity")}
                className={cn(
                  "h-8 px-3 text-xs rounded-full transition-colors",
                  sortMode === "activity" ? "bg-background shadow-sm font-semibold" : "text-muted-foreground hover:text-foreground",
                )}
              >
                الأحدث نشاطاً
              </button>
            </div>

            {activityFilter !== "all" && (
              <Badge
                variant="outline"
                className="cursor-pointer gap-1.5"
                onClick={() => setActivityFilter("all")}
              >
                <span>{ACTIVITY_FILTER_LABELS[activityFilter]}</span>
                <span className="text-muted-foreground">×</span>
              </Badge>
            )}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <>
              {/* Mobile cards view */}
              <div className="md:hidden space-y-3">
                {visibleAgents.map((agent) => {
                  const chip = activityChip(agent.last_activity_at);
                  return (
                    <div
                      key={agent.id}
                      className="glass-card p-4 rounded-xl cursor-pointer active:scale-[0.98] transition-transform"
                      onClick={() => navigate(`/thiqa/agents/${agent.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Building2 className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <div className="font-semibold text-sm truncate">{agent.name_ar || agent.name}</div>
                            {isNew(agent.created_at) && (
                              <Badge className="bg-blue-500 text-[9px] px-1.5 py-0 gap-0.5">
                                <Sparkles className="h-2.5 w-2.5" />
                                جديد
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{agent.email}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {renderStatus(agent)}
                          <PlanBadge plan={agent.plan} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs">
                        <Badge variant="outline" className={cn("font-medium", chip.className)}>
                          {chip.label}
                        </Badge>
                        <PriceCell monthlyPrice={agent.monthly_price} billingCycle={agent.billing_cycle} />
                      </div>
                    </div>
                  );
                })}
                {visibleAgents.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground text-sm">لا يوجد وكلاء</div>
                )}
              </div>

              {/* Desktop table view */}
              <div className="border rounded-lg overflow-hidden hidden md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-right p-3 font-medium">الوكيل</th>
                      <th className="text-right p-3 font-medium">الإيميل</th>
                      <th className="text-right p-3 font-medium">الخطة</th>
                      <th className="text-right p-3 font-medium">الحالة</th>
                      <th className="text-right p-3 font-medium">آخر نشاط</th>
                      <th className="text-right p-3 font-medium">انتهاء الاشتراك</th>
                      <th className="text-right p-3 font-medium">السعر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAgents.map((agent) => {
                      const chip = activityChip(agent.last_activity_at);
                      return (
                        <tr
                          key={agent.id}
                          className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => navigate(`/thiqa/agents/${agent.id}`)}
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                <Building2 className="h-4 w-4 text-primary" />
                              </div>
                              <div>
                                <div className="font-medium flex items-center gap-1.5">
                                  {agent.name_ar || agent.name}
                                  {isNew(agent.created_at) && (
                                    <Badge className="bg-blue-500 text-[9px] px-1.5 py-0 gap-0.5">
                                      <Sparkles className="h-2.5 w-2.5" />
                                      جديد
                                    </Badge>
                                  )}
                                </div>
                                {agent.phone && <div className="text-xs text-muted-foreground">{agent.phone}</div>}
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-muted-foreground">{agent.email}</td>
                          <td className="p-3"><PlanBadge plan={agent.plan} /></td>
                          <td className="p-3">{renderStatus(agent)}</td>
                          <td className="p-3">
                            <div className="flex flex-col items-start gap-0.5">
                              <Badge variant="outline" className={cn("font-medium", chip.className)}>
                                {chip.label}
                              </Badge>
                              {agent.last_activity_at && (
                                <span className="text-[10px] text-muted-foreground ltr-nums">
                                  {format(new Date(agent.last_activity_at), "dd/MM/yyyy HH:mm")}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {agent.subscription_expires_at
                              ? format(new Date(agent.subscription_expires_at), "dd/MM/yyyy")
                              : "—"}
                          </td>
                          <td className="p-3"><PriceCell monthlyPrice={agent.monthly_price} billingCycle={agent.billing_cycle} /></td>
                        </tr>
                      );
                    })}
                    {visibleAgents.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-muted-foreground">
                          لا يوجد وكلاء
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </MainLayout>
  );
}

interface SummaryTileProps {
  tone: "default" | "success" | "amber" | "destructive";
  icon: typeof Building2;
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}

const TILE_TONE: Record<SummaryTileProps["tone"], { card: string; icon: string; value: string }> = {
  default: { card: "bg-muted/30 border-border", icon: "bg-muted text-foreground", value: "text-foreground" },
  success: { card: "bg-green-500/5 border-green-500/20", icon: "bg-green-500/10 text-green-600", value: "text-green-700 dark:text-green-300" },
  amber: { card: "bg-amber-500/5 border-amber-500/20", icon: "bg-amber-500/10 text-amber-600", value: "text-amber-700 dark:text-amber-300" },
  destructive: { card: "bg-red-500/5 border-red-500/20", icon: "bg-red-500/10 text-red-600", value: "text-red-700 dark:text-red-300" },
};

function SummaryTile({ tone, icon: Icon, label, value, active, onClick }: SummaryTileProps) {
  const t = TILE_TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "p-3 rounded-2xl border text-right transition-all hover:shadow-md",
        t.card,
        active && "ring-2 ring-offset-2 ring-offset-background ring-foreground/30 shadow-md",
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", t.icon)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground truncate">{label}</div>
          <div className={cn("text-lg font-bold ltr-nums", t.value)}>{value}</div>
        </div>
      </div>
    </button>
  );
}
