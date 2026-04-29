import { useEffect, useState } from 'react';
import {
  Buildings,
  CaretDown,
  Check,
  CheckCircle,
  Envelope,
  FileText,
  Megaphone,
  Robot,
  Sparkle,
  TrendUp,
  Users,
  X,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PLAN_FEATURE_CATALOG } from '@/lib/planFeatureCatalog';
import { PlanChangeConfirmDialog, type PlanTarget } from './PlanChangeConfirmDialog';
import { useAgentContext } from '@/hooks/useAgentContext';

export type LimitResource = 'users' | 'branches' | 'policies' | 'sms' | 'marketing_sms' | 'ai';

export interface PlanRow {
  plan_key: string;
  name: string;
  name_ar: string | null;
  badge: string | null;
  monthly_price: number;
  yearly_price: number | null;
  users_limit: number | null;
  branches_limit: number | null;
  policies_limit: number | null;
  sms_limit: number;
  marketing_sms_limit: number;
  ai_limit: number;
  support_sla_hours: number;
  sort_order: number;
  default_features: Record<string, boolean>;
}

const RESOURCE_META: Record<LimitResource, { label: string; icon: typeof Users }> = {
  users: { label: 'المستخدمين', icon: Users },
  branches: { label: 'الفروع', icon: Buildings },
  policies: { label: 'المعاملات', icon: FileText },
  sms: { label: 'الرسائل النصية', icon: Envelope },
  marketing_sms: { label: 'الرسائل التسويقية', icon: Megaphone },
  ai: { label: 'ثاقب AI', icon: Robot },
};

function formatLimit(limit: number | null | undefined): string {
  if (limit === null || limit === undefined) return 'غير محدود';
  if (limit === 0) return '—';
  return `${limit}`;
}

function resourceValue(plan: PlanRow, resource: LimitResource): number | null {
  switch (resource) {
    case 'users': return plan.users_limit;
    case 'branches': return plan.branches_limit;
    case 'policies': return plan.policies_limit;
    case 'sms': return plan.sms_limit;
    case 'marketing_sms': return plan.marketing_sms_limit;
    case 'ai': return plan.ai_limit;
  }
}

interface PlanLadderProps {
  /** Optional — when provided skips the internal fetch. */
  plans?: PlanRow[];
  /** Optional feature-lock context: highlights which plans include it. */
  featureKey?: string;
  featureLabel?: string;
  /** Optional quota-limit context: shows new cap per plan. */
  resource?: LimitResource;
  /** Called after a plan change is confirmed via the edge function. */
  onPlanChanged?: () => void;
  className?: string;
}

/**
 * Four-card plan grid used by both the upgrade popup and the subscription
 * page. Fetches subscription_plans itself (unless `plans` is passed in),
 * highlights the caller's current plan, and opens the shared
 * PlanChangeConfirmDialog when a card's CTA is clicked — so the flow
 * (from → to summary + billing math + support email) stays identical
 * whichever surface the user lands on.
 */
export function PlanLadder({
  plans: plansProp,
  featureKey,
  featureLabel,
  resource,
  onPlanChanged,
  className,
}: PlanLadderProps) {
  const { planInfo, agent } = useAgentContext();
  const [plans, setPlans] = useState<PlanRow[]>(plansProp ?? []);
  const [loading, setLoading] = useState(!plansProp);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<PlanTarget | null>(null);

  useEffect(() => {
    if (plansProp) { setPlans(plansProp); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('subscription_plans')
        .select('plan_key, name, name_ar, badge, monthly_price, yearly_price, users_limit, branches_limit, policies_limit, sms_limit, marketing_sms_limit, ai_limit, support_sla_hours, sort_order, default_features')
        .eq('is_active', true)
        .neq('plan_key', 'free_trial')
        .order('sort_order');
      if (cancelled) return;
      const rows = (data ?? []).map((p) => ({
        ...p,
        monthly_price: Number(p.monthly_price),
        yearly_price: p.yearly_price !== null ? Number(p.yearly_price) : null,
        default_features:
          typeof p.default_features === 'string'
            ? JSON.parse(p.default_features)
            : (p.default_features as Record<string, boolean>) ?? {},
      })) as PlanRow[];
      setPlans(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [plansProp]);

  const meta = resource ? RESOURCE_META[resource] : null;
  const isFeatureLock = !!featureKey;
  const currentPlanKey = planInfo?.plan_key ?? null;
  const isOnTrial =
    agent?.subscription_status === 'trial' ||
    (agent?.monthly_price === 0 && agent?.subscription_status === 'active');

  if (loading) {
    return (
      <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4', className)}>
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-80 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className={cn('text-center py-12', className)}>
        <TrendUp className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
        <p className="text-lg font-medium mb-2">لا توجد حزم متاحة حالياً</p>
        <p className="text-sm text-muted-foreground">تواصل مع إدارة ثقة لمزيد من التفاصيل.</p>
      </div>
    );
  }

  return (
    <>
      <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4', className)}>
        {plans.map((plan) => {
          const isCurrent = plan.plan_key === currentPlanKey;
          const isPopular = !!plan.badge;
          const featureIncluded =
            isFeatureLock && featureKey
              ? plan.default_features?.[featureKey] === true
              : null;
          const newQuota = resource ? resourceValue(plan, resource) : null;
          return (
            <PlanCard
              key={plan.plan_key}
              plan={plan}
              isCurrent={isCurrent}
              isPopular={isPopular}
              isFeatureLock={isFeatureLock}
              featureIncluded={featureIncluded}
              featureLabel={featureLabel}
              resourceMeta={meta}
              newQuota={newQuota ?? null}
              detailsOpen={detailsOpen}
              onToggleDetails={() => setDetailsOpen((v) => !v)}
              onSelect={() => setConfirmTarget(plan)}
            />
          );
        })}
      </div>

      {isOnTrial && (
        <p className="mt-4 text-xs text-muted-foreground flex items-center gap-1.5">
          <Sparkle className="h-3.5 w-3.5 text-amber-500" weight="fill" />
          خلال الفترة التجريبية، الحزمة التي تختارها تُفعَّل تلقائياً عند انتهاء التجربة. يمكنك تغيير اختيارك في أي وقت قبل ذلك.
        </p>
      )}

      <PlanChangeConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(v) => !v && setConfirmTarget(null)}
        targetPlan={confirmTarget}
        onSuccess={() => onPlanChanged?.()}
      />
    </>
  );
}

function PlanCard({
  plan,
  isCurrent,
  isPopular,
  isFeatureLock,
  featureIncluded,
  featureLabel,
  resourceMeta,
  newQuota,
  detailsOpen,
  onToggleDetails,
  onSelect,
}: {
  plan: PlanRow;
  isCurrent: boolean;
  isPopular: boolean;
  isFeatureLock: boolean;
  featureIncluded: boolean | null;
  featureLabel: string | undefined;
  resourceMeta: { label: string; icon: typeof Users } | null;
  newQuota: number | null;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      className={cn(
        'group relative rounded-2xl bg-white p-5 transition-all duration-200 flex flex-col',
        isCurrent
          ? 'ring-2 ring-emerald-500 shadow-[0_12px_32px_-12px_rgba(16,185,129,0.35)]'
          : isPopular
          ? 'ring-2 ring-primary shadow-[0_12px_32px_-12px_rgba(69,94,187,0.35)] hover:shadow-[0_16px_40px_-12px_rgba(69,94,187,0.45)]'
          : 'ring-1 ring-slate-200 hover:ring-primary/40 hover:shadow-lg',
      )}
    >
      {isCurrent && (
        <div className="absolute -top-3 right-5 inline-flex items-center gap-1 bg-emerald-500 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow-md">
          <CheckCircle className="h-3.5 w-3.5" weight="fill" />
          حزمتك الحالية
        </div>
      )}
      {!isCurrent && isPopular && (
        <div className="absolute -top-3 right-5 inline-flex items-center gap-1 bg-primary text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow-md">
          <Sparkle className="h-3.5 w-3.5" weight="fill" />
          {plan.badge}
        </div>
      )}

      <div className="mb-4">
        <p className="text-lg font-bold tracking-tight">{plan.name_ar || plan.name}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wider">{plan.name}</p>
        <div className="flex items-baseline gap-1 mt-3">
          <span className="text-3xl font-extrabold tabular-nums">₪{plan.monthly_price}</span>
          <span className="text-sm text-muted-foreground">/ شهر</span>
        </div>
        {plan.yearly_price !== null && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            أو ₪{plan.yearly_price} سنوياً
          </p>
        )}
      </div>

      {isFeatureLock && featureIncluded !== null && (
        <div
          className={cn(
            'mb-4 p-3 rounded-xl border',
            featureIncluded ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200',
          )}
        >
          <p className="text-[11px] text-muted-foreground truncate">{featureLabel}</p>
          <p
            className={cn(
              'text-sm font-bold mt-0.5 flex items-center gap-1.5',
              featureIncluded ? 'text-emerald-700' : 'text-slate-400',
            )}
          >
            {featureIncluded ? (
              <>
                <CheckCircle className="h-4 w-4" weight="fill" />
                مشمول
              </>
            ) : (
              <>
                <X className="h-4 w-4" weight="bold" />
                غير مشمول
              </>
            )}
          </p>
        </div>
      )}
      {!isFeatureLock && resourceMeta && (
        <div className="mb-4 p-3 rounded-xl bg-primary/5 border border-primary/15">
          <p className="text-[11px] text-muted-foreground">{resourceMeta.label} في هذه الحزمة</p>
          <p className="text-xl font-extrabold text-primary mt-0.5 tabular-nums">
            {formatLimit(newQuota)}
          </p>
        </div>
      )}

      <div className="space-y-2 text-sm flex-1">
        <QuotaRow icon={Users} label="مستخدم" value={formatLimit(plan.users_limit)} />
        <QuotaRow icon={Buildings} label="فرع" value={formatLimit(plan.branches_limit)} />
        <QuotaRow icon={FileText} label="معاملة" value={formatLimit(plan.policies_limit)} />
        <QuotaRow icon={Envelope} label="SMS / شهر" value={plan.sms_limit ? `${plan.sms_limit}` : '—'} />
        <QuotaRow
          icon={Megaphone}
          label="SMS تسويقية / شهر"
          value={plan.marketing_sms_limit ? `${plan.marketing_sms_limit}` : '—'}
        />
        <QuotaRow icon={Robot} label="طلب AI / شهر" value={plan.ai_limit ? `${plan.ai_limit}` : '—'} />
      </div>

      {detailsOpen && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
          {PLAN_FEATURE_CATALOG.map((group) => (
            <div key={group.group}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                {group.group}
              </p>
              <ul className="space-y-1.5">
                {group.items.map((f) => {
                  const has = plan.default_features?.[f.key] === true;
                  return (
                    <li
                      key={f.key}
                      className={cn(
                        'flex items-center gap-2 text-sm',
                        has ? 'text-slate-900 font-medium' : 'text-slate-500',
                      )}
                    >
                      {has ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-white shrink-0">
                          <Check className="h-3 w-3" weight="bold" />
                        </span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-slate-400 shrink-0">
                          <X className="h-3 w-3" weight="bold" />
                        </span>
                      )}
                      <span className="truncate">{f.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onToggleDetails}
        className="mt-4 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
      >
        {detailsOpen ? 'إخفاء التفاصيل' : 'عرض جميع الميزات'}
        <CaretDown
          className={cn('h-3.5 w-3.5 transition-transform', detailsOpen && 'rotate-180')}
          weight="bold"
        />
      </button>

      <div className="mt-5">
        {isCurrent ? (
          <Button disabled variant="outline" className="w-full gap-2 cursor-default">
            <CheckCircle className="h-4 w-4" weight="fill" />
            أنت على هذه الحزمة
          </Button>
        ) : (
          <Button
            onClick={onSelect}
            variant={isPopular ? 'default' : 'outline'}
            className="w-full gap-2"
          >
            اختيار هذه الحزمة
            <TrendUp className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function QuotaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  const isEmpty = value === '—';
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 px-2 py-1 rounded-lg',
        isEmpty && 'opacity-50',
      )}
    >
      <div className="flex items-center gap-1.5 text-slate-600 min-w-0">
        <Icon className="h-4 w-4 shrink-0 opacity-70" />
        <span className="truncate">{label}</span>
      </div>
      <span className="font-semibold tabular-nums text-slate-900">{value}</span>
    </div>
  );
}
