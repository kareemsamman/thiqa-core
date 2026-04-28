import { useState, useEffect, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Crown, CreditCard, Calendar, Clock, AlertTriangle, Check, X, MessageCircle,
  Sparkles, ShieldCheck, Pause, Info, ArrowUp, ArrowDown,
  Rocket, Shield, Trash2, XCircle, Loader2, Settings, BarChart3, Receipt, UserCog, Plus, ChevronDown,
  ShoppingCart,
} from "lucide-react";
import { AddQuotaDialog, type OverageUsageType } from "@/components/subscription/AddQuotaDialog";
import { AgentPlanOverview, UsageRow } from "@/components/subscription/AgentPlanOverview";
import { SubscriptionKpiRow } from "@/components/subscription/SubscriptionKpiRow";
import { useAgentLimits } from "@/hooks/useAgentLimits";
import { PlanLadder } from "@/components/pricing/PlanLadder";
import { format } from "date-fns";
import { toast } from "sonner";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";

interface PlanData {
  id: string;
  plan_key: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  monthly_price: number;
  yearly_price: number;
  badge: string | null;
  features: { text: string; info?: boolean }[];
  sort_order: number;
}

interface PaymentRecord {
  id: string;
  amount: number;
  plan: string;
  payment_date: string;
  notes: string | null;
  created_at: string;
  receipt_url: string | null;
}

interface UnbilledOverage {
  id: string;
  usage_type: "sms" | "ai_chat";
  extra_count: number;
  unit_price: number;
  total_amount: number;
  created_at: string;
}

const PLAN_ICONS: Record<string, typeof Rocket> = {
  starter: Shield,
  basic: Shield,
  pro: Rocket,
  custom: Crown,
};

function UsageStatsSection({ agentId }: { agentId: string | null }) {
  const planLimits = useAgentLimits();
  const { hasFeature } = useAgentContext();
  const [limits, setLimits] = useState<any>(null);
  const [usage, setUsage] = useState<any[]>([]);
  const [wallet, setWallet] = useState<{ sms_credit_balance: number; ai_credit_balance: number }>({
    sms_credit_balance: 0,
    ai_credit_balance: 0,
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [quotaDialogType, setQuotaDialogType] = useState<OverageUsageType | null>(null);

  useEffect(() => {
    if (!agentId) return;
    (async () => {
      const [limitsRes, usageRes, platformRes, walletRes] = await Promise.all([
        supabase.from("agent_usage_limits" as any).select("*").eq("agent_id", agentId).maybeSingle(),
        supabase.from("agent_usage_log" as any).select("*").eq("agent_id", agentId).order("period", { ascending: false }).limit(12),
        supabase
          .from("thiqa_platform_settings" as any)
          .select("setting_key, setting_value")
          .in("setting_key", [
            "default_sms_limit_type",
            "default_sms_limit_count",
            "default_ai_limit_type",
            "default_ai_limit_count",
          ]),
        supabase
          .from("agent_credit_wallet" as any)
          .select("sms_credit_balance, ai_credit_balance")
          .eq("agent_id", agentId)
          .maybeSingle(),
      ]);

      // Build platform defaults map
      const platformMap: Record<string, string> = {};
      ((platformRes.data as any) || []).forEach((r: any) => {
        platformMap[r.setting_key] = r.setting_value || "";
      });
      const platformDefaults = {
        sms_limit_type: platformMap.default_sms_limit_type || "monthly",
        sms_limit_count: parseInt(platformMap.default_sms_limit_count || "100", 10),
        ai_limit_type: platformMap.default_ai_limit_type || "monthly",
        ai_limit_count: parseInt(platformMap.default_ai_limit_count || "100", 10),
      };

      setLimits(limitsRes.data || platformDefaults);
      setUsage((usageRes.data as any) || []);
      setWallet({
        sms_credit_balance: (walletRes.data as any)?.sms_credit_balance ?? 0,
        ai_credit_balance: (walletRes.data as any)?.ai_credit_balance ?? 0,
      });
    })();
  }, [agentId, reloadToken]);

  if (!limits) return null;

  const creditButton = (type: OverageUsageType, label: string) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-6 px-2 gap-1 text-[11px]"
      onClick={() => setQuotaDialogType(type)}
    >
      <Plus className="h-3 w-3" />
      {label}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          استخدام الخدمات
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          لكل حساب حد شهري مجاني يتجدد كل شهر. عند استنفاده يمكنك شحن رصيد إضافي يبقى معك ولا ينتهي حتى تستخدمه كاملاً.
        </p>
      </div>

      {/* Unified usage bars — moved here from the Plan tab so every
          resource (users / branches / policies / SMS / marketing SMS /
          AI) sits in one place. SMS and AI rows get an inline "buy
          credit" button so the agent can top up without leaving the
          tab. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">استخدامك الحالي</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {planLimits.loading ? (
            <>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </>
          ) : (
            <>
              <UsageRow label="المستخدمين" limit={planLimits.users} />
              <UsageRow label="الفروع" limit={planLimits.branches} />
              <UsageRow
                label={`المعاملات (${
                  planLimits.policyPeriod === 'monthly'
                    ? 'هذا الشهر'
                    : planLimits.policyPeriod === 'yearly'
                    ? 'هذه السنة'
                    : 'إجمالي'
                })`}
                limit={planLimits.policies}
              />
              <UsageRow
                label="رسائل SMS (هذا الشهر)"
                limit={planLimits.sms}
                action={hasFeature('sms') ? creditButton('sms', 'شحن SMS') : undefined}
              />
              <UsageRow label="SMS تسويقية (هذا الشهر)" limit={planLimits.marketingSms} />
              <UsageRow
                label="طلبات AI (هذا الشهر)"
                limit={planLimits.ai}
                action={hasFeature('ai_assistant') ? creditButton('ai_chat', 'شحن AI') : undefined}
              />
            </>
          )}
        </CardContent>
      </Card>

      {quotaDialogType && (
        <AddQuotaDialog
          open={!!quotaDialogType}
          onOpenChange={(open) => { if (!open) setQuotaDialogType(null); }}
          usageType={quotaDialogType}
          onPurchased={() => { setReloadToken((t) => t + 1); planLimits.refetch(); }}
        />
      )}
    </div>
  );
}

export default function Subscription() {
  const { isAdmin } = useAuth();
  const { agent, agentId } = useAgentContext();
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [unbilledOverages, setUnbilledOverages] = useState<UnbilledOverage[]>([]);
  // Active monthly addons (extra_user, extra_branch, extra_ai, extra_sms,
  // extra_marketing_sms). One-time addons aren't billed recurrently so
  // they shouldn't show in the "next bill" preview. The next-bill card
  // multiplies quantity × unit_price and adds them to the running total.
  const [activeAddons, setActiveAddons] = useState<Array<{
    id: string;
    addon_type: string;
    quantity: number;
    unit_price: number;
  }>>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [changingPlan, setChangingPlan] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: "upgrade" | "downgrade" | "cancel";
    plan?: PlanData;
  } | null>(null);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingPlans(true);
      try {
        const { data } = await supabase
          .from("subscription_plans")
          .select("id, plan_key, name, name_ar, description, monthly_price, yearly_price, badge, features, sort_order")
          .eq("is_active", true)
          .neq("plan_key", "free_trial")
          .order("sort_order");
        if (data && data.length > 0) {
          setPlans(data.map((p: any) => ({
            ...p,
            features: (typeof p.features === "string" ? JSON.parse(p.features) : p.features) || [],
          })));
        }
      } catch { /* silent */ } finally { setLoadingPlans(false); }
    })();
  }, []);

  useEffect(() => {
    if (!agentId) return;
    (async () => {
      setLoadingPayments(true);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [paymentsRes, overagesRes, addonsRes] = await Promise.all([
          supabase
            .from("agent_subscription_payments")
            .select("id, amount, plan, payment_date, notes, created_at, receipt_url")
            .eq("agent_id", agentId)
            .order("payment_date", { ascending: false })
            .limit(50),
          supabase
            .from("agent_usage_overages" as any)
            .select("id, usage_type, extra_count, unit_price, total_amount, created_at")
            .eq("agent_id", agentId)
            .eq("billed", false)
            .order("created_at", { ascending: false }),
          // Active monthly addons that will recur on the next bill.
          // One-time addons (onboarding, data_migration) are filtered
          // out — those are charged on the bill they were approved
          // against, not on every cycle.
          supabase
            .from("agent_addons")
            .select("id, addon_type, quantity, unit_price")
            .eq("agent_id", agentId)
            .eq("status", "active")
            .eq("billing_cycle", "monthly")
            .lte("starts_at", today)
            .or(`ends_at.is.null,ends_at.gte.${today}`),
        ]);
        if (paymentsRes.data) setPayments(paymentsRes.data);
        if (overagesRes.data) setUnbilledOverages(overagesRes.data as any);
        if (addonsRes.data) setActiveAddons(addonsRes.data as any);
      } catch { /* silent */ } finally { setLoadingPayments(false); }
    })();
  }, [agentId]);

  // Tick state — forces the trial countdown to recalculate every minute
  // so users see a live "X days Y hours" readout instead of a stale one.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const sub = useMemo(() => {
    if (!agent) return null;
    const status = agent.subscription_status;
    const isTrial = status === "trial" || (agent.monthly_price === 0 && status === "active");
    const trialEnd = agent.trial_ends_at ? new Date(agent.trial_ends_at) : (isTrial && agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null);
    const expiresAt = agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null;
    const endDate = isTrial ? trialEnd : expiresAt;
    const now = new Date(nowTick);
    const msRemaining = endDate ? Math.max(0, endDate.getTime() - now.getTime()) : 0;
    // Use floor so "35 days 2 hours" doesn't round up to 36.
    const daysRemaining = endDate ? Math.floor(msRemaining / 86400000) : null;
    const hoursRemaining = endDate ? Math.floor((msRemaining % 86400000) / 3600000) : 0;
    const minutesRemaining = endDate ? Math.floor((msRemaining % 3600000) / 60000) : 0;
    const isExpired = endDate ? endDate.getTime() <= now.getTime() : false;
    const isActive = (status === "active" || status === "trial") && !isExpired;
    const isPaused = status === "paused" || status === "suspended";
    const isCancelled = status === "cancelled";
    const trialProgress = isTrial && daysRemaining !== null
      ? Math.min(100, Math.max(0, ((35 * 86400000 - msRemaining) / (35 * 86400000)) * 100))
      : 0;
    return {
      isTrial,
      trialEnd,
      expiresAt: endDate,
      daysRemaining,
      hoursRemaining,
      minutesRemaining,
      isExpired,
      isActive,
      isPaused,
      isCancelled,
      trialProgress,
    };
  }, [agent, nowTick]);

  const handlePlanChange = async (targetPlan: PlanData) => {
    if (!agent || !agentId) return;
    setChangingPlan(true);
    try {
      // Always switch immediately. The sync_agent_plan_transition trigger
      // handles the trial → paid cascade (status, monthly_price,
      // trial_ends_at, subscription_started_at/expires_at) when `plan` updates.
      const isUpgrade = targetPlan.monthly_price > (agent.monthly_price || 0);
      const { error } = await supabase.from("agents").update({
        plan: targetPlan.plan_key,
        monthly_price: targetPlan.monthly_price,
      }).eq("id", agentId);
      if (error) throw error;
      toast.success(sub?.isTrial
        ? `تم تفعيل خطة ${targetPlan.name} فوراً.`
        : isUpgrade
          ? `تمت الترقية إلى خطة ${targetPlan.name} بنجاح!`
          : `تم التحويل إلى خطة ${targetPlan.name}.`
      );
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message || "فشل في تغيير الخطة");
    } finally {
      setChangingPlan(false);
      setConfirmDialog(null);
    }
  };

  const handleCancelSubscription = async () => {
    if (!agentId) return;
    setChangingPlan(true);
    try {
      const { error } = await supabase.from("agents").update({
        subscription_status: "cancelled",
        cancelled_at: new Date().toISOString(),
      }).eq("id", agentId);
      if (error) throw error;
      toast.success("تم إلغاء الاشتراك.");
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message || "فشل في إلغاء الاشتراك");
    } finally {
      setChangingPlan(false);
      setConfirmDialog(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!agentId) return;
    setDeletingAccount(true);
    try {
      const { error } = await supabase.functions.invoke("delete-agent", { body: { agentId } });
      if (error) throw error;
      toast.success("تم حذف الحساب بنجاح.");
      await supabase.auth.signOut();
      window.location.href = "/login";
    } catch (e: any) {
      toast.error(e.message || "فشل في حذف الحساب");
      setDeletingAccount(false);
      setDeleteDialog(false);
    }
  };

  if (!agent) return null;

  // Workers should never see plan/billing/usage data — that's
  // admin-only. Render a friendly "talk to your admin" view.
  // PermissionRoute redirects permission-denied users here, so we
  // can't just block the route; we have to gate the content.
  if (!isAdmin) {
    return (
      <MainLayout>
        <Header title="الإعدادات" subtitle="" />
        <div className="md:p-6 max-w-xl mx-auto" dir="rtl">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg">الإعدادات والاشتراك</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    إدارة الاشتراك والإعدادات متاحة لمدير الوكالة فقط
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">
                إذا كنت تحتاج إلى صلاحية إضافية أو معلومات عن باقة الاشتراك،
                يرجى التواصل مع مدير الوكالة لديك.
              </p>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  // For trial users, find the Pro plan to compare features when picking Basic
  const proPlan = plans.find(p => p.plan_key === "pro");
  const confirmPlan = confirmDialog?.plan;
  const isDowngradeFromTrial = sub?.isTrial && confirmPlan && confirmPlan.plan_key !== "pro";

  return (
    <MainLayout>
      <Header title="الإعدادات" subtitle="اشتراكك، استخدامك للخدمات، ومدفوعاتك السابقة" />
      <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto" dir="rtl">
        {/* In-page header: icon + title + contact button */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">الإعدادات</h1>
              <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">
                اشتراكك، استخدامك للخدمات، ومدفوعاتك السابقة
              </p>
            </div>
          </div>
          <a href="https://wa.me/972525143581" target="_blank" rel="noopener noreferrer" className="shrink-0">
            <Button variant="outline" size="sm" className="gap-2">
              <MessageCircle className="h-4 w-4" />
              <span className="hidden sm:inline">تواصل مع إدارة ثقة</span>
              <span className="sm:hidden">المساعدة</span>
            </Button>
          </a>
        </div>

        {/* KPI cards row — the trial/period state, plan price, and
            active addons total surface above the tabs so the agent
            sees their subscription health at a glance regardless of
            which tab they're on. */}
        <SubscriptionKpiRow nowTick={nowTick} />

        {/* Tabs */}
        <Tabs defaultValue="plan" dir="rtl" className="w-full">
          <TabsList className="w-full h-auto flex flex-wrap justify-start gap-1.5 bg-muted/40 p-1.5 rounded-xl border">
            <TabsTrigger
              value="plan"
              className="gap-2 shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md"
            >
              <Crown className="h-4 w-4" />
              الخطة والاشتراك
            </TabsTrigger>
            <TabsTrigger
              value="extras"
              className="gap-2 shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md"
            >
              <ShoppingCart className="h-4 w-4" />
              الإضافات
            </TabsTrigger>
            <TabsTrigger
              value="usage"
              className="gap-2 shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md"
            >
              <BarChart3 className="h-4 w-4" />
              الاستخدام
            </TabsTrigger>
            <TabsTrigger
              value="payments"
              className="gap-2 shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md"
            >
              <Receipt className="h-4 w-4" />
              المدفوعات
              {payments.length > 0 && (
                <span className="text-[10px] font-bold rounded-full bg-primary/10 text-primary px-2 py-0.5">
                  {payments.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="account"
              className="gap-2 shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md"
            >
              <UserCog className="h-4 w-4" />
              الحساب
            </TabsTrigger>
          </TabsList>

          <TabsContent value="plan" className="mt-5 space-y-5">

        {/* ═══ Current Status Card ═══ */}
        {!sub ? <Skeleton className="h-48 w-full rounded-xl" /> : (
          <Card className="overflow-hidden shadow-sm">
            <div className={cn("h-1 w-full",
              sub.isPaused ? "bg-yellow-500" :
              sub.isExpired || sub.isCancelled ? "bg-destructive" :
              "bg-primary"
            )} />
            <CardContent className="p-5 md:p-6">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
                <div className="space-y-4 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center",
                      sub.isTrial ? "bg-primary/10 text-primary" :
                      sub.isPaused ? "bg-yellow-100 text-yellow-600" :
                      sub.isExpired || sub.isCancelled ? "bg-destructive/10 text-destructive" :
                      "bg-primary/10 text-primary"
                    )}>
                      {sub.isTrial ? <Sparkles className="h-5 w-5" /> :
                       sub.isPaused ? <Pause className="h-5 w-5" /> :
                       sub.isExpired || sub.isCancelled ? <AlertTriangle className="h-5 w-5" /> :
                       <ShieldCheck className="h-5 w-5" />}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">
                        {sub.isTrial ? "فترة تجريبية مجانية" :
                         sub.isCancelled ? "اشتراك ملغي" :
                         `خطة ${agent.plan === "pro" ? "Pro" : agent.plan === "basic" ? "Basic" : agent.plan}`}
                      </h2>
                      <Badge variant="outline" className={cn("text-[10px] mt-0.5",
                        sub.isTrial ? "border-primary text-primary" :
                        sub.isPaused ? "border-yellow-500 text-yellow-600" :
                        sub.isExpired || sub.isCancelled ? "border-destructive text-destructive" :
                        "border-green-600 text-green-600"
                      )}>
                        {sub.isTrial ? "جميع ميزات Pro متاحة" :
                         sub.isPaused ? "معلّق" :
                         sub.isExpired ? "منتهي" :
                         sub.isCancelled ? "ملغي" : "فعال"}
                      </Badge>
                    </div>
                  </div>

                  {/* Trial progress — full width, live countdown */}
                  {sub.isTrial && sub.daysRemaining !== null && (
                    <div className="space-y-3 w-full">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-xs text-muted-foreground">الفترة التجريبية</p>
                          <p className={cn("text-base font-bold mt-0.5", sub.daysRemaining <= 7 ? "text-destructive" : "text-primary")}>
                            متبقي {sub.daysRemaining} يوم
                            <span className="text-xs font-medium text-muted-foreground mr-2">
                              و {sub.hoursRemaining} ساعة و {sub.minutesRemaining} دقيقة
                            </span>
                          </p>
                        </div>
                        {sub.trialEnd && (
                          <div className="text-left">
                            <p className="text-[10px] text-muted-foreground">تنتهي في</p>
                            <p className="text-xs font-semibold tabular-nums">
                              {format(sub.trialEnd, "dd/MM/yyyy HH:mm")}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500",
                            sub.daysRemaining <= 7 ? "bg-destructive" : "bg-primary"
                          )}
                          style={{ width: `${sub.trialProgress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>اليوم 0</span>
                        <span className="font-medium">{Math.round(sub.trialProgress)}% منتهية</span>
                        <span>اليوم 35</span>
                      </div>
                    </div>
                  )}

                  {sub.isPaused && (
                    <div className="flex items-start gap-2 text-sm text-yellow-700 bg-yellow-50 rounded-lg p-3">
                      <Pause className="h-4 w-4 mt-0.5 shrink-0" />
                      حسابك معلّق. تواصل مع إدارة ثقة لإعادة التفعيل.
                    </div>
                  )}

                  {/* Stats for paid plans */}
                  {!sub.isTrial && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><CreditCard className="h-3.5 w-3.5" />السعر الشهري</p>
                        <p className="text-lg font-bold">₪{agent.monthly_price?.toLocaleString() ?? 0}</p>
                      </div>
                      {sub.expiresAt && (
                        <div className="space-y-0.5">
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />تاريخ الانتهاء</p>
                          <p className="text-lg font-bold">{format(sub.expiresAt, "dd/MM/yyyy")}</p>
                        </div>
                      )}
                      {sub.daysRemaining !== null && !sub.isExpired && (
                        <div className="space-y-0.5">
                          <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5" />الأيام المتبقية</p>
                          <p className={cn("text-lg font-bold", sub.daysRemaining <= 7 && "text-destructive")}>{sub.daysRemaining} يوم</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ═══ Plans Section ═══ Rendered by the shared PlanLadder so the
            four-card grid + "current plan" highlight + confirmation flow
            (with prorated billing + support email) stay identical to the
            upgrade popup. */}
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold">
              {sub?.isTrial ? "اختر خطتك" : "الخطط المتاحة"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {sub?.isTrial
                ? "اختيارك يُفعِّل الحزمة فوراً وينهي الفترة التجريبية."
                : "قارن بين الحزم واختر ما يناسب احتياجاتك."}
            </p>
          </div>
          <PlanLadder />
        </div>

          </TabsContent>

          {/* ═══ Extras Tab ═══ Active addons + buy-more catalog. Both
              sections share the AgentPlanOverview component so the
              purchase dialog + pending-approval state stay in one place. */}
          <TabsContent value="extras" className="mt-5 space-y-5">
            <AgentPlanOverview sections={['active-addons', 'catalog']} />
          </TabsContent>

          {/* ═══ Usage Tab ═══ */}
          <TabsContent value="usage" className="mt-5 space-y-5">
            <UsageStatsSection agentId={agentId} />
          </TabsContent>

          {/* ═══ Payments Tab ═══ */}
          <TabsContent value="payments" className="mt-5 space-y-5">
            {/* Next billing summary — paid agents only. Trial agents have
                no recurring billing scheduled (the trial → paid switch is
                immediate, not deferred), so the card stays hidden until
                they actually activate a plan. */}
            {(() => {
              const billingPlanKey = agent.plan;
              const billingPlan = plans.find(p => p.plan_key === billingPlanKey);
              const basePrice = agent.monthly_price || 0;

              // Nothing useful to show if we can't resolve any base price
              // (e.g. custom plan awaiting quote). Hide the card entirely.
              if (basePrice <= 0 && unbilledOverages.length === 0 && activeAddons.length === 0) return null;

              const extrasTotal = unbilledOverages.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
              // Recurring monthly addons. Each row's quantity × unit_price
              // is added to the next bill — without this the breakdown
              // dropped extras like "extra_user (₪30/month)" from both
              // the running total and the row list.
              const addonsMonthlyTotal = activeAddons.reduce(
                (sum, a) => sum + (Number(a.quantity) || 0) * (Number(a.unit_price) || 0),
                0,
              );
              const nextTotal = basePrice + extrasTotal + addonsMonthlyTotal;
              const smsExtras = unbilledOverages.filter(o => o.usage_type === 'sms');
              const aiExtras = unbilledOverages.filter(o => o.usage_type === 'ai_chat');
              const smsCount = smsExtras.reduce((s, o) => s + o.extra_count, 0);
              const smsTotal = smsExtras.reduce((s, o) => s + Number(o.total_amount), 0);
              const aiCount = aiExtras.reduce((s, o) => s + o.extra_count, 0);
              const aiTotal = aiExtras.reduce((s, o) => s + Number(o.total_amount), 0);

              // Arabic labels for the addon row — mirrors LABEL_AR in the
              // request-addon-purchase edge function so requests, the
              // /thiqa admin view, and this preview all read the same.
              const addonLabel = (type: string): string => {
                switch (type) {
                  case 'extra_user':         return 'مستخدم إضافي';
                  case 'extra_branch':       return 'فرع إضافي';
                  case 'extra_ai':           return 'باقة AI';
                  case 'extra_sms':          return 'باقة SMS';
                  case 'extra_marketing_sms':return 'باقة SMS تسويقية';
                  default:                   return type;
                }
              };

              const subtitle = "تفاصيل ما سيُحسب عليك في الفاتورة القادمة";

              // The date we expect the agent to be charged on: trial end for
              // trial agents, otherwise the subscription expiry (end of the
              // current billing cycle).
              const billingDate: Date | null = sub?.isTrial
                ? (sub.trialEnd ?? null)
                : (sub?.expiresAt ?? (agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null));

              // Arabic month names so we don't have to add a date-fns locale
              // dependency just for this one display.
              const arabicMonths = [
                "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
                "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
              ];
              const formatBillingDate = (d: Date) =>
                `${d.getDate()} ${arabicMonths[d.getMonth()]} ${d.getFullYear()}`;

              // Days until the billing date.
              const daysUntilBilling = billingDate
                ? Math.max(0, Math.ceil((billingDate.getTime() - Date.now()) / 86400000))
                : null;

              return (
                <Card className="overflow-hidden shadow-sm border-primary/20">
                  <div className="h-1 w-full bg-primary" />
                  <CardContent className="p-5 md:p-6 space-y-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                          <CreditCard className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold">
                            {sub?.isTrial ? "فاتورتك الأولى المتوقعة" : "الفاتورة القادمة"}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
                            {subtitle}
                          </p>
                        </div>
                      </div>
                      <div className="text-left">
                        <p className="text-[10px] text-muted-foreground">
                          {sub?.isTrial ? "الإجمالي التقديري" : "الإجمالي المتوقع"}
                        </p>
                        <p className="text-3xl font-bold text-primary tabular-nums">
                          ₪{nextTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    {/* Hero billing date — big and prominent so the agent
                        knows exactly when they'll be charged. */}
                    {billingDate && (
                      <div className="rounded-2xl bg-gradient-to-l from-primary/10 via-primary/5 to-transparent border border-primary/15 p-4 sm:p-5">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-lg shadow-primary/20">
                              <Calendar className="h-6 w-6" />
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                                {sub?.isTrial ? "تاريخ أول فاتورة" : "تاريخ الفاتورة القادمة"}
                              </p>
                              <p className="text-2xl sm:text-3xl font-extrabold text-foreground mt-0.5">
                                {formatBillingDate(billingDate)}
                              </p>
                            </div>
                          </div>
                          {daysUntilBilling !== null && (
                            <div className="text-left shrink-0">
                              <p className="text-[11px] text-muted-foreground">متبقي</p>
                              <p className={cn(
                                "text-xl sm:text-2xl font-bold tabular-nums",
                                daysUntilBilling <= 7 ? "text-destructive" :
                                daysUntilBilling <= 14 ? "text-amber-600" :
                                "text-primary"
                              )}>
                                {daysUntilBilling} {daysUntilBilling === 1 ? "يوم" : "يوم"}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2.5">
                      {/* Base plan row */}
                      <div className="flex items-center justify-between py-2.5 border-b">
                        <div className="flex items-center gap-2">
                          <Crown className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">
                              خطة {billingPlan?.name || (billingPlanKey === "pro" ? "Pro" : billingPlanKey === "basic" ? "Basic" : billingPlanKey)}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {sub?.isTrial ? "اشتراك شهري — يبدأ بعد انتهاء التجربة" : "اشتراك شهري"}
                            </p>
                          </div>
                        </div>
                        <span className="font-semibold tabular-nums">
                          ₪{basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>

                      {/* Recurring monthly addons. One row per active
                          addon so the agent can see exactly what each
                          extra contributes (e.g., extra_user × 1 = ₪30). */}
                      {activeAddons.map((a) => {
                        const lineTotal = Number(a.quantity) * Number(a.unit_price);
                        return (
                          <div key={a.id} className="flex items-center justify-between py-2.5 border-b">
                            <div className="flex items-center gap-2">
                              <Plus className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <p className="text-sm font-medium">{addonLabel(a.addon_type)}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {a.quantity} × ₪{Number(a.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / شهر
                                </p>
                              </div>
                            </div>
                            <span className="font-semibold tabular-nums">
                              +₪{lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        );
                      })}

                      {/* SMS overage row */}
                      {smsCount > 0 && (
                        <div className="flex items-center justify-between py-2.5 border-b">
                          <div className="flex items-center gap-2">
                            <MessageCircle className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">رصيد SMS إضافي</p>
                              <p className="text-[10px] text-muted-foreground">
                                {smsCount.toLocaleString()} رسالة مضافة هذا الشهر
                              </p>
                            </div>
                          </div>
                          <span className="font-semibold tabular-nums">
                            +₪{smsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}

                      {/* AI overage row */}
                      {aiCount > 0 && (
                        <div className="flex items-center justify-between py-2.5 border-b">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">رصيد المساعد الذكي إضافي</p>
                              <p className="text-[10px] text-muted-foreground">
                                {aiCount.toLocaleString()} محادثة مضافة هذا الشهر
                              </p>
                            </div>
                          </div>
                          <span className="font-semibold tabular-nums">
                            +₪{aiTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}

                      {/* Final total */}
                      <div className="flex items-center justify-between pt-3">
                        <span className="text-base font-bold">الإجمالي</span>
                        <span className="text-xl font-bold tabular-nums text-primary">
                          ₪{nextTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    {/* Per-purchase details, collapsed below a header */}
                    {unbilledOverages.length > 0 && (
                      <details className="group rounded-lg border bg-muted/20 p-3">
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground flex items-center justify-between">
                          <span>تفاصيل عمليات الشراء ({unbilledOverages.length})</span>
                          <ChevronDown className="h-3.5 w-3.5 group-open:rotate-180 transition-transform" />
                        </summary>
                        <div className="mt-3 space-y-2">
                          {unbilledOverages.map((o) => (
                            <div
                              key={o.id}
                              className="flex items-center justify-between text-xs py-2 border-b last:border-0"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {o.usage_type === 'sms' ? (
                                  <MessageCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                ) : (
                                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                )}
                                <span className="truncate">
                                  +{o.extra_count.toLocaleString()} {o.usage_type === 'sms' ? 'رسالة' : 'محادثة'}
                                </span>
                                <span className="text-muted-foreground">
                                  ({format(new Date(o.created_at), "dd/MM")})
                                </span>
                              </div>
                              <div className="text-muted-foreground tabular-nums shrink-0">
                                {o.extra_count} × ₪{Number(o.unit_price).toFixed(2)}
                                <span className="mr-2 font-semibold text-foreground">
                                  = ₪{Number(o.total_amount).toFixed(2)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-3">
                      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>
                        هذه التفاصيل أولية. إدارة ثقة تصدر الفاتورة النهائية وتسجّلها في سجل المدفوعات أدناه.
                        للاستفسار عن الدفع تواصل مع الإدارة.
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Payment history — recorded by super admin */}
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-primary" />
                  سجل المدفوعات
                </h2>
                <p className="text-xs text-muted-foreground mt-1">جميع المدفوعات التي سجّلتها إدارة ثقة على حسابك</p>
              </div>

              {loadingPayments ? (
                <Skeleton className="h-40 w-full rounded-xl" />
              ) : payments.length === 0 ? (
                <Card className="shadow-sm">
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">لا توجد مدفوعات مسجلة</p>
                    <p className="text-xs mt-1">ستظهر مدفوعاتك هنا عند تسجيلها من قبل إدارة ثقة</p>
                  </CardContent>
                </Card>
              ) : (
                <Card className="shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-right p-3 font-medium text-muted-foreground">تاريخ الدفع</th>
                          <th className="text-right p-3 font-medium text-muted-foreground">المبلغ</th>
                          <th className="text-right p-3 font-medium text-muted-foreground">الخطة</th>
                          <th className="text-right p-3 font-medium text-muted-foreground">ملاحظات</th>
                          <th className="text-right p-3 font-medium text-muted-foreground w-24">الإيصال</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map(p => (
                          <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="p-3">{format(new Date(p.payment_date), "dd/MM/yyyy")}</td>
                            <td className="p-3 font-semibold">₪{p.amount?.toLocaleString()}</td>
                            <td className="p-3"><Badge variant="secondary" className="text-xs">{p.plan}</Badge></td>
                            <td className="p-3 text-muted-foreground text-xs truncate max-w-[200px]">{p.notes || "—"}</td>
                            <td className="p-3">
                              {p.receipt_url ? (
                                <a
                                  href={p.receipt_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline text-xs inline-flex items-center gap-1"
                                >
                                  <Receipt className="h-3.5 w-3.5" />
                                  تحميل
                                </a>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ═══ Account Tab ═══ */}
          <TabsContent value="account" className="mt-5 space-y-5">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                <UserCog className="h-5 w-5 text-primary" />
                إعدادات الحساب
              </h2>
              <p className="text-xs text-muted-foreground mt-1">إدارة حالة حسابك ومعلومات التواصل مع الدعم</p>
            </div>

            {/* Support card */}
            <Card className="shadow-sm">
              <CardContent className="py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <MessageCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold">الدعم والمساعدة</h3>
                    <p className="text-xs text-muted-foreground mt-1">للاستفسارات وتغييرات الخطة، تواصل مع إدارة ثقة</p>
                  </div>
                </div>
                <a href="https://wa.me/972525143581" target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <Button variant="outline" className="gap-2">
                    <MessageCircle className="h-4 w-4" />
                    تواصل معنا
                  </Button>
                </a>
              </CardContent>
            </Card>

            {/* Danger zone — admin only */}
            {isAdmin && (
              <Card className="border border-destructive/30 shadow-sm">
                <CardContent className="py-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-destructive">منطقة الخطر</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        هذه الإجراءات نهائية ولا يمكن التراجع عنها. راجع قبل المتابعة.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap pt-2 border-t">
                    {sub?.isActive && !sub.isCancelled && !sub.isTrial && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-yellow-600 border-yellow-300 hover:bg-yellow-50"
                        onClick={() => setConfirmDialog({ type: "cancel" })}
                      >
                        <Pause className="h-3.5 w-3.5 ml-1" />
                        إلغاء الاشتراك
                      </Button>
                    )}
                    <Button variant="destructive" size="sm" onClick={() => setDeleteDialog(true)}>
                      <Trash2 className="h-3.5 w-3.5 ml-1" />
                      حذف الحساب نهائياً
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* ═══ Confirm Dialog ═══ */}
        <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
          <DialogContent dir="rtl" className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {confirmDialog?.type === "upgrade" && "تأكيد اختيار الخطة"}
                {confirmDialog?.type === "downgrade" && "تأكيد تغيير الخطة"}
                {confirmDialog?.type === "cancel" && "تأكيد إلغاء الاشتراك"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {confirmDialog?.type === "cancel" && (
                <p className="text-sm text-muted-foreground">
                  هل أنت متأكد من إلغاء اشتراكك؟ ستفقد الوصول للنظام. يمكنك إعادة الاشتراك لاحقاً.
                </p>
              )}

              {confirmDialog?.plan && sub?.isTrial && (
                <p className="text-sm text-muted-foreground">
                  سيتم تفعيل خطة <strong>{confirmDialog.plan.name}</strong> (₪{confirmDialog.plan.monthly_price}/شهر) بعد انتهاء الفترة التجريبية.
                </p>
              )}

              {confirmDialog?.plan && !sub?.isTrial && (
                <p className="text-sm text-muted-foreground">
                  {confirmDialog.type === "upgrade"
                    ? <>سيتم ترقيتك إلى <strong>{confirmDialog.plan.name}</strong> (₪{confirmDialog.plan.monthly_price}/شهر) فوراً. الفرق يُحسب في الفاتورة القادمة.</>
                    : <>سيتم تحويلك إلى <strong>{confirmDialog.plan.name}</strong> (₪{confirmDialog.plan.monthly_price}/شهر) فوراً. لا يتم استرجاع أيام الخطة السابقة.</>}
                </p>
              )}

              {/* Comparison table when trial user picks a non-Pro plan */}
              {isDowngradeFromTrial && proPlan && confirmPlan && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-muted px-4 py-2 text-sm font-bold text-center">
                    مقارنة الميزات
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-right p-2.5 font-medium text-muted-foreground">الميزة</th>
                        <th className="text-center p-2.5 font-medium w-24">
                          <span className="text-primary">{confirmPlan.name}</span>
                        </th>
                        <th className="text-center p-2.5 font-medium w-24">
                          <span className="text-muted-foreground">Pro</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Merge features from both plans */}
                      {(() => {
                        const allFeatures = new Set<string>();
                        confirmPlan.features.forEach(f => allFeatures.add(f.text));
                        proPlan.features.forEach(f => allFeatures.add(f.text));
                        const basicFeatureTexts = new Set(confirmPlan.features.map(f => f.text));
                        const proFeatureTexts = new Set(proPlan.features.map(f => f.text));

                        return Array.from(allFeatures).map((text, i) => {
                          const inBasic = basicFeatureTexts.has(text);
                          const inPro = proFeatureTexts.has(text);
                          return (
                            <tr key={i} className="border-b last:border-0">
                              <td className="p-2.5 text-sm">{text}</td>
                              <td className="p-2.5 text-center">
                                {inBasic
                                  ? <Check className="h-4 w-4 text-primary mx-auto" />
                                  : <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />}
                              </td>
                              <td className="p-2.5 text-center">
                                {inPro
                                  ? <Check className="h-4 w-4 text-primary mx-auto" />
                                  : <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                      <tr className="border-t bg-muted/20">
                        <td className="p-2.5 font-medium">السعر</td>
                        <td className="p-2.5 text-center font-bold">₪{confirmPlan.monthly_price}</td>
                        <td className="p-2.5 text-center font-bold">₪{proPlan.monthly_price}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <DialogFooter className="flex gap-2 sm:flex-row-reverse">
              <Button variant="outline" onClick={() => setConfirmDialog(null)} disabled={changingPlan}>إلغاء</Button>
              <Button
                variant={confirmDialog?.type === "cancel" ? "destructive" : "default"}
                onClick={() => {
                  if (confirmDialog?.type === "cancel") handleCancelSubscription();
                  else if (confirmDialog?.plan) handlePlanChange(confirmDialog.plan);
                }}
                disabled={changingPlan}
              >
                {changingPlan && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                {confirmDialog?.type === "upgrade" && "تأكيد"}
                {confirmDialog?.type === "downgrade" && "تأكيد الاختيار"}
                {confirmDialog?.type === "cancel" && "تأكيد الإلغاء"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DeleteConfirmDialog
          open={deleteDialog}
          onOpenChange={setDeleteDialog}
          onConfirm={handleDeleteAccount}
          title="حذف الحساب بالكامل"
          description="سيتم حذف حسابك وجميع البيانات المرتبطة به (عملاء، معاملات، مدفوعات، ملفات) بشكل نهائي ولا يمكن التراجع. هل أنت متأكد؟"
          loading={deletingAccount}
        />
      </div>
    </MainLayout>
  );
}
