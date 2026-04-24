import { useCallback } from 'react';
import { useAgentContext } from './useAgentContext';
import { useAgentLimits } from './useAgentLimits';
import { useUpgradePrompt } from '@/components/pricing/UpgradePromptProvider';
import { toast } from 'sonner';

// Central gate for "send SMS" buttons across the agent app. Returns:
//   * locked  → true only once the feature/quota check has resolved AND
//               the agent is definitively blocked (feature off or monthly
//               quota exhausted). Drives the lock badge / amber styling.
//               Deliberately false during hydration so we don't flash a
//               false "plan exceeded" on agents who aren't actually over.
//   * loading → still resolving plan + limits. Bind to <Button disabled>
//               so the flash window can't be clicked through. Clicks that
//               somehow fire are also stopped inside guardSend.
//   * openUpgradeDialog → opens the right upgrade dialog variant:
//                           feature off → feature-lock dialog
//                           quota gone  → quota-lock dialog
//   * guardSend → call at the top of every send handler; returns false if
//                 the send should be blocked (silently during hydration,
//                 with a dialog/toast when truly locked).
// Thiqa super admins always pass (locked=false, loading=false).
export function useSmsLock() {
  const { hasFeature, isThiqaSuperAdmin, loading: contextLoading } =
    useAgentContext();
  const { sms, loading: limitsLoading } = useAgentLimits();
  const { showUpgradePrompt } = useUpgradePrompt();

  const stillLoading = contextLoading || limitsLoading;
  const featureOff = !hasFeature('sms');
  const quotaGone = sms.exceeded;
  const locked =
    !isThiqaSuperAdmin && !stillLoading && (featureOff || quotaGone);
  const loading = !isThiqaSuperAdmin && stillLoading;

  const openUpgradeDialog = useCallback(() => {
    if (featureOff) {
      showUpgradePrompt({ featureKey: 'sms', featureLabel: 'إرسال SMS' });
      return;
    }
    showUpgradePrompt({
      resource: 'sms',
      current: sms.used,
      limit: sms.effective ?? 0,
    });
  }, [featureOff, sms.used, sms.effective, showUpgradePrompt]);

  // Use at any SMS send call site to short-circuit when the plan is
  // out of quota. Returns true → proceed with the send; false → bail.
  // Default behavior on a blocked send is:
  //   * visible click (mode='click')    → open upgrade dialog
  //   * auto-fire flow (mode='auto')    → toast a brief note and skip
  //   * fully silent (mode='silent')    → no UI at all
  // Hydration window drops the click silently in every mode — the
  // disabled prop should already block it, this is defense in depth.
  const guardSend = useCallback(
    (mode: 'click' | 'auto' | 'silent' = 'click'): boolean => {
      if (isThiqaSuperAdmin) return true;
      if (stillLoading) return false;
      if (!locked) return true;
      if (mode === 'click') {
        openUpgradeDialog();
      } else if (mode === 'auto') {
        toast.info(
          featureOff
            ? 'لم يتم إرسال الرسالة — إرسال SMS غير متاح في باقتك الحالية.'
            : 'لم يتم إرسال الرسالة — الحد الشهري للـ SMS مستنفد.',
        );
      }
      return false;
    },
    [isThiqaSuperAdmin, stillLoading, locked, featureOff, openUpgradeDialog],
  );

  return { locked, loading, openUpgradeDialog, guardSend };
}
