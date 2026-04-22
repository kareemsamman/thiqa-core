import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Crown, MessageCircle, ShoppingCart, Tag, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { useAgentLimits, ResourceLimit } from '@/hooks/useAgentLimits';
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

function UsageRow({
  label,
  limit,
  unit = '',
}: {
  label: string;
  limit: ResourceLimit;
  unit?: string;
}) {
  const usedText = limit.effective === null
    ? `${limit.used}${unit} مستخدم`
    : `${limit.used}${unit} / ${limit.effective}${unit}`;

  const percent = limit.effective === null
    ? 0
    : Math.min(100, (limit.used / Math.max(1, limit.effective)) * 100);

  const color = limit.effective === null
    ? 'bg-primary/60'
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
          {limit.effective === null ? 'غير محدود' : usedText}
          {limit.addonQuantity > 0 && limit.effective !== null && (
            <span className="text-emerald-600 text-xs mr-1">(+{limit.addonQuantity} إضافي)</span>
          )}
        </span>
      </div>
      {limit.effective !== null && (
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full transition-all', color)}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Agent-facing summary of their plan — the view that matches the
 * pricing model (plan + discount + addons + per-resource usage).
 * Lives at the top of /subscription → تبويب الاشتراك.
 *
 * "Buy add-on" button opens a prefilled WhatsApp message to Thiqa
 * support, since actual addon provisioning happens from the Thiqa
 * admin side (purchase-usage-overage edge function + AgentAddonsManager).
 */
export function AgentPlanOverview() {
  const { agent, planInfo } = useAgentContext();
  const limits = useAgentLimits();
  const [discount, setDiscount] = useState<ActiveDiscount | null>(null);
  const [addons, setAddons] = useState<ActiveAddon[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agent?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      try {
        const [discountResp, addonsResp] = await Promise.all([
          supabase
            .from('agent_discounts')
            .select('discounted_price, starts_at, ends_at, reason')
            .eq('agent_id', agent.id)
            .lte('starts_at', today)
            .gte('ends_at', today)
            .order('starts_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('agent_addons')
            .select('id, addon_type, quantity, unit_price, billing_cycle, ends_at')
            .eq('agent_id', agent.id)
            .eq('status', 'active')
            .lte('starts_at', today)
            .or(`ends_at.is.null,ends_at.gte.${today}`)
            .order('created_at', { ascending: false }),
        ]);
        if (cancelled) return;
        setDiscount((discountResp.data as ActiveDiscount | null) ?? null);
        setAddons((addonsResp.data as ActiveAddon[] | null) ?? []);
      } catch (error) {
        console.error('Error loading plan overview:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent?.id]);

  if (!planInfo || !agent) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  const effectivePrice = discount?.discounted_price ?? planInfo.monthly_price;
  const discountApplied = discount !== null;

  const recurringAddonsTotal = addons
    .filter((a) => a.billing_cycle === 'monthly')
    .reduce((sum, a) => sum + a.quantity * a.unit_price, 0);

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
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <a href={whatsAppHref} target="_blank" rel="noopener noreferrer">
                <Button variant="default" size="sm" className="gap-2">
                  <TrendingUp className="h-4 w-4" />
                  طلب شراء إضافة
                </Button>
              </a>
              <a href="https://wa.me/972525143581" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="gap-2">
                  <MessageCircle className="h-4 w-4" />
                  تواصل
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
          ) : addons.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
              <ShoppingCart className="h-6 w-6 opacity-40" />
              <p className="text-sm">لا توجد إضافات فعّالة</p>
              <a href={whatsAppHref} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="mt-1">
                  طلب شراء إضافة
                </Button>
              </a>
            </div>
          ) : (
            <div className="space-y-2">
              {addons.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div>
                    <p className="font-medium text-sm">{ADDON_LABELS[a.addon_type] || a.addon_type}</p>
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
