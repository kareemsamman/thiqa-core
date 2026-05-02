import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FlaskConical, Loader2, RotateCcw, Clock, CircleSlash, PauseCircle, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

/**
 * Subscription-state simulator for the Thiqa super-admin panel.
 *
 * The agent app's subscription gate (ProtectedRoute) keys off
 * `agents.subscription_status`, `subscription_expires_at`, and
 * `trial_ends_at`. To QA the locked / expired / paused UX without
 * waiting for real expiry, this card lets a Thiqa super admin flip
 * those columns directly. Every action is reversible via the
 * "Restore to active" button — it picks a sensible default based on
 * whether the agent is on the trial plan or a paid one.
 *
 * No new schema is introduced — this writes to the same fields the
 * normal subscription flow already uses, so the agent's React shell
 * picks up the change instantly via the existing realtime UPDATE
 * listener in useAgentContext.
 */

type AgentSubscriptionFields = {
  id: string;
  plan: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  trial_ends_at: string | null;
  cancelled_at: string | null;
  monthly_price: number | null;
  pending_plan: string | null;
};

interface SubscriptionStateTesterProps {
  agent: AgentSubscriptionFields;
  /** Called with the patched fields after a successful DB update so
   *  the parent's local copy stays in sync without a refetch. */
  onUpdated: (patch: Partial<AgentSubscriptionFields>) => void;
  /** Arabic display name for the agent's current plan_key (resolved
   *  from subscription_plans). When omitted, falls back to the raw
   *  key — fine for the legacy entry/basic/professional/ultimate
   *  set, but custom plans would render their English plan_key. */
  planDisplayName?: string | null;
}

type TestAction =
  | 'end_trial'
  | 'mark_expired'
  | 'pause'
  | 'cancel'
  | 'restore';

interface ActionConfig {
  key: TestAction;
  label: string;
  description: string;
  icon: typeof Clock;
  variant: 'outline' | 'destructive' | 'default';
  /** Returns true when this action makes sense for the agent's
   *  current state. Used to disable irrelevant buttons. */
  isApplicable: (a: AgentSubscriptionFields) => boolean;
  /** Builds the patch this action will apply. */
  patch: (a: AgentSubscriptionFields) => Partial<AgentSubscriptionFields>;
  confirmTitle: string;
  confirmBody: string;
  successToast: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isoMinusMinutes(mins: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - mins);
  return d.toISOString();
}

function isoPlusMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const ACTIONS: ActionConfig[] = [
  {
    key: 'end_trial',
    label: 'إنهاء الفترة التجريبية الآن',
    description:
      'يضع تاريخ انتهاء التجربة في الماضي. الوكيل سيُحوّل فوراً إلى صفحة "اشتراكك انتهى" عند أي محاولة دخول.',
    icon: Clock,
    variant: 'outline',
    isApplicable: (a) => a.subscription_status === 'trial',
    patch: () => ({ trial_ends_at: isoMinusMinutes(5) }),
    confirmTitle: 'إنهاء الفترة التجريبية',
    confirmBody:
      'سيتم اعتبار التجربة منتهية فوراً. الوكيل سيرى صفحة "اشتراكك انتهى" حتى تستعيد الحالة باستخدام "إعادة إلى وضع فعّال".',
    successToast: 'تم إنهاء الفترة التجريبية',
  },
  {
    key: 'mark_expired',
    label: 'تحديد كمنتهٍ (لم يدفع)',
    description:
      'يضع حالة الاشتراك = منتهي وتاريخ الانتهاء في الماضي. الوكيل لن يستطيع الوصول لأي صفحة محمية حتى تستعيد الحالة.',
    icon: CircleSlash,
    variant: 'destructive',
    isApplicable: (a) =>
      a.subscription_status !== 'expired' && a.subscription_status !== 'trial',
    patch: () => ({
      subscription_status: 'expired',
      subscription_expires_at: isoMinusMinutes(5),
    }),
    confirmTitle: 'تحديد الاشتراك كمنتهٍ',
    confirmBody:
      'سيتم وضع الاشتراك في حالة "منتهي" وتاريخ الانتهاء في الماضي. الوكيل سيُحوّل لصفحة الاشتراك عند الدخول.',
    successToast: 'تم تحديد الاشتراك كمنتهٍ',
  },
  {
    key: 'pause',
    label: 'تعليق الاشتراك',
    description:
      'يضع الحالة = متوقف مؤقتاً. الوكيل سيرى صفحة الاشتراك مع رسالة "اشتراكك متوقف، تواصل مع الدعم".',
    icon: PauseCircle,
    variant: 'outline',
    isApplicable: (a) =>
      a.subscription_status !== 'paused' && a.subscription_status !== 'suspended',
    patch: () => ({ subscription_status: 'paused' }),
    confirmTitle: 'تعليق الاشتراك',
    confirmBody:
      'سيتم تعليق اشتراك الوكيل مؤقتاً. لن يستطيع الدخول لأي صفحة محمية حتى تستعيد الحالة.',
    successToast: 'تم تعليق الاشتراك',
  },
  {
    key: 'cancel',
    label: 'إلغاء الاشتراك',
    description:
      'يضع الحالة = ملغي ويسجّل تاريخ الإلغاء. صفحة الاشتراك ستظهر للوكيل خيارات اختيار باقة جديدة.',
    icon: XCircle,
    variant: 'destructive',
    isApplicable: (a) => a.subscription_status !== 'cancelled',
    patch: () => ({
      subscription_status: 'cancelled',
      cancelled_at: nowIso(),
    }),
    confirmTitle: 'إلغاء الاشتراك',
    confirmBody:
      'سيتم وضع الاشتراك في حالة "ملغي". هذا للاختبار فقط — استخدم "إعادة إلى وضع فعّال" لاسترجاع الحالة.',
    successToast: 'تم إلغاء الاشتراك',
  },
  {
    key: 'restore',
    label: 'إعادة إلى وضع فعّال',
    description:
      'يستعيد حالة عمل طبيعية. للوكلاء على الباقة التجريبية: تجربة جديدة مدتها 35 يوماً. لباقي الباقات: اشتراك فعّال لشهر إضافي.',
    icon: RotateCcw,
    variant: 'default',
    isApplicable: () => true,
    patch: (a) => {
      // Restore = clean slate. Also clear pending_plan, otherwise an
      // agent that was paused mid-trial with a pending paid plan
      // would come back from "restore" still carrying the pending
      // upgrade — which then fires on next trial expiry instead of
      // the admin's expectation of "back to normal".
      if (a.plan === 'free_trial') {
        return {
          subscription_status: 'trial',
          trial_ends_at: isoPlusDays(35),
          subscription_expires_at: null,
          cancelled_at: null,
          pending_plan: null,
        };
      }
      return {
        subscription_status: 'active',
        subscription_expires_at: isoPlusMonths(1),
        trial_ends_at: null,
        cancelled_at: null,
        pending_plan: null,
      };
    },
    confirmTitle: 'إعادة الوكيل إلى وضع فعّال',
    confirmBody:
      'سيتم استعادة حالة عمل طبيعية للوكيل. أي تواريخ تجربة / انتهاء سابقة سيتم استبدالها بقيم افتراضية.',
    successToast: 'تم استعادة وضع الاشتراك',
  },
];

function formatDateLabel(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'yyyy-MM-dd HH:mm');
  } catch {
    return iso;
  }
}

const STATUS_LABEL: Record<string, string> = {
  trial: 'تجربة مجانية',
  active: 'فعال',
  paused: 'متوقف مؤقتاً',
  suspended: 'معلّق',
  expired: 'منتهٍ',
  cancelled: 'ملغي',
};

export function SubscriptionStateTester({ agent, onUpdated, planDisplayName }: SubscriptionStateTesterProps) {
  const [pendingAction, setPendingAction] = useState<ActionConfig | null>(null);
  const [running, setRunning] = useState(false);

  const runAction = async () => {
    if (!pendingAction) return;
    setRunning(true);
    try {
      const patch = pendingAction.patch(agent);
      const { error } = await supabase
        .from('agents')
        .update(patch)
        .eq('id', agent.id);
      if (error) throw error;
      onUpdated(patch);
      toast.success(pendingAction.successToast);
      setPendingAction(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل تطبيق الحالة';
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-amber-600" />
          محاكاة حالات الاشتراك (للاختبار)
        </CardTitle>
        <CardDescription>
          اختبار سلوك التطبيق في حالات الاشتراك المختلفة (انتهاء التجربة، عدم الدفع، إلخ). يكتب مباشرة على أعمدة الاشتراك في الوكيل
          ويظهر التأثير فوراً عبر التحديث المباشر. للقابلية المستخدم Thiqa Super Admin فقط.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current state summary */}
        <div className="rounded-lg border bg-background/60 px-4 py-3 text-sm grid grid-cols-1 md:grid-cols-2 gap-y-1.5 gap-x-6">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">الحالة الحالية</span>
            <span className="font-semibold">
              {STATUS_LABEL[agent.subscription_status] || agent.subscription_status}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">الباقة</span>
            <span className="font-semibold">{planDisplayName || agent.plan}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">انتهاء التجربة</span>
            <span className="ltr-nums">{formatDateLabel(agent.trial_ends_at)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">انتهاء الاشتراك</span>
            <span className="ltr-nums">{formatDateLabel(agent.subscription_expires_at)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">تاريخ الإلغاء</span>
            <span className="ltr-nums">{formatDateLabel(agent.cancelled_at)}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ACTIONS.map((action) => {
            const Icon = action.icon;
            const applicable = action.isApplicable(agent);
            return (
              <div
                key={action.key}
                className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3"
              >
                <Button
                  type="button"
                  variant={action.variant}
                  size="sm"
                  className="justify-start gap-2"
                  disabled={!applicable || running}
                  onClick={() => setPendingAction(action)}
                >
                  <Icon className="h-4 w-4" />
                  {action.label}
                </Button>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {action.description}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>

      <AlertDialog
        open={!!pendingAction}
        onOpenChange={(open) => { if (!open && !running) setPendingAction(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction?.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{pendingAction?.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); runAction(); }}
              disabled={running}
              className={pendingAction?.variant === 'destructive' ? 'bg-destructive hover:bg-destructive/90' : undefined}
            >
              {running && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              تطبيق
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
