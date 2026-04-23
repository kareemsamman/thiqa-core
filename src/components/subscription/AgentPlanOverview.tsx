import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Crown,
  MessageCircle,
  ShoppingCart,
  Tag,
  TrendingUp,
  Users,
  Building2,
  Sparkles,
  Megaphone,
  Rocket,
  Database,
  Clock,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { useAgentLimits, ResourceLimit } from '@/hooks/useAgentLimits';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { arDZ as ar } from 'date-fns/locale';

interface ActiveDiscount {
  discounted_price: number;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

interface ActiveAddon {
  id: string;
  addon_type: string;
  quantity: number;
  unit_price: number;
  billing_cycle: 'monthly' | 'one_time';
  ends_at: string | null;
  status: 'active' | 'pending_approval';
  requested_at: string | null;
}

const ADDON_LABELS: Record<string, string> = {
  extra_user: 'مستخدم إضافي',
  extra_branch: 'فرع إضافي',
  extra_sms: 'باقة SMS',
  extra_marketing_sms: 'باقة SMS تسويقية',
  extra_ai: 'باقة AI',
  onboarding: 'إعداد أولي',
  data_migration: 'هجرة بيانات',
};

// Catalog shown when the agent has no active addons (or below them) —
// "what can I buy". Prices resolve live from thiqa_platform_settings so
// the Thiqa admin can change them without a code deploy; the defaults
// here mirror the seed in 20260422000000_pricing_packages_foundation.sql
// and act as fallback if the setting row is missing.
const ADDON_CATALOG: {
  type: string;
  label: string;
  desc: string;
  settingKey: string;
  defaultPrice: number;
  billing: 'monthly' | 'one_time';
  priceSuffix: string;
  startingFrom?: boolean;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    type: 'extra_user',
    label: 'مستخدم إضافي',
    desc: 'رفع الحد المسموح من المستخدمين بمقدار 1',
    settingKey: 'addon_extra_user_price',
    defaultPrice: 30,
    billing: 'monthly',
    priceSuffix: '/ مستخدم / شهر',
    Icon: Users,
  },
  {
    type: 'extra_branch',
    label: 'فرع إضافي',
    desc: 'فتح إمكانية إضافة فرع جديد للوكالة',
    settingKey: 'addon_extra_branch_price',
    defaultPrice: 120,
    billing: 'monthly',
    priceSuffix: '/ فرع / شهر',
    Icon: Building2,
  },
  {
    type: 'extra_ai',
    label: 'باقة AI',
    desc: 'زيادة رصيد محادثات المساعد الذكي الشهري',
    settingKey: 'addon_extra_ai_price',
    defaultPrice: 50,
    billing: 'monthly',
    priceSuffix: '/ شهر',
    Icon: Sparkles,
  },
  {
    type: 'extra_sms',
    label: 'باقة SMS',
    desc: 'رصيد إضافي لرسائل SMS التشغيلية',
    settingKey: 'addon_extra_sms_price',
    defaultPrice: 50,
    billing: 'monthly',
    priceSuffix: '/ شهر',
    Icon: MessageCircle,
  },
  {
    type: 'extra_marketing_sms',
    label: 'باقة SMS تسويقية',
    desc: 'رصيد إضافي لحملات الرسائل التسويقية',
    settingKey: 'addon_extra_marketing_sms_price',
    defaultPrice: 50,
    billing: 'monthly',
    priceSuffix: '/ شهر',
    Icon: Megaphone,
  },
  {
    type: 'onboarding',
    label: 'إعداد أولي',
    desc: 'مساعدة مخصصة لتجهيز النظام والإعداد الأولي',
    settingKey: 'addon_onboarding_price',
    defaultPrice: 200,
    billing: 'one_time',
    priceSuffix: 'مرة واحدة',
    Icon: Rocket,
  },
  {
    type: 'data_migration',
    label: 'هجرة بيانات',
    desc: 'نقل العملاء والمعاملات من نظامك الحالي',
    settingKey: 'addon_data_migration_price',
    defaultPrice: 450,
    billing: 'one_time',
    priceSuffix: 'مرة واحدة',
    startingFrom: true,
    Icon: Database,
  },
];


function UsageRow({
  label,
  limit,
  unit = '',
}: {
  label: string;
  limit: ResourceLimit;
  unit?: string;
}) {
  const isUnlimited = limit.effective === null;
  // Format: "limit / used" (plan cap first, current usage second).
  const usedText = isUnlimited
    ? `غير محدود / ${limit.used}${unit}`
    : `${limit.effective}${unit} / ${limit.used}${unit}`;

  const percent = isUnlimited
    ? 100
    : Math.min(100, (limit.used / Math.max(1, limit.effective!)) * 100);

  const color = isUnlimited
    ? 'bg-primary/30'
    : percent >= 90
    ? 'bg-destructive'
    : percent >= 70
    ? 'bg-amber-500'
    : 'bg-primary';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono ltr-nums text-muted-foreground">
          {usedText}
          {limit.addonQuantity > 0 && !isUnlimited && (
            <span className="text-emerald-600 text-xs mr-1">(+{limit.addonQuantity} إضافي)</span>
          )}
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all', color)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Agent-facing summary of their plan — the view that matches the
 * pricing model (plan + discount + addons + per-resource usage).
 * Lives at the top of /subscription → تبويب الاشتراك.
 *
 * The catalog section lets the agent self-serve-request an addon:
 * clicking "اشترِ" opens a confirmation dialog and posts to the
 * request-addon-purchase edge function. The resulting row is a
 * pending_approval record the Thiqa admin approves from the agent
 * detail page, plus an email notification.
 */
export function AgentPlanOverview() {
  const { agent, planInfo } = useAgentContext();
  const limits = useAgentLimits();
  const { toast } = useToast();
  const [discount, setDiscount] = useState<ActiveDiscount | null>(null);
  const [addons, setAddons] = useState<ActiveAddon[]>([]);
  const [catalogPrices, setCatalogPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  // Purchase-confirmation dialog state. `item` is the catalog entry being
  // requested; clearing it closes the dialog.
  const [pendingItem, setPendingItem] = useState<typeof ADDON_CATALOG[number] | null>(null);
  const [pendingQuantity, setPendingQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!agent?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      try {
        const [discountResp, addonsResp, pricesResp] = await Promise.all([
          supabase
            .from('agent_discounts')
            .select('discounted_price, starts_at, ends_at, reason')
            .eq('agent_id', agent.id)
            .lte('starts_at', today)
            .gte('ends_at', today)
            .order('starts_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          // Pull both active and pending_approval rows — we show them
          // together so the agent can see what they've asked for.
          supabase
            .from('agent_addons')
            .select('id, addon_type, quantity, unit_price, billing_cycle, ends_at, status, requested_at')
            .eq('agent_id', agent.id)
            .in('status', ['active', 'pending_approval'])
            .or(`ends_at.is.null,ends_at.gte.${today}`)
            .order('created_at', { ascending: false }),
          supabase
            .from('thiqa_platform_settings')
            .select('setting_key, setting_value')
            .in(
              'setting_key',
              ADDON_CATALOG.map((c) => c.settingKey),
            ),
        ]);
        if (cancelled) return;
        setDiscount((discountResp.data as ActiveDiscount | null) ?? null);
        setAddons((addonsResp.data as ActiveAddon[] | null) ?? []);
        const priceMap: Record<string, number> = {};
        (pricesResp.data ?? []).forEach((row: { setting_key: string; setting_value: string | null }) => {
          const parsed = Number(row.setting_value);
          if (Number.isFinite(parsed)) priceMap[row.setting_key] = parsed;
        });
        setCatalogPrices(priceMap);
      } catch (error) {
        console.error('Error loading plan overview:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent?.id, reloadToken]);

  const handleConfirmPurchase = async () => {
    if (!pendingItem) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-addon-purchase', {
        body: { addon_type: pendingItem.type, quantity: pendingQuantity },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: 'تم إرسال الطلب',
        description: 'سيتم مراجعة طلبك من فريق ثقة وتفعيل الإضافة بعد الموافقة.',
      });
      setPendingItem(null);
      setPendingQuantity(1);
      setReloadToken((t) => t + 1);
    } catch (err: any) {
      toast({
        title: 'تعذّر إرسال الطلب',
        description: err?.message || 'حدث خطأ غير متوقع',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const pendingAddonTypes = new Set(
    addons.filter((a) => a.status === 'pending_approval').map((a) => a.addon_type),
  );

  if (!planInfo || !agent) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  const effectivePrice = discount?.discounted_price ?? planInfo.monthly_price;
  const discountApplied = discount !== null;

  const recurringAddonsTotal = addons
    .filter((a) => a.billing_cycle === 'monthly')
    .reduce((sum, a) => sum + a.quantity * a.unit_price, 0);

  const isTrial =
    agent.subscription_status === 'trial' ||
    (agent.monthly_price === 0 && agent.subscription_status === 'active');
  const trialEndDate = agent.trial_ends_at
    ? new Date(agent.trial_ends_at)
    : agent.subscription_expires_at
    ? new Date(agent.subscription_expires_at)
    : null;
  const trialMsRemaining = trialEndDate
    ? Math.max(0, trialEndDate.getTime() - Date.now())
    : 0;
  const trialDaysRemaining = trialEndDate ? Math.floor(trialMsRemaining / 86400000) : null;
  const trialProgress =
    isTrial && trialDaysRemaining !== null
      ? Math.min(100, Math.max(0, ((35 * 86400000 - trialMsRemaining) / (35 * 86400000)) * 100))
      : 0;

  // Prefill WhatsApp with an addon-inquiry message so Thiqa knows
  // what the agent wants before the conversation starts.
  const whatsAppMessage = encodeURIComponent(
    `مرحباً، أنا ${agent.name_ar || agent.name} وأرغب بشراء إضافة لحزمتي الحالية (${planInfo.name_ar || planInfo.name}).`,
  );
  const whatsAppHref = `https://wa.me/972525143581?text=${whatsAppMessage}`;

  return (
    <div className="space-y-4">
      {/* Plan + effective price card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Crown className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-2xl font-bold">{planInfo.name_ar || planInfo.name}</h2>
                  {planInfo.badge && (
                    <Badge className="bg-primary">{planInfo.badge}</Badge>
                  )}
                </div>
                <div className="flex items-baseline gap-2 mt-2 flex-wrap">
                  {discountApplied ? (
                    <>
                      <span className="text-3xl font-bold text-emerald-600">
                        ₪{effectivePrice}
                      </span>
                      <span className="text-lg text-muted-foreground line-through">
                        ₪{planInfo.monthly_price}
                      </span>
                      <span className="text-sm text-muted-foreground">/ شهر</span>
                    </>
                  ) : (
                    <>
                      <span className="text-3xl font-bold text-primary">₪{planInfo.monthly_price}</span>
                      <span className="text-sm text-muted-foreground">/ شهر</span>
                    </>
                  )}
                  {recurringAddonsTotal > 0 && (
                    <span className="text-sm text-muted-foreground">
                      + ₪{recurringAddonsTotal} إضافات
                    </span>
                  )}
                </div>
                {discountApplied && discount && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
                    <Tag className="h-3 w-3" />
                    <span>
                      خصم ساري حتى {format(new Date(discount.ends_at), 'dd/MM/yyyy', { locale: ar })}
                      {discount.reason && ` — ${discount.reason}`}
                    </span>
                  </div>
                )}
                {isTrial && trialDaysRemaining !== null && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={cn(
                          'font-semibold',
                          trialDaysRemaining <= 0
                            ? 'text-destructive'
                            : trialDaysRemaining <= 7
                            ? 'text-destructive'
                            : 'text-primary',
                        )}
                      >
                        {trialDaysRemaining <= 0
                          ? 'انتهت الفترة التجريبية'
                          : `متبقي ${trialDaysRemaining} يوم على انتهاء التجربة`}
                      </span>
                      <span className="text-muted-foreground">
                        {Math.round(trialProgress)}% منتهية
                      </span>
                    </div>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full transition-all',
                          trialDaysRemaining <= 7 ? 'bg-destructive' : 'bg-primary',
                        )}
                        style={{ width: `${trialProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <a href="https://wa.me/972525143581" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-2">
                  <MessageCircle className="h-4 w-4" />
                  تواصل مع ثقة
                </Button>
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage bars */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">استخدامك الحالي</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {limits.loading ? (
            <>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </>
          ) : (
            <>
              <UsageRow label="المستخدمين" limit={limits.users} />
              <UsageRow label="الفروع" limit={limits.branches} />
              <UsageRow
                label={`المعاملات (${
                  limits.policyPeriod === 'monthly'
                    ? 'هذا الشهر'
                    : limits.policyPeriod === 'yearly'
                    ? 'هذه السنة'
                    : 'إجمالي'
                })`}
                limit={limits.policies}
              />
              <UsageRow label="رسائل SMS (هذا الشهر)" limit={limits.sms} />
              <UsageRow label="SMS تسويقية (هذا الشهر)" limit={limits.marketingSms} />
              <UsageRow label="طلبات AI (هذا الشهر)" limit={limits.ai} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Active addons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            الإضافات الفعّالة
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : addons.length > 0 ? (
            <div className="space-y-2">
              {addons.map((a) => {
                const isPending = a.status === 'pending_approval';
                return (
                  <div
                    key={a.id}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-lg border',
                      isPending ? 'bg-amber-500/5 border-amber-500/30' : 'bg-card',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{ADDON_LABELS[a.addon_type] || a.addon_type}</p>
                        {isPending && (
                          <Badge
                            variant="outline"
                            className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1 text-[10px]"
                          >
                            <Clock className="h-3 w-3" />
                            قيد المراجعة
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {a.quantity} × ₪{a.unit_price}
                        {a.billing_cycle === 'monthly' ? ' / شهر' : ' مرة واحدة'}
                        {a.ends_at && ` — حتى ${format(new Date(a.ends_at), 'dd/MM/yyyy', { locale: ar })}`}
                      </p>
                    </div>
                    <Badge variant={a.billing_cycle === 'monthly' ? 'default' : 'secondary'}>
                      ₪{a.quantity * a.unit_price}
                      {a.billing_cycle === 'monthly' && '/شهر'}
                    </Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-3">
              لا توجد إضافات فعّالة حالياً — اختر من الإضافات المتوفرة أدناه.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Available addon catalog — self-serve request flow. Clicking
          "اشترِ" opens a confirmation dialog, and confirming posts to
          request-addon-purchase which creates a pending row + emails
          Thiqa super admins. The catalog prices live in
          thiqa_platform_settings so Thiqa can change them without a
          code deploy. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            إضافات متوفرة للشراء
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            اضغط "اشترِ" لإرسال طلب الشراء إلى فريق ثقة. سيتم تفعيل الإضافة تلقائياً فور الموافقة.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ADDON_CATALOG.map((item) => {
              const price = catalogPrices[item.settingKey] ?? item.defaultPrice;
              const isPending = pendingAddonTypes.has(item.type);
              return (
                <div
                  key={item.type}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/40 transition-colors"
                >
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <item.Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{item.desc}</p>
                    <div className="flex items-baseline gap-1 mt-1.5">
                      {item.startingFrom && (
                        <span className="text-[10px] text-muted-foreground">من</span>
                      )}
                      <span className="text-base font-bold text-primary tabular-nums">₪{price}</span>
                      <span className="text-[11px] text-muted-foreground">{item.priceSuffix}</span>
                    </div>
                  </div>
                  {isPending ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300"
                      disabled
                    >
                      <Clock className="h-3.5 w-3.5" />
                      قيد المراجعة
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-8 gap-1 shrink-0"
                      onClick={() => {
                        setPendingItem(item);
                        setPendingQuantity(1);
                      }}
                    >
                      اشترِ
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Purchase confirmation dialog */}
      <Dialog
        open={!!pendingItem}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            setPendingItem(null);
            setPendingQuantity(1);
          }
        }}
      >
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingItem && <pendingItem.Icon className="h-5 w-5 text-primary" />}
              تأكيد شراء {pendingItem?.label}
            </DialogTitle>
            <DialogDescription className="text-right pt-1">
              سيُرسَل طلبك إلى فريق ثقة للمراجعة. لن يتم خصم أي مبلغ قبل التأكيد — الإضافة تُفعَّل فور الموافقة وتُضاف إلى فاتورة الشهر الحالي.
            </DialogDescription>
          </DialogHeader>
          {pendingItem && (
            <div className="space-y-4 py-2">
              {pendingItem.billing === 'monthly' && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">الكمية</label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={pendingQuantity}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setPendingQuantity(Number.isFinite(v) && v > 0 ? Math.min(50, v) : 1);
                    }}
                    className="h-10 text-lg font-semibold tabular-nums text-center"
                  />
                </div>
              )}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">سعر الوحدة</span>
                  <span className="font-semibold tabular-nums">
                    ₪{catalogPrices[pendingItem.settingKey] ?? pendingItem.defaultPrice}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">نوع الفوترة</span>
                  <span className="font-semibold">
                    {pendingItem.billing === 'monthly' ? 'شهري متكرر' : 'مرة واحدة'}
                  </span>
                </div>
                <div className="h-px bg-border my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {pendingItem.billing === 'monthly' ? 'الإجمالي الشهري' : 'المبلغ الإجمالي'}
                  </span>
                  <span className="text-2xl font-bold tabular-nums text-primary">
                    ₪
                    {(
                      (catalogPrices[pendingItem.settingKey] ?? pendingItem.defaultPrice) *
                      pendingQuantity
                    ).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setPendingItem(null);
                setPendingQuantity(1);
              }}
              disabled={submitting}
            >
              إلغاء
            </Button>
            <Button onClick={handleConfirmPurchase} disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
              ) : (
                <ShoppingCart className="h-4 w-4 ml-2" />
              )}
              تأكيد وإرسال الطلب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
