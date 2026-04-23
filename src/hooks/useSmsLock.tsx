import { useCallback } from 'react';
import { useAgentContext } from './useAgentContext';
import { useAgentLimits } from './useAgentLimits';
import { useUpgradePrompt } from '@/components/pricing/UpgradePromptProvider';

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

  return { locked, openUpgradeDialog };
}
