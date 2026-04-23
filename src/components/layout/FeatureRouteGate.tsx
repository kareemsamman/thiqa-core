import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { navigationGroups } from "./Sidebar";

/**
 * Route-level plan gate. The sidebar already renders locked items as
 * buttons that open the upgrade dialog on click, but direct URL access
 * (deep links, bookmarks, manual typing) bypasses the sidebar entirely.
 * This component watches `location.pathname` and, if the path matches
 * a sidebar item tied to a featureKey the agent's plan doesn't
 * include, opens the upgrade dialog + redirects to `/` so the
 * restricted page never renders.
 *
 * Single source of truth is Sidebar.navigationGroups — adding a new
 * plan-gated page there auto-gates the route without touching this
 * file.
 */
export function FeatureRouteGate() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasFeature, isThiqaSuperAdmin, loading } = useAgentContext();
  const { showUpgradePrompt } = useUpgradePrompt();

  useEffect(() => {
    if (loading) return;
    // Super admins always pass — they need access to every route to
    // manage agents.
    if (isThiqaSuperAdmin) return;

    // Find a sidebar item whose href matches the current path. Prefix
    // match covers nested URLs like /clients/:id, /admin/claims/123.
    const match = navigationGroups
      .flatMap((g) => g.items)
      .find(
        (item) =>
          location.pathname === item.href ||
          location.pathname.startsWith(`${item.href}/`),
      );
    if (!match?.featureKey) return;
    if (hasFeature(match.featureKey)) return;

    // Feature is off on this plan → show the marketing dialog and get
    // out of the locked page so its own queries don't fire.
    showUpgradePrompt({
      featureKey: match.featureKey,
      featureLabel: match.name,
    });
    navigate("/", { replace: true });
  }, [
    location.pathname,
    loading,
    isThiqaSuperAdmin,
    hasFeature,
    showUpgradePrompt,
    navigate,
  ]);

  return null;
}
