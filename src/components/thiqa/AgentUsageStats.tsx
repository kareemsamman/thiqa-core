import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import {
  Activity, Building2, Car, MessageSquare, Megaphone, Bot,
  Users, ShieldCheck, Infinity as InfinityIcon, AlertTriangle, Network,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface PlanLimits {
  users_limit: number | null;
  branches_limit: number | null;
  policies_limit: number | null;
  sms_limit: number | null;
  marketing_sms_limit: number | null;
  ai_limit: number | null;
}

interface AgentOverrides {
  users_limit_override: number | null;
  branches_limit_override: number | null;
  policies_limit_override: number | null;
  sms_limit_override: number | null;
  marketing_sms_limit_override: number | null;
  ai_limit_override: number | null;
  plan: string;
}

interface UsageLogRow {
  usage_type: string;
  count: number;
}

interface CreditWallet {
  sms_credit_balance: number | null;
  marketing_sms_credit_balance: number | null;
  ai_credit_balance: number | null;
}

interface CountRow {
  count: number | null;
}

interface UsageData {
  // Resource limits (from plan + override) and current usage
  users: { count: number; limit: EffectiveLimit };
  branches: { count: number; limit: EffectiveLimit };
  clients: { count: number };
  cars: { count: number };
  policies: { count: number; limit: EffectiveLimit };
  // Monthly counters (reset each calendar month)
  sms: { used: number; credits: number; limit: EffectiveLimit };
  marketingSms: { used: number; credits: number; limit: EffectiveLimit };
  ai: { used: number; credits: number; limit: EffectiveLimit };
  lastActivityAt: string | null;
}

/** Effective limit interpretation:
 *   value === null   → unlimited
 *   value === number → that hard cap
 * Source mapping:
 *   override === -1   → unlimited (forced)
 *   override === null → inherit from plan
 *   override >= 0     → exact value
 *   plan limit === null → unlimited
 *   plan limit >= 0   → that cap
 */
type EffectiveLimit = { value: number | null; source: "plan" | "override" | "unlimited" };

function effective(override: number | null, plan: number | null): EffectiveLimit {
  if (override === -1) return { value: null, source: "unlimited" };
  if (override !== null && override !== undefined) return { value: override, source: "override" };
  if (plan === null || plan === undefined) return { value: null, source: "unlimited" };
  return { value: plan, source: "plan" };
}

export function AgentUsageStats({ agentId }: { agentId: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<UsageData | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const period = format(new Date(), "yyyy-MM");

      const [
        agentRes,
        sessionRes,
        usageRes,
        walletRes,
        usersCountRes,
        branchesCountRes,
        clientsCountRes,
        carsCountRes,
        policiesCountRes,
      ] = await Promise.all([
        supabase
          .from("agents")
          .select("plan, users_limit_override, branches_limit_override, policies_limit_override, sms_limit_override, marketing_sms_limit_override, ai_limit_override")
          .eq("id", agentId)
          .maybeSingle(),
        supabase
          .from("user_sessions")
          .select("last_seen_at")
          .eq("agent_id", agentId)
          .order("last_seen_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("agent_usage_log")
          .select("usage_type, count")
          .eq("agent_id", agentId)
          .eq("period", period),
        supabase
          .from("agent_credit_wallet")
          .select("sms_credit_balance, marketing_sms_credit_balance, ai_credit_balance")
          .eq("agent_id", agentId)
          .maybeSingle(),
        supabase.from("agent_users").select("user_id", { count: "exact", head: true }).eq("agent_id", agentId),
        supabase.from("branches").select("id", { count: "exact", head: true }).eq("agent_id", agentId).eq("is_active", true),
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("agent_id", agentId),
        supabase.from("cars").select("id", { count: "exact", head: true }).eq("agent_id", agentId).is("deleted_at", null),
        supabase.from("policies").select("id", { count: "exact", head: true }).eq("agent_id", agentId),
      ]);

      const overrides = (agentRes.data || {}) as AgentOverrides;
      const planKey = overrides.plan;

      let plan: PlanLimits = { users_limit: null, branches_limit: null, policies_limit: null, sms_limit: null, marketing_sms_limit: null, ai_limit: null };
      if (planKey) {
        const { data: pData } = await supabase
          .from("subscription_plans")
          .select("users_limit, branches_limit, policies_limit, sms_limit, marketing_sms_limit, ai_limit")
          .eq("plan_key", planKey)
          .maybeSingle();
        if (pData) plan = pData as PlanLimits;
      }

      const usageMap: Record<string, number> = {};
      ((usageRes.data as UsageLogRow[]) || []).forEach((row) => {
        usageMap[row.usage_type] = (usageMap[row.usage_type] ?? 0) + (row.count ?? 0);
      });
      const wallet = (walletRes.data as CreditWallet) || { sms_credit_balance: 0, marketing_sms_credit_balance: 0, ai_credit_balance: 0 };

      setData({
        lastActivityAt: ((sessionRes.data as any)?.last_seen_at) ?? null,
        users: {
          count: usersCountRes.count ?? 0,
          limit: effective(overrides.users_limit_override, plan.users_limit),
        },
        branches: {
          count: branchesCountRes.count ?? 0,
          limit: effective(overrides.branches_limit_override, plan.branches_limit),
        },
        clients: { count: clientsCountRes.count ?? 0 },
        cars: { count: carsCountRes.count ?? 0 },
        policies: {
          count: policiesCountRes.count ?? 0,
          limit: effective(overrides.policies_limit_override, plan.policies_limit),
        },
        sms: {
          used: usageMap["sms"] ?? 0,
          credits: wallet.sms_credit_balance ?? 0,
          limit: effective(overrides.sms_limit_override, plan.sms_limit),
        },
        marketingSms: {
          used: usageMap["marketing_sms"] ?? 0,
          credits: wallet.marketing_sms_credit_balance ?? 0,
          limit: effective(overrides.marketing_sms_limit_override, plan.marketing_sms_limit),
        },
        ai: {
          used: usageMap["ai_chat"] ?? 0,
          credits: wallet.ai_credit_balance ?? 0,
          limit: effective(overrides.ai_limit_override, plan.ai_limit),
        },
      });
      setLoading(false);
    })();
  }, [agentId]);

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Last activity ─── */}
      <LastActivityCard lastActivityAt={data.lastActivityAt} />

      {/* ─── Resources (counts vs caps) ─── */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5" />
            موارد الوكيل
          </CardTitle>
          <CardDescription>أعداد كلية مقابل حدود الباقة</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <ResourceTile icon={Users} label="مستخدمون" used={data.users.count} limit={data.users.limit} tone="primary" />
            <ResourceTile icon={Network} label="فروع" used={data.branches.count} limit={data.branches.limit} tone="primary" />
            <ResourceTile icon={ShieldCheck} label="معاملات تأمين" used={data.policies.count} limit={data.policies.limit} tone="primary" />
            <ResourceTile icon={Users} label="عملاء" used={data.clients.count} tone="muted" />
            <ResourceTile icon={Car} label="سيارات" used={data.cars.count} tone="muted" />
          </div>
        </CardContent>
      </Card>

      {/* ─── Monthly counters ─── */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-5 w-5" />
            استخدام الشهر الحالي
          </CardTitle>
          <CardDescription>{format(new Date(), "MM/yyyy")} · يُعاد التصفير بداية كل شهر</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <UsageTile icon={MessageSquare} label="رسائل SMS" used={data.sms.used} limit={data.sms.limit} credits={data.sms.credits} tone="blue" />
            <UsageTile icon={Megaphone} label="SMS تسويقية" used={data.marketingSms.used} limit={data.marketingSms.limit} credits={data.marketingSms.credits} tone="amber" />
            <UsageTile icon={Bot} label="استعلامات AI" used={data.ai.used} limit={data.ai.limit} credits={data.ai.credits} tone="emerald" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LastActivityCard({ lastActivityAt }: { lastActivityAt: string | null }) {
  if (!lastActivityAt) {
    return (
      <Card className="rounded-2xl border-red-500/40 bg-red-500/5 shadow-sm">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">آخر نشاط</div>
            <div className="font-bold text-red-700 dark:text-red-300">لم يدخل أبداً</div>
          </div>
        </CardContent>
      </Card>
    );
  }
  const days = differenceInCalendarDays(new Date(), new Date(lastActivityAt));
  let label: string;
  if (days <= 0) label = "اليوم";
  else if (days === 1) label = "أمس";
  else if (days < 7) label = `منذ ${days} أيام`;
  else if (days < 30) label = `منذ ${Math.floor(days / 7)} أسابيع`;
  else if (days < 365) label = `منذ ${Math.floor(days / 30)} شهور`;
  else label = `منذ ${Math.floor(days / 365)} سنوات`;
  const tone =
    days <= 7 ? { card: "border-green-500/40 bg-green-500/5", icon: "bg-green-500/10 text-green-600", value: "text-green-700 dark:text-green-300" }
    : days <= 30 ? { card: "border-amber-500/40 bg-amber-500/5", icon: "bg-amber-500/10 text-amber-600", value: "text-amber-700 dark:text-amber-300" }
    : { card: "border-red-500/40 bg-red-500/5", icon: "bg-red-500/10 text-red-600", value: "text-red-700 dark:text-red-300" };
  return (
    <Card className={cn("rounded-2xl shadow-sm", tone.card)}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center", tone.icon)}>
          <Activity className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm text-muted-foreground">آخر نشاط للفريق</div>
          <div className={cn("font-bold", tone.value)}>{label}</div>
        </div>
        <div className="text-xs text-muted-foreground ltr-nums">
          {format(new Date(lastActivityAt), "dd/MM/yyyy HH:mm")}
        </div>
      </CardContent>
    </Card>
  );
}

const TONE: Record<string, { card: string; icon: string; bar: string; value: string }> = {
  primary: { card: "bg-primary/5 border-primary/15", icon: "bg-primary/10 text-primary", bar: "bg-primary", value: "text-foreground" },
  blue:    { card: "bg-blue-500/5 border-blue-500/15", icon: "bg-blue-500/10 text-blue-600", bar: "bg-blue-500", value: "text-blue-700 dark:text-blue-300" },
  amber:   { card: "bg-amber-500/5 border-amber-500/15", icon: "bg-amber-500/10 text-amber-600", bar: "bg-amber-500", value: "text-amber-700 dark:text-amber-300" },
  emerald: { card: "bg-emerald-500/5 border-emerald-500/15", icon: "bg-emerald-500/10 text-emerald-600", bar: "bg-emerald-500", value: "text-emerald-700 dark:text-emerald-300" },
  muted:   { card: "bg-muted/30 border-border", icon: "bg-muted text-muted-foreground", bar: "bg-muted-foreground", value: "text-foreground" },
};

function ResourceTile({
  icon: Icon, label, used, limit, tone,
}: {
  icon: any; label: string; used: number; limit?: EffectiveLimit; tone: keyof typeof TONE;
}) {
  const t = TONE[tone];
  const isUnlimited = limit?.value == null;
  const cap = limit?.value ?? null;
  const ratio = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const overCap = cap !== null && used > cap;

  return (
    <div className={cn("rounded-2xl border p-4 transition-shadow hover:shadow-sm", t.card)}>
      <div className="flex items-center gap-3 mb-2">
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center", t.icon)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={cn("text-2xl font-bold ltr-nums", overCap ? "text-red-600" : t.value)}>
          {used.toLocaleString("en-US")}
        </span>
        {limit && (
          <span className="text-sm text-muted-foreground ltr-nums">
            {isUnlimited ? (
              <InfinityIcon className="h-4 w-4 inline" />
            ) : (
              <>/ {cap?.toLocaleString("en-US")}</>
            )}
          </span>
        )}
        {limit?.source === "override" && (
          <Badge variant="outline" className="text-[9px] mr-1">مخصّص</Badge>
        )}
      </div>
      {!isUnlimited && cap !== null && (
        <div className="mt-3 h-1.5 rounded-full bg-background overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overCap ? "bg-red-500" : t.bar)}
            style={{ width: `${Math.min(100, ratio)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function UsageTile({
  icon, label, used, limit, credits, tone,
}: {
  icon: any; label: string; used: number; limit: EffectiveLimit; credits: number; tone: keyof typeof TONE;
}) {
  const t = TONE[tone];
  const Icon = icon;
  const isUnlimited = limit.value == null;
  const cap = limit.value;
  const totalAvailable = (cap ?? 0) + (credits ?? 0);
  const ratio = !isUnlimited && totalAvailable > 0
    ? Math.min(100, Math.round((used / totalAvailable) * 100))
    : 0;
  const overCap = !isUnlimited && cap !== null && used > cap + credits;

  return (
    <div className={cn("rounded-2xl border p-4 transition-shadow hover:shadow-sm", t.card)}>
      <div className="flex items-center gap-3 mb-2">
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center", t.icon)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={cn("text-2xl font-bold ltr-nums", overCap ? "text-red-600" : t.value)}>
          {used.toLocaleString("en-US")}
        </span>
        <span className="text-sm text-muted-foreground ltr-nums">
          / {isUnlimited ? <InfinityIcon className="h-3.5 w-3.5 inline" /> : (cap ?? 0).toLocaleString("en-US")}
        </span>
        {limit.source === "override" && (
          <Badge variant="outline" className="text-[9px]">مخصّص</Badge>
        )}
      </div>
      {credits > 0 && (
        <div className="text-[11px] text-muted-foreground mt-1 ltr-nums">
          + {credits.toLocaleString("en-US")} رصيد إضافي
        </div>
      )}
      {!isUnlimited && cap !== null && (
        <div className="mt-3 h-1.5 rounded-full bg-background overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overCap ? "bg-red-500" : t.bar)}
            style={{ width: `${Math.min(100, ratio)}%` }}
          />
        </div>
      )}
    </div>
  );
}
