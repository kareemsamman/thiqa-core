import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ThiqaHeader } from "@/components/thiqa/ThiqaHeader";
import { PlanBadge, StatusBadge, planLabel, PriceCell } from "@/components/thiqa/labels";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Building2, AlertTriangle, CheckCircle, Clock, TrendingUp, LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";

type KpiTone = "primary" | "success" | "destructive" | "amber";

const KPI_TONE: Record<KpiTone, { card: string; iconBox: string; iconColor: string; value: string }> = {
  primary: {
    card: "bg-primary/5 border-primary/15",
    iconBox: "bg-primary/10",
    iconColor: "text-primary",
    value: "text-foreground",
  },
  success: {
    card: "bg-success/5 border-success/15",
    iconBox: "bg-success/10",
    iconColor: "text-success",
    value: "text-success",
  },
  destructive: {
    card: "bg-destructive/5 border-destructive/15",
    iconBox: "bg-destructive/10",
    iconColor: "text-destructive",
    value: "text-destructive",
  },
  amber: {
    card: "bg-amber-500/5 border-amber-500/15",
    iconBox: "bg-amber-500/10",
    iconColor: "text-amber-600 dark:text-amber-400",
    value: "text-amber-600 dark:text-amber-400",
  },
};

interface KpiTileProps {
  title: string;
  value: string;
  icon: LucideIcon;
  tone: KpiTone;
  badges?: { label: string }[];
  onClick?: () => void;
}

function KpiTile({ title, value, icon: Icon, tone, badges, onClick }: KpiTileProps) {
  const t = KPI_TONE[tone];
  return (
    <Card
      onClick={onClick}
      className={cn(
        "p-5 rounded-2xl border shadow-sm transition-all",
        t.card,
        onClick && "cursor-pointer hover:shadow-md",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 min-w-0">
          <p className="text-sm font-medium text-muted-foreground truncate">{title}</p>
          <p className={cn("text-2xl font-bold ltr-nums", t.value)}>{value}</p>
          {badges && badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {badges.map((b) => (
                <Badge key={b.label} variant="outline" className="text-[10px] bg-background/60">
                  {b.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className={cn("rounded-xl p-3 shrink-0", t.iconBox)}>
          <Icon className={cn("h-5 w-5", t.iconColor)} />
        </div>
      </div>
    </Card>
  );
}

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
}

interface Payment {
  id: string;
  agent_id: string;
  amount: number;
  payment_date: string;
  plan: string;
  notes: string | null;
  agents: { name: string; name_ar: string | null } | null;
}

export default function ThiqaDashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  // Cash collected this calendar month — sum of agent_subscription_payments
  // for the current month. Replaces the old MRR-style calculation
  // (sum of agents.monthly_price) which couldn't reflect the actual
  // money received from customers.
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);
  // plan_key → Arabic display name. Built from subscription_plans so
  // plans added through /thiqa/settings (e.g. custom "businesses")
  // show their real label instead of the raw English key.
  const [planNames, setPlanNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || !user) return;
    Promise.all([fetchAgents(), fetchRecentPayments(), fetchPlans(), fetchMonthlyRevenue()]).finally(() => setLoading(false));
  }, [authLoading, user]);

  const fetchAgents = async () => {
    const { data } = await supabase.from("agents").select("*").order("created_at", { ascending: false });
    if (data) setAgents(data as Agent[]);
  };

  const fetchRecentPayments = async () => {
    const { data } = await supabase
      .from("agent_subscription_payments")
      .select("*, agents(name, name_ar)")
      .order("payment_date", { ascending: false })
      .limit(10);
    if (data) setPayments(data as Payment[]);
  };

  const fetchMonthlyRevenue = async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const { data } = await supabase
      .from("agent_subscription_payments")
      .select("amount")
      .gte("payment_date", monthStart)
      .lte("payment_date", monthEnd);
    setMonthlyRevenue((data || []).reduce((sum, p: { amount: number }) => sum + Number(p.amount || 0), 0));
  };

  const fetchPlans = async () => {
    const { data } = await supabase
      .from("subscription_plans")
      .select("plan_key, name, name_ar");
    const map: Record<string, string> = {};
    (data || []).forEach((p: any) => {
      map[p.plan_key] = p.name_ar || p.name || p.plan_key;
    });
    setPlanNames(map);
  };

  const totalAgents = agents.length;
  const activeAgents = agents.filter(a => a.subscription_status === "active").length;
  const expiredAgents = agents.filter(a => a.subscription_status === "expired" || a.subscription_status === "suspended").length;
  // 30-day window — short enough that the panel surfaces only the
  // renewals admin actually needs to chase this month. Trial
  // subscriptions are included so lapsing onboardings show up
  // alongside paying ones.
  const expiringSoon = agents
    .filter(a => {
      if (a.subscription_status !== "active" && a.subscription_status !== "trial") return false;
      if (!a.subscription_expires_at) return false;
      const days = differenceInDays(new Date(a.subscription_expires_at), new Date());
      return days >= 0 && days <= 30;
    })
    .sort((a, b) =>
      new Date(a.subscription_expires_at!).getTime() - new Date(b.subscription_expires_at!).getTime(),
    );

  // Plan-tier breakdown for the totals card. Canonical tiers render
  // first in the order below; any custom plan keys added via
  // /thiqa/settings (e.g. "businesses") are appended after so they
  // aren't silently dropped from the breakdown.
  const PLAN_TIER_ORDER = ["ultimate", "professional", "pro", "basic", "entry", "free_trial"] as const;
  const planCounts = agents.reduce<Record<string, number>>((acc, a) => {
    const k = a.plan || "free_trial";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const knownKeys = PLAN_TIER_ORDER.filter(k => (planCounts[k] ?? 0) > 0);
  const customKeys = Object.keys(planCounts)
    .filter(k => !(PLAN_TIER_ORDER as readonly string[]).includes(k))
    .sort((a, b) => (planNames[a] || a).localeCompare(planNames[b] || b, "ar"));
  const planBreakdown = [...knownKeys, ...customKeys]
    .map(k => ({ label: `${planLabel(k, planNames[k])}: ${planCounts[k]}` }));

  if (loading) {
    return (
      <MainLayout>
        <div dir="rtl">
          <ThiqaHeader title="لوحة تحكم ثقة" subtitle="نظرة عامة على جميع الوكلاء والاشتراكات" />
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
            </div>
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div dir="rtl">
        <ThiqaHeader title="لوحة تحكم ثقة" subtitle="نظرة عامة على جميع الوكلاء والاشتراكات" />

        <div className="space-y-6">
        {/* KPI tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile
            title="إجمالي الوكلاء"
            value={totalAgents.toLocaleString("en-US")}
            icon={Building2}
            tone="primary"
            badges={planBreakdown}
            onClick={() => navigate("/thiqa/agents")}
          />
          <KpiTile
            title="وكلاء فعالين"
            value={activeAgents.toLocaleString("en-US")}
            icon={CheckCircle}
            tone="success"
          />
          <KpiTile
            title="منتهي / معلّق"
            value={expiredAgents.toLocaleString("en-US")}
            icon={AlertTriangle}
            tone="destructive"
          />
          <KpiTile
            title="الإيرادات الشهرية"
            value={`₪${monthlyRevenue.toLocaleString("en-US")}`}
            icon={TrendingUp}
            tone="amber"
          />
        </div>

        {/* Expiring Soon — 30-day window, includes trial subscriptions */}
        {expiringSoon.length > 0 && (
          <Card className="rounded-2xl border-amber-500/40 bg-amber-500/5 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <div className="h-8 w-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                  <Clock className="h-4 w-4" />
                </div>
                <span>اشتراكات تنتهي خلال 30 يوماً</span>
                <Badge variant="outline" className="bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-400 mr-1">
                  {expiringSoon.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {expiringSoon.map(agent => {
                  const daysLeft = differenceInDays(new Date(agent.subscription_expires_at!), new Date());
                  // Stay on the amber palette for the whole card so the
                  // day-counter chip doesn't read as a disconnected
                  // black pill. ≤7 escalates to red, ≤30 stays amber,
                  // beyond that fades to a soft outline.
                  const chipClass =
                    daysLeft <= 7
                      ? "bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-300"
                      : daysLeft <= 30
                        ? "bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300"
                        : "bg-background border-border text-muted-foreground";
                  return (
                    <div
                      key={agent.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-background/70 border border-amber-500/20 cursor-pointer hover:bg-background hover:border-amber-500/40 transition-all"
                      onClick={() => navigate(`/thiqa/agents/${agent.id}`)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{agent.name_ar || agent.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{agent.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground hidden sm:inline ltr-nums">
                          {format(new Date(agent.subscription_expires_at!), "dd/MM/yyyy")}
                        </span>
                        <Badge variant="outline" className={cn("font-medium", chipClass)}>
                          {daysLeft} يوم متبقي
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Two columns: Agents overview + Recent payments */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Agents subscription status */}
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">حالة اشتراك الوكلاء</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate("/thiqa/agents")}>عرض الكل</Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white dark:bg-card sticky top-0 z-10 border-b">
                    <tr>
                      <th className="text-right p-3 font-medium">الوكيل</th>
                      <th className="text-right p-3 font-medium">الخطة</th>
                      <th className="text-right p-3 font-medium">الحالة</th>
                      <th className="text-right p-3 font-medium">الانتهاء</th>
                      <th className="text-right p-3 font-medium">السعر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map(agent => (
                      <tr
                        key={agent.id}
                        className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => navigate(`/thiqa/agents/${agent.id}`)}
                      >
                        <td className="p-3 font-medium">{agent.name_ar || agent.name}</td>
                        <td className="p-3"><PlanBadge plan={agent.plan} displayName={planNames[agent.plan]} className="text-xs" /></td>
                        <td className="p-3"><StatusBadge status={agent.subscription_status} className="text-xs" /></td>
                        <td className="p-3 text-muted-foreground text-xs">
                          {agent.subscription_expires_at
                            ? format(new Date(agent.subscription_expires_at), "dd/MM/yyyy")
                            : "—"}
                        </td>
                        <td className="p-3"><PriceCell monthlyPrice={agent.monthly_price} billingCycle={agent.billing_cycle} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Recent payments */}
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">آخر المدفوعات</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate("/thiqa/payments")}>عرض الكل</Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[400px] overflow-auto">
                {payments.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">لا توجد مدفوعات مسجلة</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-white dark:bg-card sticky top-0 z-10 border-b">
                      <tr>
                        <th className="text-right p-3 font-medium">التاريخ</th>
                        <th className="text-right p-3 font-medium">الوكيل</th>
                        <th className="text-right p-3 font-medium">المبلغ</th>
                        <th className="text-right p-3 font-medium">الخطة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map(p => (
                        <tr key={p.id} className="border-t">
                          <td className="p-3 text-muted-foreground text-xs">
                            {format(new Date(p.payment_date), "dd/MM/yyyy")}
                          </td>
                          <td className="p-3 font-medium">{p.agents?.name_ar || p.agents?.name || "—"}</td>
                          <td className="p-3 font-medium text-green-600">₪{p.amount}</td>
                          <td className="p-3">
                            <Badge variant="outline" className="text-xs">{planLabel(p.plan, planNames[p.plan])}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
        </div>
      </div>
    </MainLayout>
  );
}
