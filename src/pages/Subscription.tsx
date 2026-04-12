import { useState, useEffect, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { Card, CardContent } from "@/components/ui/card";
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
} from "lucide-react";
import { AddQuotaDialog, type OverageUsageType } from "@/components/subscription/AddQuotaDialog";
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

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentYear = String(now.getFullYear());

  const getUsage = (type: string, period: string) => {
    if (period.length === 4) return usage.filter((u: any) => u.usage_type === type && u.period.startsWith(period)).reduce((s: number, u: any) => s + u.count, 0);
    return usage.find((u: any) => u.usage_type === type && u.period === period)?.count || 0;
  };

  const smsUsed = limits.sms_limit_type === 'monthly' ? getUsage('sms', currentMonth) : getUsage('sms', currentYear);
  const aiUsed = limits.ai_limit_type === 'monthly' ? getUsage('ai_chat', currentMonth) : getUsage('ai_chat', currentYear);
  const smsBaseLimit = limits.sms_limit_count ?? 0;
  const aiBaseLimit = limits.ai_limit_count ?? 0;
  const smsCredits = wallet.sms_credit_balance;
  const aiCredits = wallet.ai_credit_balance;
  const smsMax = limits.sms_limit_type === 'unlimited' ? '∞' : smsBaseLimit;
  const aiMax = limits.ai_limit_type === 'unlimited' ? '∞' : aiBaseLimit;
  const typeLabel = (t: string) => t === 'monthly' ? 'شهرياً' : t === 'yearly' ? 'سنوياً' : 'غير محدود';

  const renderUsageCard = (opts: {
    title: string;
    icon: typeof MessageCircle;
    limitType: string;
    used: number;
    max: number | string;
    baseLimit: number;
    credits: number;
    purchaseType: OverageUsageType;
  }) => {
    const Icon = opts.icon;
    const pct = opts.limitType === 'unlimited' ? 0 : Math.min(100, (opts.used / Math.max(1, opts.baseLimit)) * 100);
    const nearLimit = pct >= 80 && opts.limitType !== 'unlimited';
    const atLimit = pct >= 100 && opts.limitType !== 'unlimited';
    // If the base is used up but we still have credits, the state is "using credits" — not "at limit".
    const usingCredits = atLimit && opts.credits > 0;
    const hardBlocked = atLimit && opts.credits <= 0;

    return (
      <Card className="shadow-sm hover:shadow-md transition-shadow">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "h-11 w-11 rounded-xl flex items-center justify-center shrink-0",
                hardBlocked ? "bg-destructive/10 text-destructive" :
                usingCredits ? "bg-blue-100 text-blue-600" :
                nearLimit ? "bg-amber-100 text-amber-600" :
                "bg-primary/10 text-primary"
              )}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-sm">{opts.title}</p>
                <p className="text-[11px] text-muted-foreground">الحد الشهري {typeLabel(opts.limitType)}</p>
              </div>
            </div>
            {hardBlocked ? (
              <Badge variant="destructive" className="text-[10px]">مكتمل</Badge>
            ) : usingCredits ? (
              <Badge className="text-[10px] bg-blue-100 text-blue-700 border-blue-200">يعمل من الرصيد</Badge>
            ) : nearLimit ? (
              <Badge className="text-[10px] bg-amber-100 text-amber-700 border-amber-200">اقترب من الحد</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">متاح</Badge>
            )}
          </div>

          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-1">
              <span className={cn(
                "text-3xl font-bold tabular-nums",
                hardBlocked ? "text-destructive" : nearLimit && !usingCredits ? "text-amber-600" : ""
              )}>
                {opts.used}
              </span>
              <span className="text-muted-foreground text-sm">/ {opts.max}</span>
            </div>
            {opts.limitType !== 'unlimited' && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(pct)}%
              </span>
            )}
          </div>

          {opts.limitType !== 'unlimited' && (
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  hardBlocked ? "bg-destructive" :
                  nearLimit && !usingCredits ? "bg-amber-500" :
                  "bg-primary"
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {/* Credit wallet row — shown whenever there's a balance, or when
              the user has hit the base limit (so they know WHY it's blocked). */}
          {opts.limitType !== 'unlimited' && (opts.credits > 0 || hardBlocked) && (
            <div className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 text-xs",
              opts.credits > 0
                ? "bg-blue-50 border border-blue-200 text-blue-900"
                : "bg-destructive/5 border border-destructive/30 text-destructive"
            )}>
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="font-medium">الرصيد المشحون</span>
              </div>
              <span className="font-bold tabular-nums">
                {opts.credits.toLocaleString()}
                <span className="text-[10px] font-normal mr-1">لا ينتهي</span>
              </span>
            </div>
          )}

          {opts.limitType !== 'unlimited' && (
            <Button
              type="button"
              variant={hardBlocked ? "default" : "outline"}
              size="sm"
              className="w-full gap-2"
              onClick={() => setQuotaDialogType(opts.purchaseType)}
            >
              <Plus className="h-4 w-4" />
              {opts.credits > 0 ? "شراء المزيد من الرصيد" : "شراء رصيد إضافي"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renderUsageCard({
          title: "رسائل SMS",
          icon: MessageCircle,
          limitType: limits.sms_limit_type,
          used: smsUsed,
          max: smsMax,
          baseLimit: smsBaseLimit,
          credits: smsCredits,
          purchaseType: "sms",
        })}
        {renderUsageCard({
          title: "المساعد الذكي (ثاقب)",
          icon: Sparkles,
          limitType: limits.ai_limit_type,
          used: aiUsed,
          max: aiMax,
          baseLimit: aiBaseLimit,
          credits: aiCredits,
          purchaseType: "ai_chat",
        })}
      </div>

      {quotaDialogType && (
        <AddQuotaDialog
          open={!!quotaDialogType}
          onOpenChange={(open) => { if (!open) setQuotaDialogType(null); }}
          usageType={quotaDialogType}
          onPurchased={() => setReloadToken((t) => t + 1)}
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
        const [paymentsRes, overagesRes] = await Promise.all([
          supabase
            .from("agent_subscription_payments")
            .select("id, amount, plan, payment_date, notes, created_at")
            .eq("agent_id", agentId)
            .order("payment_date", { ascending: false })
            .limit(50),
          supabase
            .from("agent_usage_overages" as any)
            .select("id, usage_type, extra_count, unit_price, total_amount, created_at")
            .eq("agent_id", agentId)
            .eq("billed", false)
            .order("created_at", { ascending: false }),
        ]);
        if (paymentsRes.data) setPayments(paymentsRes.data);
        if (overagesRes.data) setUnbilledOverages(overagesRes.data as any);
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
      if (sub?.isTrial) {
        const { error } = await supabase.from("agents").update({
          pending_plan: targetPlan.plan_key,
        }).eq("id", agentId);
        if (error) throw error;
        toast.success(`تم اختيار خطة ${targetPlan.name}. ستبدأ بعد انتهاء الفترة التجريبية.`);
      } else {
        const isUpgrade = targetPlan.monthly_price > (agent.monthly_price || 0);
        const { error } = await supabase.from("agents").update({
          plan: targetPlan.plan_key,
          monthly_price: targetPlan.monthly_price,
        }).eq("id", agentId);
        if (error) throw error;
        toast.success(isUpgrade
          ? `تمت الترقية إلى خطة ${targetPlan.name} بنجاح!`
          : `تم التحويل إلى خطة ${targetPlan.name}.`
        );
      }
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

  // For trial users, find the Pro plan to compare features when picking Basic
  const proPlan = plans.find(p => p.plan_key === "pro");
  const confirmPlan = confirmDialog?.plan;
  const isDowngradeFromTrial = sub?.isTrial && confirmPlan && confirmPlan.plan_key !== "pro";

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto" dir="rtl">
        {/* Header */}
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

        {/* Tabs */}
        <Tabs defaultValue="plan" dir="rtl" className="w-full">
          <TabsList className="w-full justify-start bg-muted/50 p-1 h-auto flex-nowrap overflow-x-auto sm:flex-wrap">
            <TabsTrigger value="plan" className="gap-1.5 shrink-0 whitespace-nowrap">
              <Crown className="h-4 w-4" />
              الخطة والاشتراك
            </TabsTrigger>
            <TabsTrigger value="usage" className="gap-1.5 shrink-0 whitespace-nowrap">
              <BarChart3 className="h-4 w-4" />
              الاستخدام
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5 shrink-0 whitespace-nowrap">
              <Receipt className="h-4 w-4" />
              المدفوعات ({payments.length})
            </TabsTrigger>
            <TabsTrigger value="account" className="gap-1.5 shrink-0 whitespace-nowrap">
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
                      {agent.pending_plan && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
                          <Info className="h-3.5 w-3.5" />
                          تم اختيار خطة {agent.pending_plan === "pro" ? "Pro" : "Basic"} — ستبدأ تلقائياً بعد انتهاء التجربة
                        </p>
                      )}
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

        {/* ═══ Plans Section ═══ */}
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold">
              {sub?.isTrial ? "اختر خطتك بعد انتهاء التجربة" : "الخطط المتاحة"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {sub?.isTrial
                ? "أنت حالياً تستخدم جميع ميزات Pro مجاناً. اختر الخطة التي تريد الاستمرار بها."
                : "قارن بين الخطط واختر ما يناسب احتياجاتك"}
            </p>
          </div>

          {loadingPlans ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-72 w-full rounded-xl" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {plans.map((plan) => {
                  const isCurrent = !sub?.isTrial && agent.plan === plan.plan_key;
                  const isPending = agent.pending_plan === plan.plan_key;
                  const isUpgrade = sub?.isTrial
                    ? true  // From trial, everything is "choosing"
                    : plan.monthly_price > (agent.monthly_price || 0);
                  const isCustom = plan.plan_key === "custom";
                  const PlanIcon = PLAN_ICONS[plan.plan_key] || Shield;

                  return (
                    <Card key={plan.id} className={cn(
                      "relative overflow-hidden transition-all",
                      isCurrent ? "border-2 border-primary shadow-md" : "border hover:border-primary/30 hover:shadow-sm",
                      isPending && !isCurrent && "border-2 border-primary/50"
                    )}>
                      {isCurrent && (
                        <div className="bg-primary text-primary-foreground text-center text-xs font-bold py-1">
                          خطتك الحالية
                        </div>
                      )}
                      {isPending && !isCurrent && (
                        <div className="bg-primary/80 text-primary-foreground text-center text-xs font-bold py-1">
                          تم الاختيار — تبدأ بعد التجربة
                        </div>
                      )}
                      {plan.badge && !isCurrent && !isPending && (
                        <div className="bg-muted text-muted-foreground text-center text-xs font-medium py-1">
                          {plan.badge}
                        </div>
                      )}

                      <CardContent className={cn("pt-6 pb-5 space-y-4", (isCurrent || isPending || plan.badge) && "pt-4")}>
                        <div className="flex items-center gap-3">
                          <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center",
                            isCurrent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                          )}>
                            <PlanIcon className="h-5 w-5" />
                          </div>
                          <div>
                            <h4 className="text-lg font-bold">{plan.name}</h4>
                            {plan.name_ar && <p className="text-xs text-muted-foreground">{plan.name_ar}</p>}
                          </div>
                        </div>

                        <div className="flex items-baseline gap-1.5">
                          {plan.monthly_price > 0 ? (
                            <>
                              <span className="text-3xl font-extrabold">₪{plan.monthly_price}</span>
                              <span className="text-sm text-muted-foreground">/ شهرياً</span>
                            </>
                          ) : (
                            <span className="text-lg font-bold text-muted-foreground">حسب الطلب</span>
                          )}
                        </div>

                        {plan.description && (
                          <p className="text-xs text-muted-foreground leading-relaxed">{plan.description}</p>
                        )}

                        <ul className="space-y-2">
                          {plan.features.map((f, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                              <span>{f.text}</span>
                            </li>
                          ))}
                        </ul>

                        <div className="pt-2">
                          {isCurrent ? (
                            <Button variant="outline" className="w-full" disabled>الخطة الحالية</Button>
                          ) : isPending ? (
                            <Button variant="outline" className="w-full text-primary border-primary/30" disabled>تم الاختيار</Button>
                          ) : isCustom ? (
                            <a
                              href={`https://wa.me/972525143581?text=${encodeURIComponent(`مرحباً، أريد طلب خطة اشتراك مخصصة.\nمعرف الوكيل: ${agentId}`)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <Button variant="outline" className="w-full gap-2">
                                <MessageCircle className="h-4 w-4" />
                                طلب خطة مخصصة
                              </Button>
                            </a>
                          ) : (
                            <Button
                              className={cn("w-full gap-2",
                                sub?.isTrial ? "" :
                                isUpgrade ? "" : "bg-muted text-foreground hover:bg-muted/80"
                              )}
                              onClick={() => setConfirmDialog({
                                type: sub?.isTrial ? (plan.plan_key === "pro" ? "upgrade" : "downgrade") :
                                      isUpgrade ? "upgrade" : "downgrade",
                                plan,
                              })}
                            >
                              {sub?.isTrial ? (
                                <>اختيار هذه الخطة</>
                              ) : isUpgrade ? (
                                <><ArrowUp className="h-4 w-4" />ترقية</>
                              ) : (
                                <><ArrowDown className="h-4 w-4" />تغيير</>
                              )}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  {sub?.isTrial
                    ? "خلال الفترة التجريبية، جميع ميزات Pro متاحة لك. بعد انتهائها ستعمل الخطة التي اخترتها. يمكنك تغيير اختيارك في أي وقت قبل انتهاء التجربة."
                    : "عند الترقية ستحصل على الميزات فوراً ويُحسب الفرق في الفاتورة القادمة. عند التخفيض يتم التحويل فوراً بدون استرجاع."}
                </div>
              </div>
            </>
          )}
        </div>

          </TabsContent>

          {/* ═══ Usage Tab ═══ */}
          <TabsContent value="usage" className="mt-5 space-y-5">
            <UsageStatsSection agentId={agentId} />
          </TabsContent>

          {/* ═══ Payments Tab ═══ */}
          <TabsContent value="payments" className="mt-5 space-y-5">
            {/* Next billing summary — only shown for paying agents */}
            {!sub?.isTrial && (agent.monthly_price || 0) > 0 && (() => {
              const basePrice = agent.monthly_price || 0;
              const extrasTotal = unbilledOverages.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
              const nextTotal = basePrice + extrasTotal;
              const smsExtras = unbilledOverages.filter(o => o.usage_type === 'sms');
              const aiExtras = unbilledOverages.filter(o => o.usage_type === 'ai_chat');
              const smsCount = smsExtras.reduce((s, o) => s + o.extra_count, 0);
              const smsTotal = smsExtras.reduce((s, o) => s + Number(o.total_amount), 0);
              const aiCount = aiExtras.reduce((s, o) => s + o.extra_count, 0);
              const aiTotal = aiExtras.reduce((s, o) => s + Number(o.total_amount), 0);

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
                          <h3 className="text-lg font-bold">الفاتورة القادمة</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {sub?.expiresAt
                              ? `تاريخ الإصدار المتوقع ${format(sub.expiresAt, "dd/MM/yyyy")}`
                              : "تفاصيل ما سيُحسب عليك في الفاتورة القادمة"}
                          </p>
                        </div>
                      </div>
                      <div className="text-left">
                        <p className="text-[10px] text-muted-foreground">الإجمالي المتوقع</p>
                        <p className="text-3xl font-bold text-primary tabular-nums">
                          ₪{nextTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {/* Base plan row */}
                      <div className="flex items-center justify-between py-2.5 border-b">
                        <div className="flex items-center gap-2">
                          <Crown className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">
                              خطة {agent.plan === "pro" ? "Pro" : agent.plan === "basic" ? "Basic" : agent.plan}
                            </p>
                            <p className="text-[10px] text-muted-foreground">اشتراك شهري</p>
                          </div>
                        </div>
                        <span className="font-semibold tabular-nums">
                          ₪{basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>

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
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map(p => (
                          <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="p-3">{format(new Date(p.payment_date), "dd/MM/yyyy")}</td>
                            <td className="p-3 font-semibold">₪{p.amount?.toLocaleString()}</td>
                            <td className="p-3"><Badge variant="secondary" className="text-xs">{p.plan}</Badge></td>
                            <td className="p-3 text-muted-foreground text-xs truncate max-w-[200px]">{p.notes || "—"}</td>
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
          description="سيتم حذف حسابك وجميع البيانات المرتبطة به (عملاء، وثائق، مدفوعات، ملفات) بشكل نهائي ولا يمكن التراجع. هل أنت متأكد؟"
          loading={deletingAccount}
        />
      </div>
    </MainLayout>
  );
}
