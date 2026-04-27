import { useEffect, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  Buildings,
  CalendarBlank,
  ChatCircle,
  CheckCircle,
  Lightning,
  Sparkle,
  TrendUp,
  Users,
  X,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface PlanTarget {
  plan_key: string;
  name: string;
  name_ar: string | null;
  monthly_price: number;
  yearly_price: number | null;
  users_limit: number | null;
  branches_limit: number | null;
  policies_limit: number | null;
  sms_limit: number;
  marketing_sms_limit: number;
  ai_limit: number;
  default_features: Record<string, boolean>;
}

export type BillingCycle = 'monthly' | 'yearly';

interface PlanChangeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetPlan: PlanTarget | null;
  /** Called after the server confirms the plan switch succeeded. */
  onSuccess?: () => void;
  /** Which cycle the user picked on the plan card (defaults to monthly). */
  initialCycle?: BillingCycle;
}

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function formatArabicDate(d: Date): string {
  return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function computeNextBillingDate(
  billingCycleDay: number | null | undefined,
  today: Date = new Date(),
): Date {
  // Anchor to the billing day if set, otherwise fall back to the 1st.
  const day = billingCycleDay && billingCycleDay >= 1 && billingCycleDay <= 28
    ? billingCycleDay
    : today.getDate();
  const next = new Date(today.getFullYear(), today.getMonth(), day);
  if (next <= today) {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

interface Billing {
  kind: 'trial' | 'upgrade' | 'downgrade' | 'same_price';
  startDate: Date;
  /** The positive or negative prorated amount applied on the next invoice. */
  proratedAmount: number;
  /** Days between now and startDate. */
  daysRemaining: number;
  /** Recurring price of the new plan per cycle (monthly OR yearly). */
  cyclePrice: number;
  /** Which cycle the price is on. */
  cycle: BillingCycle;
}

/**
 * Work out what (if anything) to charge for this switch.
 *
 * Trial users → nothing now, plan starts + billing begins on trialEndsAt.
 * Paid agents mid-cycle → compute the daily price delta × days remaining
 * until the next billing anchor, apply that to the next invoice. Upgrades
 * add a pro-rated charge, downgrades add a credit.
 */
function computeBilling(
  agent: {
    subscription_status: string;
    monthly_price: number | null;
    trial_ends_at: string | null;
    subscription_expires_at: string | null;
    billing_cycle_day: number | null;
    billing_cycle?: BillingCycle | null;
  } | null,
  newMonthlyPrice: number,
  newYearlyPrice: number | null,
  targetCycle: BillingCycle,
  today: Date = new Date(),
): Billing | null {
  if (!agent) return null;

  const isTrial =
    agent.subscription_status === 'trial' ||
    (Number(agent.monthly_price) === 0 && agent.subscription_status === 'active');

  const currentMonthly = Number(agent.monthly_price ?? 0);
  const currentCycle = (agent.billing_cycle as BillingCycle) ?? 'monthly';
  // Fall back to monthly × 12 so a plan without an explicit yearly
  // price still has a sensible annual number.
  const yearlyPrice = newYearlyPrice != null ? newYearlyPrice : newMonthlyPrice * 12;
  const cyclePrice = targetCycle === 'yearly' ? yearlyPrice : newMonthlyPrice;

  if (isTrial) {
    const trialEnd = agent.trial_ends_at ? new Date(agent.trial_ends_at) : null;
    const start = trialEnd && trialEnd > today ? trialEnd : today;
    return {
      kind: 'trial',
      startDate: start,
      proratedAmount: 0,
      daysRemaining: Math.max(0, Math.floor((start.getTime() - today.getTime()) / 86400000)),
      cyclePrice,
      cycle: targetCycle,
    };
  }

  // Paid agent. Prefer subscription_expires_at (explicit end of current
  // paid period) when present, otherwise fall back to billing_cycle_day
  // so pre-billing-anchor agents still get a sensible estimate.
  const explicitEnd = agent.subscription_expires_at
    ? new Date(agent.subscription_expires_at)
    : null;
  const nextBilling =
    explicitEnd && explicitEnd > today
      ? explicitEnd
      : computeNextBillingDate(agent.billing_cycle_day ?? null, today);

  const msPerDay = 86400000;
  const daysRemaining = Math.max(1, Math.ceil((nextBilling.getTime() - today.getTime()) / msPerDay));

  // Switching to yearly OR changing cycles charges the full new cycle
  // up front (credit on the monthly leftover is minimal and not worth
  // the complexity). For like-for-like monthly→monthly switches we
  // keep the original per-day delta pro-rata so small upgrades stay
  // cheap.
  let proratedAmount: number;
  if (targetCycle === 'yearly' || currentCycle !== targetCycle) {
    proratedAmount = Math.round(cyclePrice);
  } else {
    const dailyDelta = (newMonthlyPrice - currentMonthly) / 30;
    proratedAmount = Math.round(dailyDelta * daysRemaining);
  }

  const compareCurrent = currentCycle === 'yearly' ? currentMonthly * 12 : currentMonthly;
  let kind: Billing['kind'];
  if (cyclePrice > compareCurrent) kind = 'upgrade';
  else if (cyclePrice < compareCurrent) kind = 'downgrade';
  else kind = 'same_price';

  return {
    kind,
    startDate: nextBilling,
    proratedAmount,
    daysRemaining,
    cyclePrice,
    cycle: targetCycle,
  };
}

/**
 * Minimal confirm dialog — current → new plan, a single clear billing
 * statement with the exact amount + date, privacy checkbox. Success flips
 * the content to a celebratory panel. Calls the change-agent-plan edge
 * function which logs to plan_change_events and emails
 * support@getthiqa.com.
 */
export function PlanChangeConfirmDialog({
  open,
  onOpenChange,
  targetPlan,
  onSuccess,
  initialCycle = 'monthly',
}: PlanChangeConfirmDialogProps) {
  const { agent, planInfo } = useAgentContext();
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);
  const [successState, setSuccessState] = useState<null | {
    switchMode: 'immediate' | 'after_trial';
    emailSent: boolean;
  }>(null);

  useEffect(() => {
    if (!open) {
      setPrivacyAccepted(false);
      setSubmitting(false);
      setSuccessState(null);
      setCycle(initialCycle);
    } else {
      setCycle(initialCycle);
    }
  }, [open, initialCycle]);

  if (!targetPlan) return null;

  const currentMonthlyPrice = Number(agent?.monthly_price ?? 0);
  const newMonthly = Number(targetPlan.monthly_price);
  const newYearly =
    targetPlan.yearly_price != null ? Number(targetPlan.yearly_price) : null;
  const cyclePrice = cycle === 'yearly' ? (newYearly ?? newMonthly * 12) : newMonthly;
  const billing = computeBilling(agent, newMonthly, newYearly, cycle);
  const yearlySavings =
    newYearly != null ? Math.max(0, Math.round(newMonthly * 12 - newYearly)) : 0;

  const handleConfirm = async () => {
    if (!privacyAccepted || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('change-agent-plan', {
        body: {
          target_plan_key: targetPlan.plan_key,
          privacy_accepted: true,
          billing_cycle: cycle,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'فشل في تغيير الحزمة');
      setSuccessState({
        switchMode: data.switch_mode,
        emailSent: !!data.email_sent,
      });
      onSuccess?.();
    } catch (e: any) {
      toast.error(e?.message || 'تعذّر تغيير الحزمة. حاول مجدداً أو تواصل مع الدعم.');
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent
        hideCloseButton
        className="w-[92vw] max-w-[540px] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 border-0 shadow-2xl rounded-2xl"
        dir="rtl"
      >
        {/* Premium dark header — slate-900 with a subtle primary glow.
            Plan name + price live together as the visual hero. Close
            button is white-on-translucent so it reads against the dark. */}
        <DialogClose className="absolute top-4 left-4 z-30 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-all hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/40">
          <X className="h-3.5 w-3.5" weight="bold" />
          <span className="sr-only">إغلاق</span>
        </DialogClose>

        <DialogHeader
          className={cn(
            'relative px-6 md:px-8 pt-6 pb-6 overflow-hidden',
            successState
              ? 'bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800'
              : 'bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800',
          )}
        >
          {/* Soft brand-color glow in the corner — adds depth without
              the candy-gradient look. */}
          {!successState && (
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/30 blur-3xl pointer-events-none" />
          )}

          <div className="relative">
            {!successState ? (
              <>
                <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-white/60 mb-2">
                  تأكيد تغيير الحزمة
                </p>
                <DialogTitle className="text-3xl md:text-[32px] font-extrabold text-white mb-3 leading-tight">
                  {targetPlan.name_ar || targetPlan.name}
                </DialogTitle>

                {/* Price hero in header — confident, big, with cycle
                    toggle inline and savings badge when relevant. */}
                <div className="flex items-end justify-between gap-3">
                  <div className="flex items-baseline gap-1.5 text-white">
                    <span className="text-[15px] font-medium text-white/60">₪</span>
                    <span className="text-4xl md:text-[40px] font-extrabold tabular-nums leading-none">
                      {cyclePrice.toLocaleString('en')}
                    </span>
                    <span className="text-sm font-medium text-white/60">
                      / {cycle === 'yearly' ? 'سنة' : 'شهر'}
                    </span>
                  </div>
                  {cycle === 'yearly' && yearlySavings > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold ring-1 ring-emerald-400/40">
                      <Sparkle className="h-3 w-3" weight="fill" />
                      وفّر ₪{yearlySavings.toLocaleString('en')}
                    </span>
                  )}
                </div>

                {/* Cycle toggle — subtle pill, white-on-glass */}
                <div className="mt-4 inline-flex gap-1 p-1 rounded-lg bg-white/10 backdrop-blur ring-1 ring-white/15">
                  <button
                    type="button"
                    onClick={() => setCycle('monthly')}
                    className={cn(
                      'px-4 py-1.5 rounded-md text-xs font-semibold transition-all',
                      cycle === 'monthly'
                        ? 'bg-white text-slate-900 shadow'
                        : 'text-white/70 hover:text-white',
                    )}
                  >
                    شهري
                  </button>
                  <button
                    type="button"
                    onClick={() => setCycle('yearly')}
                    className={cn(
                      'px-4 py-1.5 rounded-md text-xs font-semibold transition-all',
                      cycle === 'yearly'
                        ? 'bg-white text-slate-900 shadow'
                        : 'text-white/70 hover:text-white',
                    )}
                  >
                    سنوي
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30 mb-3">
                  <CheckCircle className="h-8 w-8 text-white" weight="fill" />
                </div>
                <p className="text-[10px] uppercase tracking-[0.22em] font-bold text-white/70 mb-2">
                  {successState.switchMode === 'after_trial' ? 'تم حفظ اختيارك' : 'تم التفعيل'}
                </p>
                <DialogTitle className="text-3xl font-extrabold text-white mb-1 leading-tight">
                  {targetPlan.name_ar || targetPlan.name}
                </DialogTitle>
                <DialogDescription className="text-sm text-white/80">
                  {successState.switchMode === 'after_trial'
                    ? 'ستبدأ هذه الحزمة تلقائياً عند انتهاء التجربة.'
                    : 'كل الميزات الجديدة متاحة فوراً.'}
                </DialogDescription>
              </div>
            )}
          </div>
        </DialogHeader>

        {!successState ? (
          <div className="flex-1 overflow-y-auto px-6 md:px-7 py-5 bg-slate-50 space-y-4">
            {/* "ما تحصل عليه" — quick stat row anchoring the dialog
                with concrete value. Uses plan limits straight from
                targetPlan, so an admin editing a plan sees this update
                immediately. */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-slate-400 mb-3">
                ما تحصل عليه
              </p>
              <div className="grid grid-cols-4 gap-3">
                <PlanStat
                  icon={<Users className="h-4 w-4" weight="duotone" />}
                  value={targetPlan.users_limit == null ? '∞' : String(targetPlan.users_limit)}
                  label="مستخدم"
                />
                <PlanStat
                  icon={<Buildings className="h-4 w-4" weight="duotone" />}
                  value={targetPlan.branches_limit == null ? '∞' : String(targetPlan.branches_limit)}
                  label="فرع"
                />
                <PlanStat
                  icon={<ChatCircle className="h-4 w-4" weight="duotone" />}
                  value={targetPlan.sms_limit === 0 ? '—' : targetPlan.sms_limit.toLocaleString('en')}
                  label="SMS / شهر"
                />
                <PlanStat
                  icon={<Lightning className="h-4 w-4" weight="duotone" />}
                  value={targetPlan.ai_limit === 0 ? '—' : targetPlan.ai_limit.toLocaleString('en')}
                  label="AI / شهر"
                />
              </div>
            </div>

            {/* Plan transition line — only when we have a real current
                plan to show. Avoids the awkward "—" the screenshot
                surfaced when planInfo wasn't resolved yet. */}
            {(planInfo?.name_ar || planInfo?.name) && (
              <div className="flex items-center justify-center gap-2.5 text-xs text-slate-500">
                <span>الحزمة الحالية:</span>
                <span className="font-semibold text-slate-700">
                  {planInfo.name_ar || planInfo.name}
                </span>
                <ArrowLeft className="h-3 w-3 text-primary" weight="bold" />
                <span className="font-bold text-primary">
                  {targetPlan.name_ar || targetPlan.name}
                </span>
              </div>
            )}

            {/* Billing summary — primary-tinted card, the actual money
                question. */}
            {billing && (
              <div className="rounded-xl bg-primary/5 ring-1 ring-primary/15 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <CalendarBlank className="h-4 w-4" weight="fill" />
                  </div>
                  <p className="text-sm font-bold text-slate-900">متى وكم ستدفع</p>
                </div>
                <div className="pr-9">
                  <BillingExplanation billing={billing} />
                </div>
              </div>
            )}

            {/* Privacy policy — proper card with checkbox and clear
                acknowledgement. */}
            <label className="flex items-start gap-3 rounded-xl bg-white ring-1 ring-slate-200 p-3.5 cursor-pointer transition-all hover:ring-primary/30 hover:bg-primary/[0.02]">
              <Checkbox
                checked={privacyAccepted}
                onCheckedChange={(v) => setPrivacyAccepted(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs text-slate-600 leading-relaxed">
                أوافق على{' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary hover:underline"
                >
                  شروط الاستخدام
                </a>{' '}
                و
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary hover:underline mx-1"
                >
                  سياسة الخصوصية
                </a>
                وعلى شروط الفوترة المعروضة أعلاه.
              </span>
            </label>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-7 bg-slate-50 text-center">
            <p className="text-sm text-slate-700 font-medium">
              {successState.switchMode === 'after_trial'
                ? 'تم تأكيد اختيارك. سنبدأ الفوترة تلقائياً عند انتهاء التجربة المجانية.'
                : 'تم تفعيل الحزمة الجديدة وكل ميزاتها متاحة الآن.'}
            </p>
            {successState.emailSent && (
              <p className="mt-3 text-xs text-slate-500">
                أُرسلت نسخة من تفاصيل التغيير إلى فريق دعم ثقة.
              </p>
            )}
          </div>
        )}

        <div className="px-6 md:px-8 py-4 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
          {!successState ? (
            <>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                className="text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              >
                إلغاء
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!privacyAccepted || submitting}
                size="lg"
                className="gap-2 px-6 font-bold shadow-md hover:shadow-lg transition-shadow"
              >
                <TrendUp className="h-4 w-4" weight="bold" />
                {submitting ? 'جارٍ التأكيد...' : 'تأكيد التغيير'}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => onOpenChange(false)}
              size="lg"
              className="gap-2 mr-auto px-6 font-bold"
            >
              <CheckCircle className="h-4 w-4" weight="fill" />
              تم
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanStat({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 text-primary mb-1.5">
        {icon}
      </div>
      <div className="text-base font-extrabold text-slate-900 tabular-nums leading-tight">
        {value}
      </div>
      <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{label}</div>
    </div>
  );
}

function BillingExplanation({ billing }: { billing: Billing }) {
  const date = formatArabicDate(billing.startDate);
  const amountStr = (n: number) => `₪${Math.abs(n).toLocaleString('en')}`;
  const cycleLabel = billing.cycle === 'yearly' ? 'سنة' : 'شهر';

  if (billing.kind === 'trial') {
    return (
      <div className="space-y-1.5">
        <p className="text-sm text-slate-800">
          ستبدأ الفوترة تلقائياً في{' '}
          <span className="font-bold text-primary">{date}</span> بسعر{' '}
          <span className="font-bold tabular-nums">{amountStr(billing.cyclePrice)}</span> / {cycleLabel}.
        </p>
        <p className="text-xs text-muted-foreground">
          لن يتم خصم أي مبلغ منك حتى ذلك التاريخ.
        </p>
      </div>
    );
  }

  if (billing.kind === 'same_price') {
    return (
      <p className="text-sm text-slate-800">
        سيتم تفعيل الحزمة فوراً. لن يتغيّر المبلغ — ستستمر بدفع{' '}
        <span className="font-bold tabular-nums">{amountStr(billing.cyclePrice)}</span> / {cycleLabel}
        {' '}في فاتورتك القادمة بتاريخ{' '}
        <span className="font-bold">{date}</span>.
      </p>
    );
  }

  const isUpgrade = billing.kind === 'upgrade';
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-slate-800">
        سيتم تفعيل الحزمة فوراً.{' '}
        {isUpgrade ? (
          <>
            سيُضاف{' '}
            <span className="font-bold tabular-nums text-primary">
              {amountStr(billing.proratedAmount)}
            </span>{' '}
            {billing.cycle === 'yearly' ? (
              <>(مقدّم الدفع السنوي)</>
            ) : (
              <>(فرق {billing.daysRemaining} يوم متبقي)</>
            )}{' '}
            إلى فاتورتك القادمة في{' '}
            <span className="font-bold">{date}</span>.
          </>
        ) : (
          <>
            سيتم خصم{' '}
            <span className="font-bold tabular-nums text-emerald-600">
              {amountStr(billing.proratedAmount)}
            </span>{' '}
            (رصيد {billing.daysRemaining} يوم) من فاتورتك القادمة في{' '}
            <span className="font-bold">{date}</span>.
          </>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        بعدها ستدفع{' '}
        <span className="font-semibold tabular-nums">{amountStr(billing.cyclePrice)}</span> / {cycleLabel}.
      </p>
    </div>
  );
}
