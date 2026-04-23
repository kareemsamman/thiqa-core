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
import { Checkbox } from '@/components/ui/checkbox';
import {
  ArrowLeft,
  CalendarBlank,
  CheckCircle,
  Sparkle,
  TrendUp,
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

interface PlanChangeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetPlan: PlanTarget | null;
  /** Called after the server confirms the plan switch succeeded. */
  onSuccess?: () => void;
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
  /** Full monthly price of the new plan (what will be charged going forward). */
  monthlyPrice: number;
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
  } | null,
  newMonthlyPrice: number,
  today: Date = new Date(),
): Billing | null {
  if (!agent) return null;

  const isTrial =
    agent.subscription_status === 'trial' ||
    (Number(agent.monthly_price) === 0 && agent.subscription_status === 'active');

  const currentPrice = Number(agent.monthly_price ?? 0);

  if (isTrial) {
    const trialEnd = agent.trial_ends_at ? new Date(agent.trial_ends_at) : null;
    const start = trialEnd && trialEnd > today ? trialEnd : today;
    return {
      kind: 'trial',
      startDate: start,
      proratedAmount: 0,
      daysRemaining: Math.max(0, Math.floor((start.getTime() - today.getTime()) / 86400000)),
      monthlyPrice: newMonthlyPrice,
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
  const dailyDelta = (newMonthlyPrice - currentPrice) / 30;
  const proratedAmount = Math.round(dailyDelta * daysRemaining);

  let kind: Billing['kind'];
  if (newMonthlyPrice > currentPrice) kind = 'upgrade';
  else if (newMonthlyPrice < currentPrice) kind = 'downgrade';
  else kind = 'same_price';

  return {
    kind,
    startDate: nextBilling,
    proratedAmount,
    daysRemaining,
    monthlyPrice: newMonthlyPrice,
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
}: PlanChangeConfirmDialogProps) {
  const { agent, planInfo } = useAgentContext();
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successState, setSuccessState] = useState<null | {
    switchMode: 'immediate' | 'after_trial';
    emailSent: boolean;
  }>(null);

  useEffect(() => {
    if (!open) {
      setPrivacyAccepted(false);
      setSubmitting(false);
      setSuccessState(null);
    }
  }, [open]);

  if (!targetPlan) return null;

  const currentPrice = Number(agent?.monthly_price ?? 0);
  const newPrice = Number(targetPlan.monthly_price);
  const billing = computeBilling(agent, newPrice);

  const handleConfirm = async () => {
    if (!privacyAccepted || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('change-agent-plan', {
        body: {
          target_plan_key: targetPlan.plan_key,
          privacy_accepted: true,
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
        className="w-[92vw] max-w-[560px] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 border-0 shadow-2xl"
        dir="rtl"
      >
        <DialogClose className="absolute top-4 left-4 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white ring-1 ring-white/30 backdrop-blur-sm transition-all hover:bg-white/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white">
          <X className="h-4 w-4" weight="bold" />
          <span className="sr-only">إغلاق</span>
        </DialogClose>

        <DialogHeader className="relative px-6 md:px-8 pt-7 pb-5 overflow-hidden border-b">
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(120deg, #3b2fd8 0%, #6a3bd1 28%, #c93fa8 58%, #ed6a44 85%, #f5a548 100%)',
            }}
          />
          <div className="relative pl-12">
            {!successState ? (
              <>
                <DialogTitle className="text-xl md:text-2xl font-bold text-white mb-1 drop-shadow-sm">
                  تأكيد تغيير الحزمة
                </DialogTitle>
                <DialogDescription className="text-sm text-white/90 drop-shadow-sm">
                  التحويل إلى{' '}
                  <span className="font-bold">{targetPlan.name_ar || targetPlan.name}</span>
                </DialogDescription>
              </>
            ) : (
              <>
                <DialogTitle className="text-xl md:text-2xl font-bold text-white mb-1 drop-shadow-sm">
                  {successState.switchMode === 'after_trial'
                    ? 'تم حفظ اختيارك!'
                    : 'تم تفعيل الحزمة الجديدة!'}
                </DialogTitle>
                <DialogDescription className="text-sm text-white/90 drop-shadow-sm">
                  {successState.switchMode === 'after_trial'
                    ? `ستبدأ ${targetPlan.name_ar || targetPlan.name} بعد انتهاء التجربة.`
                    : `أنت الآن على ${targetPlan.name_ar || targetPlan.name}.`}
                </DialogDescription>
              </>
            )}
          </div>
        </DialogHeader>

        {!successState ? (
          <div className="flex-1 overflow-y-auto px-6 md:px-7 py-5 bg-slate-50/50 space-y-4">
            {/* Compact from → to summary */}
            <div className="flex items-center gap-2 justify-between rounded-xl bg-white ring-1 ring-slate-200 p-3">
              <div className="flex-1 min-w-0 text-right">
                <p className="text-[11px] text-muted-foreground">من</p>
                <p className="text-sm font-semibold truncate">
                  {planInfo?.name_ar || planInfo?.name || agent?.plan || '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  ₪{currentPrice.toLocaleString('en')} / شهر
                </p>
              </div>
              <ArrowLeft className="h-4 w-4 text-primary shrink-0" weight="bold" />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[11px] text-muted-foreground">إلى</p>
                <p className="text-sm font-semibold truncate text-primary">
                  {targetPlan.name_ar || targetPlan.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  ₪{newPrice.toLocaleString('en')} / شهر
                </p>
              </div>
            </div>

            {/* Billing summary — one focused box */}
            {billing && (
              <div className="rounded-xl bg-primary/5 ring-1 ring-primary/15 p-4">
                <p className="text-sm font-bold mb-2 flex items-center gap-1.5 text-primary">
                  <CalendarBlank className="h-4 w-4" weight="fill" />
                  متى وكم ستدفع؟
                </p>
                <BillingExplanation billing={billing} />
              </div>
            )}

            {/* Privacy policy checkbox */}
            <label className="flex items-start gap-3 rounded-xl bg-white ring-1 ring-slate-200 p-3.5 cursor-pointer transition-colors hover:bg-slate-50">
              <Checkbox
                checked={privacyAccepted}
                onCheckedChange={(v) => setPrivacyAccepted(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm text-slate-700 leading-relaxed">
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
                وعلى شروط الفوترة أعلاه.
              </span>
            </label>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-9 bg-slate-50/50 flex flex-col items-center text-center">
            <div className="relative">
              <div
                className="h-20 w-20 rounded-full flex items-center justify-center shadow-[0_12px_32px_-12px_rgba(16,185,129,0.5)]"
                style={{
                  background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
                }}
              >
                <CheckCircle className="h-10 w-10 text-white" weight="fill" />
              </div>
              <Sparkle
                className="absolute -top-1 -right-1 h-5 w-5 text-amber-400 animate-pulse"
                weight="fill"
              />
              <Sparkle
                className="absolute -bottom-1 -left-2 h-4 w-4 text-fuchsia-400 animate-pulse"
                weight="fill"
              />
            </div>
            <p className="mt-5 text-base font-bold text-slate-900">
              {successState.switchMode === 'after_trial'
                ? `سيتم التحويل تلقائياً عند انتهاء التجربة`
                : `كل الميزات الجديدة متاحة فوراً`}
            </p>
            {successState.emailSent && (
              <p className="mt-2 text-xs text-slate-500">
                تم إرسال نسخة من التفاصيل إلى فريق دعم ثقة.
              </p>
            )}
          </div>
        )}

        <div className="px-6 py-4 border-t bg-white flex items-center justify-end gap-2 flex-wrap">
          {!successState ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                إلغاء
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!privacyAccepted || submitting}
                className="gap-2"
              >
                <TrendUp className="h-4 w-4" />
                {submitting ? 'جارٍ التأكيد...' : 'تأكيد'}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)} className="gap-2">
              <CheckCircle className="h-4 w-4" weight="fill" />
              تم
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BillingExplanation({ billing }: { billing: Billing }) {
  const date = formatArabicDate(billing.startDate);
  const amountStr = (n: number) => `₪${Math.abs(n).toLocaleString('en')}`;

  if (billing.kind === 'trial') {
    return (
      <div className="space-y-1.5">
        <p className="text-sm text-slate-800">
          ستبدأ الفوترة تلقائياً في{' '}
          <span className="font-bold text-primary">{date}</span> بسعر{' '}
          <span className="font-bold tabular-nums">{amountStr(billing.monthlyPrice)}</span> / شهر.
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
        سيتم تفعيل الحزمة فوراً. لن يتغيّر المبلغ الشهري — ستستمر بدفع{' '}
        <span className="font-bold tabular-nums">{amountStr(billing.monthlyPrice)}</span> / شهر
        في فاتورتك القادمة بتاريخ{' '}
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
            (فرق {billing.daysRemaining} يوم متبقي) إلى فاتورتك القادمة في{' '}
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
        <span className="font-semibold tabular-nums">{amountStr(billing.monthlyPrice)}</span> / شهر.
      </p>
    </div>
  );
}
