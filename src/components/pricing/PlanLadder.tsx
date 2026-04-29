import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle,
  Sparkle,
  TrendUp,
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
  description?: string | null;
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

const RESOURCE_META: Record<LimitResource, { label: string }> = {
  users: { label: 'المستخدمين' },
  branches: { label: 'الفروع' },
  policies: { label: 'المعاملات' },
  sms: { label: 'الرسائل النصية' },
  marketing_sms: { label: 'الرسائل التسويقية' },
  ai: { label: 'ثاقب AI' },
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
 * Plan grid used by both the upgrade popup and the subscription page.
 * Fetches subscription_plans itself (unless `plans` is passed in),
 * highlights the caller's current plan, and opens the shared
 * PlanChangeConfirmDialog when a card's CTA is clicked.
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
  const [confirmTarget, setConfirmTarget] = useState<PlanTarget | null>(null);

  useEffect(() => {
    if (plansProp) { setPlans(plansProp); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Pull every active plan including the free tier — the subscription
      // page now surfaces it as a real card so trial users can opt down to
      // a permanent free seat instead of the sales-y popup we used to ship.
      const { data } = await supabase
        .from('subscription_plans')
        .select('plan_key, name, name_ar, description, badge, monthly_price, yearly_price, users_limit, branches_limit, policies_limit, sms_limit, marketing_sms_limit, ai_limit, support_sla_hours, sort_order, default_features')
        .eq('is_active', true)
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

  // 5 columns at xl (Free + 4 paid), graceful fallback below.
  const gridCols = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4';

  if (loading) {
    return (
      <div className={cn(gridCols, className)}>
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-[520px] rounded-2xl" />
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
      <div className={cn(gridCols, className)}>
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
              resourceMetaLabel={meta?.label ?? null}
              newQuota={newQuota ?? null}
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
  resourceMetaLabel,
  newQuota,
  onSelect,
}: {
  plan: PlanRow;
  isCurrent: boolean;
  isPopular: boolean;
  isFeatureLock: boolean;
  featureIncluded: boolean | null;
  featureLabel: string | undefined;
  resourceMetaLabel: string | null;
  newQuota: number | null;
  onSelect: () => void;
}) {
  // Per-card billing toggle — Strain-style. Default to monthly.
  const [yearly, setYearly] = useState(false);
  const isFree = plan.monthly_price === 0;
  const hasYearly = !isFree && plan.yearly_price !== null && plan.yearly_price > 0;
  const monthlyPrice = plan.monthly_price;
  const yearlyTotal = plan.yearly_price ?? 0;
  const yearlyMonthlyEquiv = hasYearly ? Math.round((yearlyTotal / 12) * 100) / 100 : monthlyPrice;
  const annualSavings = hasYearly ? Math.max(0, monthlyPrice * 12 - yearlyTotal) : 0;
  const displayPrice = yearly && hasYearly ? yearlyMonthlyEquiv : monthlyPrice;

  // Compile the feature list from the catalog, only including features
  // this plan flags as enabled. Capacity rows (users/branches/etc.)
  // come first since they're what users care most about, then the
  // catalog-driven feature list keeps coming straight from the DB row.
  const includedCatalogFeatures = PLAN_FEATURE_CATALOG.flatMap((g) => g.items).filter(
    (f) => plan.default_features?.[f.key] === true,
  );

  const capacityLines: string[] = [];
  if (plan.users_limit !== 0) {
    capacityLines.push(
      plan.users_limit === null
        ? 'مستخدمون غير محدودون'
        : `حتى ${plan.users_limit} ${plan.users_limit === 1 ? 'مستخدم' : 'مستخدمين'}`,
    );
  }
  if (plan.branches_limit !== 0) {
    capacityLines.push(
      plan.branches_limit === null
        ? 'فروع غير محدودة'
        : `${plan.branches_limit} ${plan.branches_limit === 1 ? 'فرع' : 'فروع'}`,
    );
  }
  if (plan.policies_limit !== 0) {
    capacityLines.push(
      plan.policies_limit === null
        ? 'معاملات غير محدودة'
        : `${plan.policies_limit} معاملة شهرياً`,
    );
  }
  if (plan.sms_limit > 0) capacityLines.push(`${plan.sms_limit} SMS / شهر`);
  if (plan.marketing_sms_limit > 0) capacityLines.push(`${plan.marketing_sms_limit} SMS تسويقية / شهر`);
  if (plan.ai_limit > 0) capacityLines.push(`${plan.ai_limit} طلب AI / شهر`);

  return (
    <div
      className={cn(
        'relative rounded-2xl bg-white p-6 transition-all duration-200 flex flex-col',
        isCurrent
          ? 'ring-2 ring-emerald-500 shadow-[0_18px_48px_-18px_rgba(16,185,129,0.4)]'
          : isPopular
            ? 'ring-2 ring-black shadow-[0_18px_48px_-18px_rgba(0,0,0,0.18)]'
            : 'ring-1 ring-black/[0.08] hover:ring-black/[0.18] hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.12)]',
      )}
    >
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-emerald-500 text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-md whitespace-nowrap">
          <CheckCircle className="h-3.5 w-3.5" weight="fill" />
          حزمتك الحالية
        </div>
      )}
      {!isCurrent && isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 bg-violet-100 border border-violet-200 text-violet-700 text-[11px] font-bold px-3 py-1 rounded-full whitespace-nowrap">
          <Sparkle className="h-3 w-3" weight="fill" />
          {plan.badge}
        </div>
      )}

      {/* Tier name + Latin label */}
      <div>
        <h3 className="text-xl font-extrabold tracking-tight">{plan.name_ar || plan.name}</h3>
        <p className="text-[11px] text-black/50 mt-0.5 uppercase tracking-[0.18em] font-semibold">
          {plan.name}
        </p>
        {plan.description && (
          <p className="text-xs text-black/60 mt-2 leading-relaxed">{plan.description}</p>
        )}
      </div>

      {/* Price block */}
      <div className="mt-5">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-black tabular-nums leading-none">
            {isFree ? 'مجاناً' : `₪${displayPrice}`}
          </span>
          {!isFree && <span className="text-sm text-black/60 font-semibold">/ شهر</span>}
        </div>
        {!isFree && yearly && hasYearly && (
          <p className="text-[12px] mt-2 font-semibold text-emerald-600">
            وفّر ₪{annualSavings} عند الدفع السنوي
          </p>
        )}
        {!isFree && !yearly && hasYearly && (
          <p className="text-[12px] mt-2 text-black/50">
            أو ₪{yearlyTotal} سنوياً
          </p>
        )}
        {isFree && (
          <p className="text-[12px] mt-2 text-black/50">
            بدون التزامات. للأبد.
          </p>
        )}
      </div>

      {/* Per-card billing toggle (only when yearly pricing is offered) */}
      {hasYearly && (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-black/[0.04] px-3 py-2">
          <span className="text-xs font-semibold text-black/70">
            {yearly ? 'فوترة سنوية' : 'فوترة شهرية'}
          </span>
          <button
            type="button"
            onClick={() => setYearly((v) => !v)}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
              yearly ? 'bg-black' : 'bg-black/15',
            )}
            aria-label={yearly ? 'التبديل لفوترة شهرية' : 'التبديل لفوترة سنوية'}
            role="switch"
            aria-checked={yearly}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform',
                yearly ? 'translate-x-0.5' : 'translate-x-[18px]',
              )}
            />
          </button>
        </div>
      )}

      {/* CTA — black pill at the top of the value section, Strain style. */}
      <div className="mt-5">
        {isCurrent ? (
          <Button
            disabled
            variant="outline"
            className="w-full gap-2 cursor-default rounded-full h-11 border-emerald-300 text-emerald-700"
          >
            <CheckCircle className="h-4 w-4" weight="fill" />
            أنت على هذه الحزمة
          </Button>
        ) : (
          <button
            type="button"
            onClick={onSelect}
            className={cn(
              'w-full inline-flex items-center justify-center gap-2 rounded-full text-[14px] font-bold h-11 px-5 transition-all hover:scale-[1.02]',
              isPopular || !isFree
                ? 'bg-black text-white hover:shadow-[0_10px_28px_-8px_rgba(0,0,0,0.35)]'
                : 'bg-white text-black border border-black/[0.18] hover:bg-black/[0.04]',
            )}
          >
            <span>{isFree ? 'ابدأ مجاناً' : 'اختيار هذه الحزمة'}</span>
            <ArrowRight className="h-4 w-4 -scale-x-100" weight="bold" />
          </button>
        )}
      </div>

      {/* Optional contextual highlights — feature lock or quota bump. */}
      {isFeatureLock && featureIncluded !== null && (
        <div
          className={cn(
            'mt-4 p-3 rounded-xl border text-center',
            featureIncluded ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200',
          )}
        >
          <p className="text-[11px] text-black/50 truncate">{featureLabel}</p>
          <p
            className={cn(
              'text-sm font-bold mt-0.5 inline-flex items-center gap-1.5',
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
      {!isFeatureLock && resourceMetaLabel && (
        <div className="mt-4 p-3 rounded-xl bg-black/[0.04] border border-black/[0.06]">
          <p className="text-[11px] text-black/50">{resourceMetaLabel} في هذه الحزمة</p>
          <p className="text-xl font-extrabold mt-0.5 tabular-nums">{formatLimit(newQuota)}</p>
        </div>
      )}

      {/* What's in the path */}
      <div className="mt-6 pt-6 border-t border-black/[0.06] flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-black/50 mb-3">
          ما هو في هذه الحزمة؟
        </p>
        <ul className="space-y-2.5 text-sm">
          {capacityLines.map((line) => (
            <FeatureLine key={line} label={line} />
          ))}
          {includedCatalogFeatures.map((f) => (
            <FeatureLine key={f.key} label={f.label} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function FeatureLine({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 mt-px">
        <Check className="h-3 w-3 text-emerald-600" weight="bold" />
      </span>
      <span className="text-black/80">{label}</span>
    </li>
  );
}
