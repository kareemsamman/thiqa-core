import { useCallback } from 'react';
import { useAgentContext } from './useAgentContext';
import { useAgentLimits } from './useAgentLimits';
import { useUpgradePrompt } from '@/components/pricing/UpgradePromptProvider';
import { toast } from 'sonner';

// Central gate for "send SMS" buttons across the agent app. Returns
// whether the button should render as locked + an onClick handler that
// opens the right upgrade dialog variant:
//   * feature off on this plan          → feature-lock dialog
//   * feature on but monthly quota gone → quota-lock dialog
// Thiqa super admins always pass. While plan data is loading we treat
// as locked so the button can't be clicked through during the flash
// window — same guard pattern used by LockedBranchSelect and the
// notifications bell.
export function useSmsLock() {
  const { hasFeature, isThiqaSuperAdmin, loading: contextLoading } =
    useAgentContext();
  const { sms, loading: limitsLoading } = useAgentLimits();
  const { showUpgradePrompt } = useUpgradePrompt();

  const stillLoading = contextLoading || limitsLoading;
  const featureOff = !hasFeature('sms');
  const quotaGone = sms.exceeded;
  const locked =
    !isThiqaSuperAdmin && (stillLoading || featureOff || quotaGone);

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
  // Super admin always passes.
  const guardSend = useCallback(
    (mode: 'click' | 'auto' | 'silent' = 'click'): boolean => {
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
    [locked, featureOff, openUpgradeDialog],
  );

  return { locked, openUpgradeDialog, guardSend };
}
