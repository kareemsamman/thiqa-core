import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Crown,
  Sparkles,
  CreditCard,
  ShoppingCart,
  Clock,
  Pause,
  AlertTriangle,
  Tag,
  LucideIcon,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { cn } from '@/lib/utils';
import { getCycleAmount, getCycleLabels } from '@/lib/billingCycle';

type Tone = 'primary' | 'amber' | 'success' | 'destructive' | 'blue';

const TONE: Record<Tone, { card: string; iconBox: string; iconColor: string; valueColor?: string }> = {
  primary: {
    card: 'bg-primary/5 border-primary/15',
    iconBox: 'bg-primary/10',
    iconColor: 'text-primary',
  },
  blue: {
    card: 'bg-blue-500/5 border-blue-500/15',
    iconBox: 'bg-blue-500/10',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
  amber: {
    card: 'bg-amber-500/5 border-amber-500/15',
    iconBox: 'bg-amber-500/10',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  success: {
    card: 'bg-emerald-500/5 border-emerald-500/15',
    iconBox: 'bg-emerald-500/10',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  destructive: {
    card: 'bg-destructive/5 border-destructive/20',
    iconBox: 'bg-destructive/10',
    iconColor: 'text-destructive',
  },
};

function KpiTile({
  title,
  icon: Icon,
  tone,
  loading,
  children,
  footer,
}: {
  title: string;
  icon: LucideIcon;
  tone: Tone;
  loading?: boolean;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <Card className={cn('p-5 rounded-2xl border shadow-sm', t.card)}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[11px] font-bold tracking-[0.04em] text-foreground/70 truncate">{title}</p>
        <div className={cn('rounded-xl p-2.5 shrink-0', t.iconBox)}>
          <Icon className={cn('h-5 w-5', t.iconColor)} />
        </div>
      </div>
      <div className="space-y-2">
        {loading ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <div className="text-2xl font-extrabold text-foreground leading-tight">{children}</div>
        )}
        {footer && (
          <div className="text-[11px] font-medium text-muted-foreground/90 pt-1 border-t border-foreground/5">
            {footer}
          </div>
        )}
      </div>
    </Card>
  );
}

export function SubscriptionKpiRow({ nowTick }: { nowTick: number }) {
  const { agent, planInfo } = useAgentContext();
  const [discount, setDiscount] = useState<{ discounted_price: number; ends_at: string } | null>(null);
  const [addons, setAddons] = useState<Array<{ quantity: number; unit_price: number }>>([]);
  // Latest active payment so the cycle progress bar reflects the
  // actual coverage window (period_end - period_start) rather than a
  // hardcoded 30/365. After a 3-month payment the bar should read
  // "0% منتهية ... من 96 يوم", not "من 30 يوم".
  const [latestPayment, setLatestPayment] = useState<{ period_start: string | null; period_end: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agent?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      try {
        const [discountResp, addonsResp, paymentResp] = await Promise.all([
          supabase
            .from('agent_discounts')
            .select('discounted_price, ends_at')
            .eq('agent_id', agent.id)
            .lte('starts_at', today)
            .gte('ends_at', today)
            .order('starts_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('agent_addons')
            .select('quantity, unit_price')
            .eq('agent_id', agent.id)
            .eq('status', 'active')
            .eq('billing_cycle', 'monthly')
            .lte('starts_at', today)
            .or(`ends_at.is.null,ends_at.gte.${today}`),
          supabase
            .from('agent_subscription_payments')
            .select('period_start, period_end')
            .eq('agent_id', agent.id)
            .not('period_end', 'is', null)
            .order('period_end', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        setDiscount((discountResp.data as { discounted_price: number; ends_at: string } | null) ?? null);
        setAddons((addonsResp.data as Array<{ quantity: number; unit_price: number }> | null) ?? []);
        setLatestPayment((paymentResp.data as { period_start: string | null; period_end: string | null } | null) ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent?.id]);

  if (!agent || !planInfo) {
    return (
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    );
  }

  const status = agent.subscription_status;
  const isTrial = status === 'trial' || (agent.monthly_price === 0 && status === 'active');
  const isPaused = status === 'paused' || status === 'suspended';
  const isCancelled = status === 'cancelled';

  const trialEnd = agent.trial_ends_at
    ? new Date(agent.trial_ends_at)
    : isTrial && agent.subscription_expires_at
    ? new Date(agent.subscription_expires_at)
    : null;
  const expiresAt = agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null;
  const endDate = isTrial ? trialEnd : expiresAt;
  const now = new Date(nowTick);
  const msRemaining = endDate ? Math.max(0, endDate.getTime() - now.getTime()) : 0;
  // Use ceil so the count matches the next-invoice card on the same
  // page (Math.ceil((billingDate - now) / 86400000)). Floor here was
  // showing 96 while the hero card showed 97 for the same expiry.
  const daysRemaining = endDate ? Math.ceil(msRemaining / 86400000) : null;
  const isExpired = endDate ? endDate.getTime() <= now.getTime() : false;

  const cycleLabels = getCycleLabels(agent.billing_cycle);
  // For paid agents, the cycle length comes from the latest payment's
  // (period_end - period_start). A 3-month payment → 96-ish days,
  // not the cycleLabels default of 30. Trial stays at the canonical
  // 35-day window. Falls back to cycleLabels.periodDays when no
  // payment is on file yet.
  const paymentCycleDays = latestPayment?.period_start && latestPayment?.period_end
    ? Math.max(
        1,
        Math.round(
          (new Date(latestPayment.period_end).getTime() - new Date(latestPayment.period_start).getTime()) / 86400000,
        ),
      )
    : null;
  const periodLengthDays = isTrial ? 35 : (paymentCycleDays ?? cycleLabels.periodDays);
  const progress = endDate
    ? Math.min(100, Math.max(0, ((periodLengthDays * 86400000 - msRemaining) / (periodLengthDays * 86400000)) * 100))
    : 0;

  // Tile 1 — status + plan name
  const statusTone: Tone = isPaused
    ? 'amber'
    : isExpired || isCancelled
    ? 'destructive'
    : isTrial
    ? 'blue'
    : 'primary';
  const StatusIcon = isPaused
    ? Pause
    : isExpired || isCancelled
    ? AlertTriangle
    : isTrial
    ? Sparkles
    : Crown;
  const statusLabel = isCancelled
    ? 'اشتراك ملغي'
    : isExpired
    ? 'منتهي'
    : isPaused
    ? 'معلّق'
    : isTrial
    ? 'تجربة مجانية'
    : 'اشتراك فعّال';
  const planLabel = planInfo.name_ar || planInfo.name;

  // Tile 3 — effective price for the agent's billing cycle. Yearly
  // subscribers see the full annual amount; monthly the per-month rate.
  const effectiveMonthly = discount?.discounted_price ?? planInfo.monthly_price;
  const effectivePrice = getCycleAmount(effectiveMonthly, agent.billing_cycle);
  const planFullPrice = getCycleAmount(planInfo.monthly_price, agent.billing_cycle);
  const hasDiscount = discount !== null && discount.discounted_price !== planInfo.monthly_price;

  // Tile 4 — addons monthly total
  const addonsTotal = addons.reduce((sum, a) => sum + a.quantity * a.unit_price, 0);
  const addonsCount = addons.length;

  // Tile 2 — days remaining tone
  const daysTone: Tone = !daysRemaining || daysRemaining <= 7 ? 'destructive' : daysRemaining <= 14 ? 'amber' : 'success';

  return (
    <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
      {/* Tile 1 — current status / plan */}
      <KpiTile
        title="حالة الاشتراك"
        icon={StatusIcon}
        tone={statusTone}
        loading={loading}
        footer={
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] font-semibold">{planLabel}</Badge>
            {planInfo.badge && (
              <Badge className="text-[10px] bg-primary/90 hover:bg-primary/90">{planInfo.badge}</Badge>
            )}
          </div>
        }
      >
        <span className="text-xl">{statusLabel}</span>
      </KpiTile>

      {/* Tile 2 — period countdown */}
      <KpiTile
        title={isTrial ? 'متبقي على انتهاء التجربة' : 'متبقي على التجديد'}
        icon={Clock}
        tone={daysTone}
        loading={loading}
        footer={
          endDate ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] tabular-nums font-semibold">
                <span>{Math.round(progress)}% منتهية</span>
                <span className="text-muted-foreground/80">من {periodLengthDays} يوم</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                <div
                  className={cn(
                    'h-full transition-all',
                    daysTone === 'destructive' ? 'bg-destructive' : daysTone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500',
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null
        }
      >
        {daysRemaining !== null ? (
          <div className="flex items-baseline gap-1.5">
            <span className="tabular-nums">{daysRemaining}</span>
            <span className="text-sm font-semibold text-muted-foreground">يوم</span>
          </div>
        ) : (
          <span className="text-base text-muted-foreground">—</span>
        )}
      </KpiTile>

      {/* Tile 3 — cycle price (yearly subscribers see annual total) */}
      <KpiTile
        title={isTrial ? 'السعر بعد التجربة' : cycleLabels.costTitle}
        icon={CreditCard}
        tone="primary"
        loading={loading}
        footer={
          hasDiscount && discount ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <Tag className="h-3 w-3" />
              خصم ساري — وفّر ₪{getCycleAmount(planInfo.monthly_price - discount.discounted_price, agent.billing_cycle).toLocaleString()}
            </span>
          ) : null
        }
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="tabular-nums">₪{effectivePrice.toLocaleString()}</span>
          <span className="text-sm font-semibold text-muted-foreground">{cycleLabels.adverb}</span>
          {hasDiscount && (
            <span className="text-sm font-semibold text-muted-foreground/70 line-through">
              ₪{planFullPrice.toLocaleString()}
            </span>
          )}
        </div>
      </KpiTile>

      {/* Tile 4 — addons */}
      <KpiTile
        title="الإضافات الفعّالة"
        icon={ShoppingCart}
        tone={addonsCount > 0 ? 'success' : 'primary'}
        loading={loading}
        footer={
          addonsCount > 0 ? (
            <span>{addonsCount} {addonsCount === 1 ? 'إضافة فعّالة' : 'إضافات فعّالة'}</span>
          ) : (
            <span>لا توجد إضافات — أضف من تبويب الإضافات</span>
          )
        }
      >
        <div className="flex items-baseline gap-2">
          <span className="tabular-nums">₪{addonsTotal.toLocaleString()}</span>
          {addonsCount > 0 && <span className="text-sm font-semibold text-muted-foreground">شهرياً</span>}
        </div>
      </KpiTile>
    </div>
  );
}
