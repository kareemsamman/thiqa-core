import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { cn } from '@/lib/utils';

export type LimitResource = 'users' | 'branches' | 'policies' | 'sms' | 'marketing_sms' | 'ai';

interface UpgradePromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: LimitResource;
  current?: number;
  limit?: number;
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
}

const RESOURCE_META: Record<LimitResource, { label: string; icon: typeof Users; accent: string }> = {
  users: { label: 'المستخدمين', icon: Users, accent: 'text-primary' },
  branches: { label: 'الفروع', icon: Buildings, accent: 'text-primary' },
  policies: { label: 'المعاملات', icon: FileText, accent: 'text-primary' },
  sms: { label: 'الرسائل النصية', icon: Envelope, accent: 'text-primary' },
  marketing_sms: { label: 'الرسائل التسويقية', icon: Megaphone, accent: 'text-primary' },
  ai: { label: 'ثاقب AI', icon: Robot, accent: 'text-primary' },
};

function formatLimit(limit: number | null, resource: LimitResource): string {
  if (limit === null) return 'غير محدود';
  if (limit === 0) return 'غير مشمول';
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
 * Marketing-grade upgrade popup shown whenever an action hits a plan
 * limit (DB trigger raises LIMIT_EXCEEDED or a pre-flight useAgentLimits
 * check flags the resource). Always-be-selling design: headline
 * speaks to the specific resource that's blocked, list of every plan
 * above the current one with the upgrade's new value highlighted.
 */
export function UpgradePromptDialog({
  open,
  onOpenChange,
  resource,
  current,
  limit,
}: UpgradePromptDialogProps) {
  const { planInfo } = useAgentContext();
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
            .select('plan_key, name, name_ar, badge, monthly_price, yearly_price, users_limit, branches_limit, policies_limit, sms_limit, marketing_sms_limit, ai_limit, support_sla_hours, sort_order')
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

  const meta = RESOURCE_META[resource];
  const ResourceIcon = meta.icon;
  const currentPlanOrder = planInfo
    ? plans.find((p) => p.plan_key === planInfo.plan_key)?.sort_order ?? 0
    : 0;
  const upgradePlans = plans.filter((p) => p.sort_order > currentPlanOrder);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0" dir="rtl">
        {/* Hero */}
        <DialogHeader className="px-8 pt-8 pb-6 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-b">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-primary/15 flex items-center justify-center">
              <ResourceIcon className="h-7 w-7 text-primary" weight="duotone" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-2xl mb-1">{copy.title}</DialogTitle>
              <DialogDescription className="text-base">
                {copy.subtitle}
              </DialogDescription>
            </div>
          </div>

          {/* Current usage snapshot */}
          {planInfo && (
            <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">حزمتك الحالية</p>
                <p className="text-lg font-bold mt-1">{planInfo.name_ar || planInfo.name}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ResourceIcon className="h-3.5 w-3.5" />
                  {meta.label}
                </p>
                <p className="text-lg font-bold mt-1">
                  {current !== undefined && limit !== undefined
                    ? `${current} / ${limit}`
                    : formatLimit(resourceValue(planInfo as unknown as PlanRow, resource), resource)}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-3 hidden md:block">
                <p className="text-xs text-muted-foreground">السعر الشهري</p>
                <p className="text-lg font-bold mt-1">₪{planInfo.monthly_price}</p>
              </div>
            </div>
          )}
        </DialogHeader>

        {/* Upgrade options */}
        <div className="flex-1 overflow-y-auto px-8 py-6 bg-muted/20">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-xl" />
              ))}
            </div>
          ) : upgradePlans.length === 0 ? (
            <div className="text-center py-12">
              <TrendUp className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-lg font-medium mb-2">أنت على أعلى حزمة متاحة</p>
              <p className="text-sm text-muted-foreground">
                تواصل مع إدارة ثقة لشراء إضافات لحزمتك الحالية.
              </p>
            </div>
          ) : (
            <>
              <h3 className="text-lg font-bold mb-4">رقِّ إلى حزمة أعلى</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {upgradePlans.map((plan) => {
                  const newValue = resourceValue(plan, resource);
                  return (
                    <div
                      key={plan.plan_key}
                      className={cn(
                        'relative rounded-xl border-2 bg-card p-5 transition-all hover:shadow-lg hover:border-primary',
                        plan.badge && 'border-primary shadow-md',
                      )}
                    >
                      {plan.badge && (
                        <Badge className="absolute -top-3 right-5 bg-primary">
                          {plan.badge}
                        </Badge>
                      )}
                      <div className="mb-3">
                        <p className="text-xl font-bold">{plan.name_ar || plan.name}</p>
                        <div className="flex items-baseline gap-1.5 mt-2">
                          <span className="text-3xl font-bold text-primary">₪{plan.monthly_price}</span>
                          <span className="text-sm text-muted-foreground">/ شهر</span>
                        </div>
                        {plan.yearly_price !== null && (
                          <p className="text-xs text-muted-foreground mt-1">
                            أو ₪{plan.yearly_price} سنوياً
                          </p>
                        )}
                      </div>

                      {/* Highlighted resource upgrade */}
                      <div className="mb-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
                        <p className="text-xs text-muted-foreground">{meta.label} في هذه الحزمة</p>
                        <p className={cn('text-2xl font-bold mt-1', meta.accent)}>
                          {formatLimit(newValue ?? null, resource)}
                        </p>
                      </div>

                      {/* Per-plan quotas snapshot */}
                      <div className="space-y-1.5 text-sm">
                        <PlanFeature
                          icon={Users}
                          label={`${formatLimit(plan.users_limit, 'users')} مستخدم`}
                          enabled
                        />
                        <PlanFeature
                          icon={Buildings}
                          label={`${formatLimit(plan.branches_limit, 'branches')} فرع`}
                          enabled
                        />
                        <PlanFeature
                          icon={FileText}
                          label={`${formatLimit(plan.policies_limit, 'policies')} معاملة`}
                          enabled
                        />
                        <PlanFeature
                          icon={Envelope}
                          label={`${plan.sms_limit} SMS / شهر`}
                          enabled={plan.sms_limit > 0}
                        />
                        <PlanFeature
                          icon={Megaphone}
                          label={`${plan.marketing_sms_limit} SMS تسويقية / شهر`}
                          enabled={plan.marketing_sms_limit > 0}
                        />
                        <PlanFeature
                          icon={Robot}
                          label={`${plan.ai_limit} طلب AI / شهر`}
                          enabled={plan.ai_limit > 0}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer CTA */}
        <div className="px-8 py-4 border-t bg-background flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            لترقية حزمتك أو شراء إضافات، تواصل مع إدارة ثقة
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

function PlanFeature({
  icon: Icon,
  label,
  enabled,
}: {
  icon: typeof Users;
  label: string;
  enabled: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2', !enabled && 'text-muted-foreground')}>
      {enabled ? (
        <Check className="h-4 w-4 text-emerald-600 shrink-0" weight="bold" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground/60 shrink-0" weight="bold" />
      )}
      <Icon className="h-4 w-4 shrink-0 opacity-70" />
      <span className={cn(!enabled && 'line-through opacity-60')}>{label}</span>
    </div>
  );
}
