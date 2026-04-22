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
  CheckCircle,
  Crown,
  ShieldCheck,
  Sparkle,
  TrendUp,
  X,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PLAN_FEATURE_CATALOG } from '@/lib/planFeatureCatalog';

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

/**
 * Two-phase dialog:
 *   (1) Confirmation — side-by-side "from → to" comparison with prices,
 *       quotas, gained/lost features, billing-start explanation, and a
 *       privacy-policy checkbox.
 *   (2) Success — a clean celebratory panel once the server confirms, so
 *       the user sees "تمت الترقية" before the page refetches its state.
 * Calls the `change-agent-plan` edge function which logs the event to
 * plan_change_events and emails support@getthiqa.com.
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

  // Reset when the dialog closes so a re-open starts clean.
  useEffect(() => {
    if (!open) {
      setPrivacyAccepted(false);
      setSubmitting(false);
      setSuccessState(null);
    }
  }, [open]);

  if (!targetPlan) return null;

  const isTrial =
    agent?.subscription_status === 'trial' ||
    (agent?.monthly_price === 0 && agent?.subscription_status === 'active');
  const currentPrice = Number(agent?.monthly_price ?? 0);
  const newPrice = Number(targetPlan.monthly_price);
  const priceDelta = newPrice - currentPrice;
  const isDowngrade = !isTrial && priceDelta < 0;
  const isUpgrade = !isTrial && priceDelta > 0;

  const billingExplanation = isTrial
    ? `ستبدأ الفوترة تلقائياً بعد انتهاء الفترة التجريبية. حتى ذلك الحين تستمر بالاستخدام المجاني بدون أي خصم.`
    : isDowngrade
    ? `سيتم تطبيق الحزمة الجديدة فوراً. الفرق في السعر (₪${Math.abs(priceDelta).toLocaleString('en')}) سيُحسب في فاتورتك القادمة.`
    : isUpgrade
    ? `سيتم تفعيل الحزمة الجديدة فوراً. الفرق في السعر (₪${priceDelta.toLocaleString('en')}) سيُحتسب بشكل نسبي على فاتورتك القادمة.`
    : `سيتم تفعيل الحزمة الجديدة فوراً.`;

  // Compute the feature diff for a "you'll gain / you'll lose" summary.
  const allFeatureItems = PLAN_FEATURE_CATALOG.flatMap((g) => g.items);
  const gained = allFeatureItems.filter(
    (f) =>
      targetPlan.default_features?.[f.key] === true &&
      planInfo?.default_features?.[f.key] !== true,
  );
  const lost = allFeatureItems.filter(
    (f) =>
      targetPlan.default_features?.[f.key] !== true &&
      planInfo?.default_features?.[f.key] === true,
  );

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
      // Give the user a beat to see the success state before the parent
      // refreshes (planInfo comes in via the realtime channel we already
      // wired up in useAgentContext).
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
        className="w-[92vw] max-w-[720px] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 border-0 shadow-2xl"
        dir="rtl"
      >
        <DialogClose className="absolute top-4 left-4 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white ring-1 ring-white/30 backdrop-blur-sm transition-all hover:bg-white/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white">
          <X className="h-4 w-4" weight="bold" />
          <span className="sr-only">إغلاق</span>
        </DialogClose>

        {/* Hero — same gradient language as the upgrade popup so the
            two feel like one continuous flow. */}
        <DialogHeader className="relative px-8 pt-8 pb-6 overflow-hidden border-b">
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
                'radial-gradient(900px 400px at 12% 0%, rgba(255,255,255,0.25), transparent 55%), radial-gradient(700px 400px at 95% 100%, rgba(255,255,255,0.18), transparent 60%)',
            }}
          />
          <div className="relative pl-12">
            {!successState ? (
              <>
                <DialogTitle className="text-2xl font-bold text-white mb-1 drop-shadow-sm">
                  تأكيد تغيير الحزمة
                </DialogTitle>
                <DialogDescription className="text-sm text-white/90 drop-shadow-sm">
                  راجع التفاصيل أدناه قبل تأكيد التحويل إلى{' '}
                  <span className="font-bold">{targetPlan.name_ar || targetPlan.name}</span>.
                </DialogDescription>
              </>
            ) : (
              <>
                <DialogTitle className="text-2xl font-bold text-white mb-1 drop-shadow-sm">
                  {successState.switchMode === 'after_trial'
                    ? 'تم حفظ اختيارك!'
                    : 'تم تفعيل الحزمة الجديدة!'}
                </DialogTitle>
                <DialogDescription className="text-sm text-white/90 drop-shadow-sm">
                  {successState.switchMode === 'after_trial'
                    ? `ستبدأ حزمة ${targetPlan.name_ar || targetPlan.name} تلقائياً بعد انتهاء فترتك التجريبية.`
                    : `أنت الآن على حزمة ${targetPlan.name_ar || targetPlan.name} — كل الميزات متاحة مباشرة.`}
                </DialogDescription>
              </>
            )}
          </div>
        </DialogHeader>

        {/* Body — either the confirmation form or the success panel. */}
        {!successState ? (
          <div className="flex-1 overflow-y-auto px-6 md:px-8 py-6 bg-slate-50/50 space-y-5">
            {/* From → To side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <PlanSnapshot
                label="حزمتك الحالية"
                name={planInfo?.name_ar || planInfo?.name || agent?.plan || '—'}
                price={currentPrice}
                tone="slate"
              />
              <div className="hidden sm:flex items-center justify-center">
                <span className="hidden sm:block absolute translate-x-[-50%] rounded-full bg-white shadow-md h-8 w-8 items-center justify-center text-primary">
                  <ArrowLeft className="h-4 w-4" weight="bold" />
                </span>
              </div>
              <PlanSnapshot
                label="الحزمة الجديدة"
                name={targetPlan.name_ar || targetPlan.name}
                price={newPrice}
                yearly={targetPlan.yearly_price}
                tone="primary"
              />
            </div>

            {/* Quotas summary on the new plan */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
              <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                <Crown className="h-4 w-4 text-primary" weight="fill" />
                ما ستحصل عليه في الحزمة الجديدة
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-sm">
                <QuotaChip label="مستخدم" value={fmt(targetPlan.users_limit)} />
                <QuotaChip label="فرع" value={fmt(targetPlan.branches_limit)} />
                <QuotaChip label="معاملة" value={fmt(targetPlan.policies_limit)} />
                <QuotaChip label="SMS / شهر" value={fmt(targetPlan.sms_limit)} />
                <QuotaChip label="SMS تسويقية / شهر" value={fmt(targetPlan.marketing_sms_limit)} />
                <QuotaChip label="طلب AI / شهر" value={fmt(targetPlan.ai_limit)} />
              </div>
            </div>

            {/* Feature diff */}
            {(gained.length > 0 || lost.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {gained.length > 0 && (
                  <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-4">
                    <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">
                      ستفتح لك ({gained.length})
                    </p>
                    <ul className="space-y-1.5 text-sm">
                      {gained.map((f) => (
                        <li key={f.key} className="flex items-center gap-2 text-emerald-900 font-medium">
                          <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" weight="fill" />
                          {f.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {lost.length > 0 && (
                  <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-4">
                    <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">
                      ستخسر ({lost.length})
                    </p>
                    <ul className="space-y-1.5 text-sm">
                      {lost.map((f) => (
                        <li key={f.key} className="flex items-center gap-2 text-amber-900">
                          <X className="h-4 w-4 text-amber-600 shrink-0" weight="bold" />
                          {f.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Billing explanation */}
            <div className="rounded-xl bg-primary/5 ring-1 ring-primary/15 p-4">
              <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" weight="fill" />
                متى تبدأ الفوترة؟
              </p>
              <p className="text-sm text-slate-700 leading-relaxed">{billingExplanation}</p>
            </div>

            {/* Privacy policy checkbox */}
            <label className="flex items-start gap-3 rounded-xl bg-white ring-1 ring-slate-200 p-4 cursor-pointer transition-colors hover:bg-slate-50">
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
                وعلى تغيير حزمتي وفقاً لشروط الفوترة أعلاه.
              </span>
            </label>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 md:px-8 py-10 bg-slate-50/50 flex flex-col items-center text-center">
            <div className="relative">
              <div
                className="h-24 w-24 rounded-full flex items-center justify-center shadow-[0_12px_32px_-12px_rgba(16,185,129,0.5)]"
                style={{
                  background:
                    'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
                }}
              >
                <CheckCircle className="h-12 w-12 text-white" weight="fill" />
              </div>
              <Sparkle
                className="absolute -top-1 -right-1 h-6 w-6 text-amber-400 animate-pulse"
                weight="fill"
              />
              <Sparkle
                className="absolute -bottom-1 -left-2 h-4 w-4 text-fuchsia-400 animate-pulse"
                weight="fill"
              />
            </div>
            <p className="mt-6 text-lg font-bold text-slate-900">
              {successState.switchMode === 'after_trial'
                ? `سيتم التحويل إلى ${targetPlan.name_ar || targetPlan.name} عند انتهاء التجربة`
                : `${targetPlan.name_ar || targetPlan.name} مُفعّلة الآن`}
            </p>
            <p className="mt-2 text-sm text-slate-600 max-w-md">
              {successState.switchMode === 'after_trial'
                ? 'استمر باستخدام النظام بشكل كامل حتى انتهاء فترتك التجريبية. لن نخصم منك أي رسوم حتى ذلك الحين.'
                : 'كل الميزات الجديدة أصبحت متاحة فوراً. يمكنك البدء باستخدامها الآن.'}
            </p>
            {successState.emailSent && (
              <p className="mt-4 text-xs text-slate-500">
                تم إرسال نسخة من التفاصيل إلى فريق دعم ثقة.
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 md:px-8 py-4 border-t bg-white flex items-center justify-between gap-3 flex-wrap">
          {!successState ? (
            <>
              <p className="text-xs text-muted-foreground">
                يمكنك إلغاء أو تغيير اختيارك في أي وقت من صفحة الاشتراك.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                >
                  إلغاء
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={!privacyAccepted || submitting}
                  className="gap-2"
                >
                  <TrendUp className="h-4 w-4" />
                  {submitting
                    ? 'جارٍ التأكيد...'
                    : isTrial
                    ? 'تأكيد الاختيار'
                    : 'تأكيد التحويل'}
                </Button>
              </div>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <Button onClick={() => onOpenChange(false)} className="gap-2">
                <CheckCircle className="h-4 w-4" weight="fill" />
                تم
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'غير محدود';
  if (n === 0) return '—';
  return n.toLocaleString('en');
}

function PlanSnapshot({
  label,
  name,
  price,
  yearly,
  tone,
}: {
  label: string;
  name: string;
  price: number;
  yearly?: number | null;
  tone: 'slate' | 'primary';
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-4 ring-1',
        tone === 'slate'
          ? 'bg-slate-50 ring-slate-200'
          : 'bg-primary/5 ring-primary/20',
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold mt-1 truncate">{name}</p>
      <div className="flex items-baseline gap-1 mt-1">
        <span className={cn(
          'text-2xl font-extrabold tabular-nums',
          tone === 'primary' ? 'text-primary' : 'text-slate-700',
        )}>
          ₪{price.toLocaleString('en')}
        </span>
        <span className="text-xs text-muted-foreground">/ شهر</span>
      </div>
      {yearly !== undefined && yearly !== null && (
        <p className="text-[11px] text-muted-foreground mt-0.5">
          أو ₪{yearly.toLocaleString('en')} سنوياً
        </p>
      )}
    </div>
  );
}

function QuotaChip({ label, value }: { label: string; value: string }) {
  const isEmpty = value === '—';
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5',
        isEmpty ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200',
      )}
    >
      <span className="text-slate-600 text-[12px]">{label}</span>
      <span className="font-bold tabular-nums text-slate-900">{value}</span>
    </div>
  );
}
