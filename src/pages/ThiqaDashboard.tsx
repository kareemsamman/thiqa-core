import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { ThiqaHeader } from "@/components/thiqa/ThiqaHeader";
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
  const [loading, setLoading] = useState(true);
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || !user) return;
    Promise.all([fetchAgents(), fetchRecentPayments()]).finally(() => setLoading(false));
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

  const totalAgents = agents.length;
  const activeAgents = agents.filter(a => a.subscription_status === "active").length;
  const expiredAgents = agents.filter(a => a.subscription_status === "expired" || a.subscription_status === "suspended").length;
  const expiringWithin30 = agents.filter(a => {
    if (a.subscription_status !== "active" || !a.subscription_expires_at) return false;
    const days = differenceInDays(new Date(a.subscription_expires_at), new Date());
    return days >= 0 && days <= 30;
  });
  const totalMonthlyRevenue = agents
    .filter(a => a.subscription_status === "active" && (a.monthly_price ?? 0) > 0)
    .reduce((sum, a) => sum + (a.monthly_price ?? 0), 0);
  const proAgents = agents.filter(a => a.plan === "pro").length;
  const basicAgents = agents.filter(a => a.plan === "basic").length;

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
            badges={[{ label: `Pro: ${proAgents}` }, { label: `Basic: ${basicAgents}` }]}
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
            value={`₪${totalMonthlyRevenue.toLocaleString("en-US")}`}
            icon={TrendingUp}
            tone="amber"
          />
        </div>

        {/* Expiring Soon */}
        {expiringWithin30.length > 0 && (
          <Card className="rounded-2xl border-amber-500/40 bg-amber-500/5 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <Clock className="h-5 w-5" />
                اشتراكات تنتهي خلال 30 يوماً ({expiringWithin30.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {expiringWithin30.map(agent => {
                  const daysLeft = differenceInDays(new Date(agent.subscription_expires_at!), new Date());
                  return (
                    <div
                      key={agent.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-background/80 cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(`/thiqa/agents/${agent.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Building2 className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <span className="font-medium">{agent.name_ar || agent.name}</span>
                          <span className="text-xs text-muted-foreground mr-2">{agent.email}</span>
                        </div>
                      </div>
                      <Badge variant={daysLeft <= 7 ? "destructive" : "secondary"}>
                        {daysLeft} يوم متبقي
                      </Badge>
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
                      <th className="text-right p-3 font-medium">₪/شهر</th>
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
                        <td className="p-3">
                          <Badge variant={agent.plan === "pro" ? "default" : "outline"} className={agent.plan === "pro" ? "bg-primary" : ""}>
                            {agent.plan === "pro" ? "Pro" : "Basic"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {agent.subscription_status === "active" ? (
                            <Badge className="bg-green-600 text-xs">فعال</Badge>
                          ) : agent.subscription_status === "suspended" ? (
                            <Badge variant="destructive" className="text-xs">معلّق</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">منتهي</Badge>
                          )}
                        </td>
                        <td className="p-3 text-muted-foreground text-xs">
                          {agent.subscription_expires_at
                            ? format(new Date(agent.subscription_expires_at), "dd/MM/yyyy")
                            : "—"}
                        </td>
                        <td className="p-3 font-medium">
                          {(agent.monthly_price ?? 0) > 0 ? `₪${agent.monthly_price}` : "مجاني"}
                        </td>
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
                            <Badge variant="outline" className="text-xs">{p.plan}</Badge>
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
