import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentContext } from './useAgentContext';

/**
 * Redirects to `/` when the agent's current plan does not include the
 * given feature. Used by pages that aren't surfaced in the sidebar
 * (e.g. /reports/financial, /reports/company-settlement) so they
 * enforce the plan gate even when a user navigates directly via URL.
 *
 * Skips the check while agent context is still loading so we don't
 * bounce the user mid-hydration.
 */
export function useFeatureGuard(featureKey: string) {
  const { hasFeature, loading } = useAgentContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!hasFeature(featureKey)) {
      navigate('/', { replace: true });
    }
  }, [featureKey, hasFeature, loading, navigate]);
}
