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
import {
  Buildings,
  Crown,
  Envelope,
  FileText,
  Lock,
  Megaphone,
  Robot,
  Sparkle,
  TrendUp,
  Users,
  X,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { PlanLadder, type LimitResource, type PlanRow } from './PlanLadder';

export type { LimitResource };

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
 * Upgrade popup — the hero + context chips live here. The four-card plan
 * grid below is rendered by <PlanLadder/> so the same component is shared
 * with the Subscription page's plan picker; whichever surface the user
 * hits, clicking "اختيار هذه الحزمة" opens the same confirmation dialog
 * and goes through the same change-agent-plan edge function.
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
  const [copy, setCopy] = useState<{ title: string; subtitle: string; cta: string }>({
    title: 'لقد وصلت إلى حد حزمتك',
    subtitle: 'طوّر حزمتك للحصول على المزيد من الميزات',
    cta: 'عرض الحزم',
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('thiqa_platform_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['upgrade_popup_title', 'upgrade_popup_subtitle', 'upgrade_popup_cta_label']);
      if (cancelled || !data) return;
      const map = new Map<string, string>();
      data.forEach((s: any) => map.set(s.setting_key, s.setting_value ?? ''));
      setCopy({
        title: map.get('upgrade_popup_title') || 'لقد وصلت إلى حد حزمتك',
        subtitle: map.get('upgrade_popup_subtitle') || 'طوّر حزمتك للحصول على المزيد من الميزات',
        cta: map.get('upgrade_popup_cta_label') || 'عرض الحزم',
      });
    })();
    return () => { cancelled = true; };
  }, [open]);

  const meta = resource ? RESOURCE_META[resource] : null;
  const HeroIcon = isFeatureLock ? Lock : meta?.icon ?? Lock;
  const isOnTrial = agent?.subscription_status === 'trial' ||
    (agent?.monthly_price === 0 && agent?.subscription_status === 'active');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="w-[94vw] max-w-[1180px] max-h-[94vh] overflow-hidden flex flex-col p-0 gap-0 border-0 shadow-2xl"
        dir="rtl"
      >
        <DialogClose className="absolute top-4 left-4 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-all hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40">
          <X className="h-3.5 w-3.5" weight="bold" />
          <span className="sr-only">إغلاق</span>
        </DialogClose>

        {/* Brand-purple header — same palette as PlanChangeConfirmDialog
            (from-[#5468c4] via-[#4158b0] to-[#2a3878]). Single soft glow
            in the top-right replaces the previous candy/noise overlays
            so the panel reads as confident and premium. */}
        <DialogHeader className="relative px-6 md:px-8 pt-6 pb-6 overflow-hidden bg-gradient-to-br from-[#5468c4] via-[#4158b0] to-[#2a3878]">
          <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-[#8a9adf]/35 blur-3xl pointer-events-none" />
          <div className="relative flex items-start gap-4 pl-12">
            <div className="h-14 w-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center ring-1 ring-white/25 shrink-0">
              <HeroIcon className="h-7 w-7 text-white" weight="duotone" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-2xl md:text-[28px] font-extrabold text-white mb-1.5 tracking-tight leading-tight">
                {isFeatureLock
                  ? `"${featureLabel}" غير متوفر في حزمتك`
                  : copy.title}
              </DialogTitle>
              <DialogDescription className="text-sm md:text-base text-white/80">
                {isFeatureLock
                  ? 'هذه الميزة مفتوحة في الحزم الموضّحة أدناه — اختر الحزمة الأنسب لوكالتك للوصول إليها.'
                  : copy.subtitle}
              </DialogDescription>
            </div>
          </div>

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

        <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6 bg-slate-50/50">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-lg font-bold">الحزم المتاحة</h3>
            <p className="text-xs text-muted-foreground">
              {isFeatureLock
                ? 'الحزم التي تتضمن هذه الميزة مميّزة بعلامة خضراء'
                : 'اختر الحزمة التي تناسب حجم وكالتك'}
            </p>
          </div>

          <PlanLadder
            featureKey={featureKey}
            featureLabel={featureLabel}
            resource={resource}
            onPlanChanged={() => setTimeout(() => onOpenChange(false), 400)}
          />
        </div>

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
