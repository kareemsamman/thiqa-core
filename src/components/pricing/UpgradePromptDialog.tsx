import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TrendUp,
  Users,
  Buildings,
  FileText,
  Envelope,
  Megaphone,
  Robot,
  Check,
  X,
  Lock,
  CheckCircle,
  Crown,
  Sparkle,
  CaretDown,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { cn } from '@/lib/utils';
import { PLAN_FEATURE_CATALOG } from '@/lib/planFeatureCatalog';

export type LimitResource = 'users' | 'branches' | 'policies' | 'sms' | 'marketing_sms' | 'ai';

interface UpgradePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quota-limit variant (user hit the cap on a countable resource). */
  resource?: LimitResource;
  current?: number;
  limit?: number;
  /** Feature-lock variant (user clicked a sidebar item their plan doesn't include). */
  featureLabel?: string;
  featureKey?: string;
}

interface PlanRow {
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

/**
 * Upgrade popup shown when a user hits a plan limit or clicks a locked
 * feature. Always shows the full ladder (Entry → Basic → Professional
 * → Ultimate) in fixed order so the user can compare where they are
 * against what the next tiers unlock. The current plan card gets a
 * distinct highlight; other cards stay tappable with a CTA to the
 * subscription page.
 */
export function UpgradePromptDialog({
  open,
  onOpenChange,
  resource,
  current,
  limit,
  featureLabel,
  featureKey,
}: UpgradePromptDialogProps) {
  const isFeatureLock = !!featureLabel;
  const { planInfo, agent } = useAgentContext();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [copy, setCopy] = useState<{ title: string; subtitle: string; cta: string }>({
    title: 'لقد وصلت إلى حد حزمتك',
    subtitle: 'طوّر حزمتك للحصول على المزيد من الميزات',
    cta: 'عرض الحزم',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const [plansResp, settingsResp] = await Promise.all([
          supabase
            .from('subscription_plans')
            .select('plan_key, name, name_ar, badge, monthly_price, yearly_price, users_limit, branches_limit, policies_limit, sms_limit, marketing_sms_limit, ai_limit, support_sla_hours, sort_order, default_features')
            .eq('is_active', true)
            .neq('plan_key', 'free_trial')
            .order('sort_order'),
          supabase
            .from('thiqa_platform_settings')
            .select('setting_key, setting_value')
            .in('setting_key', ['upgrade_popup_title', 'upgrade_popup_subtitle', 'upgrade_popup_cta_label']),
        ]);
        if (cancelled) return;

        if (plansResp.data) {
          setPlans(
            plansResp.data.map((p) => ({
              ...p,
              monthly_price: Number(p.monthly_price),
              yearly_price: p.yearly_price !== null ? Number(p.yearly_price) : null,
              default_features:
                typeof p.default_features === 'string'
                  ? JSON.parse(p.default_features)
                  : (p.default_features as Record<string, boolean>) ?? {},
            })) as PlanRow[],
          );
        }

        const settingsMap = new Map<string, string>();
        (settingsResp.data ?? []).forEach((s) => settingsMap.set(s.setting_key, s.setting_value ?? ''));
        setCopy({
          title: settingsMap.get('upgrade_popup_title') || 'لقد وصلت إلى حد حزمتك',
          subtitle: settingsMap.get('upgrade_popup_subtitle') || 'طوّر حزمتك للحصول على المزيد من الميزات',
          cta: settingsMap.get('upgrade_popup_cta_label') || 'عرض الحزم',
        });
      } catch (error) {
        console.error('Error loading upgrade prompt data:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  const meta = resource ? RESOURCE_META[resource] : null;
  const HeroIcon = isFeatureLock ? Lock : meta?.icon ?? Lock;
  const currentPlanKey = planInfo?.plan_key ?? null;
  const isOnTrial = agent?.subscription_status === 'trial' ||
    (agent?.monthly_price === 0 && agent?.subscription_status === 'active');
  // Lifted so clicking "show details" on any card expands all four
  // cards at once — users compare features across plans side by side
  // instead of expanding each one separately.
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    if (!open) setDetailsOpen(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="w-[94vw] max-w-[1180px] max-h-[94vh] overflow-hidden flex flex-col p-0 gap-0 border-0 shadow-2xl"
        dir="rtl"
      >
        {/* Custom close button — circular, glassy, always visible over the hero gradient */}
        <DialogClose className="absolute top-4 left-4 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white ring-1 ring-white/30 backdrop-blur-sm transition-all hover:bg-white/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white">
          <X className="h-4 w-4" weight="bold" />
          <span className="sr-only">إغلاق</span>
        </DialogClose>

        {/* Hero — vivid multi-stop gradient (blue → violet → pink → orange) */}
        <DialogHeader className="relative px-8 pt-8 pb-7 overflow-hidden border-b">
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(120deg, #3b2fd8 0%, #6a3bd1 28%, #c93fa8 58%, #ed6a44 85%, #f5a548 100%)',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(1200px 400px at 10% 0%, rgba(255,255,255,0.25), transparent 55%), radial-gradient(900px 500px at 95% 100%, rgba(255,255,255,0.18), transparent 60%)',
            }}
          />
          <div
            className="absolute inset-0 mix-blend-overlay opacity-20"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 30%, white 0%, transparent 35%), radial-gradient(circle at 80% 70%, white 0%, transparent 40%)',
            }}
          />
          <div className="relative flex items-start gap-4 pl-12">
            <div className="h-16 w-16 rounded-2xl bg-white/25 backdrop-blur flex items-center justify-center ring-1 ring-white/40 shadow-lg shrink-0">
              <HeroIcon className="h-8 w-8 text-white" weight="duotone" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-2xl md:text-[28px] font-bold text-white mb-1.5 tracking-tight drop-shadow-sm">
                {isFeatureLock
                  ? `"${featureLabel}" غير متوفر في حزمتك`
                  : copy.title}
              </DialogTitle>
              <DialogDescription className="text-sm md:text-base text-white/90 drop-shadow-sm">
                {isFeatureLock
                  ? 'هذه الميزة مفتوحة في الحزم الموضّحة أدناه — اختر الحزمة الأنسب لوكالتك للوصول إليها.'
                  : copy.subtitle}
              </DialogDescription>
            </div>
          </div>

          {/* Current-state chips */}
          {planInfo && (
            <div className="relative mt-5 flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3.5 py-1.5 text-xs text-white ring-1 ring-white/20">
                <Crown className="h-3.5 w-3.5" weight="fill" />
                <span className="opacity-80">حزمتك الحالية:</span>
                <span className="font-semibold">{planInfo.name_ar || planInfo.name}</span>
              </div>
              {isFeatureLock ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3.5 py-1.5 text-xs text-white ring-1 ring-white/20">
                  <Lock className="h-3.5 w-3.5" weight="fill" />
                  <span className="opacity-80">الميزة المطلوبة:</span>
                  <span className="font-semibold">{featureLabel}</span>
                </div>
              ) : meta && resource ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur px-3.5 py-1.5 text-xs text-white ring-1 ring-white/20">
                  <meta.icon className="h-3.5 w-3.5" weight="fill" />
                  <span className="opacity-80">{meta.label}:</span>
                  <span className="font-semibold tabular-nums">
                    {current !== undefined && limit !== undefined
                      ? `${current} / ${limit}`
                      : formatLimit(resourceValue(planInfo as unknown as PlanRow, resource))}
                  </span>
                </div>
              ) : null}
              {isOnTrial && (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-300/90 text-amber-950 px-3.5 py-1.5 text-xs font-semibold">
                  <Sparkle className="h-3.5 w-3.5" weight="fill" />
                  أنت على الفترة التجريبية
                </div>
              )}
            </div>
          )}
        </DialogHeader>

        {/* Plans ladder */}
        <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6 bg-slate-50/50">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-lg font-bold">الحزم المتاحة</h3>
            <p className="text-xs text-muted-foreground">
              {isFeatureLock
                ? 'الحزم التي تتضمن هذه الميزة مميّزة بعلامة خضراء'
                : 'اختر الحزمة التي تناسب حجم وكالتك'}
            </p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-80 rounded-2xl" />
              ))}
            </div>
          ) : plans.length === 0 ? (
            <div className="text-center py-12">
              <TrendUp className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-lg font-medium mb-2">لا توجد حزم متاحة حالياً</p>
              <p className="text-sm text-muted-foreground">تواصل مع إدارة ثقة لمزيد من التفاصيل.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                    onSelect={() => {
                      onOpenChange(false);
                      window.location.href = '/subscription';
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 md:px-8 py-4 border-t bg-white flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            لترقية حزمتك أو شراء إضافات، تواصل مع إدارة ثقة على واتساب.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إغلاق
            </Button>
            <Button
              onClick={() => {
                onOpenChange(false);
                window.location.href = '/subscription';
              }}
              className="gap-2"
            >
              <TrendUp className="h-4 w-4" />
              {copy.cta}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
      {/* Ribbons */}
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

      {/* Title + price */}
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

      {/* Highlight strip — feature inclusion or new quota */}
      {isFeatureLock && featureIncluded !== null && (
        <div
          className={cn(
            'mb-4 p-3 rounded-xl border',
            featureIncluded
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-slate-50 border-slate-200',
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

      {/* Quotas snapshot */}
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

      {/* Expandable full-feature list — lifted state means clicking
          "show details" on any card expands all four at once so the
          user can compare features plan-by-plan side by side. Toggle
          lives at the BOTTOM of the expanded list so the user scrolls
          through the details and collapses from where they finished. */}
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

      {/* CTA */}
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
