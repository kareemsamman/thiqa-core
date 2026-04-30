import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useAgentLimits } from "@/hooks/useAgentLimits";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { ThaqibButton } from "./ThaqibButton";
import { ThaqibPanel } from "./ThaqibPanel";

// Public / pre-auth routes where the floating Thaqib button must never
// appear. Keeping the list here (instead of wrapping every public Route
// in App.tsx) means new public pages automatically inherit the hide
// behavior as long as their path starts with one of these prefixes.
// "/" is handled separately below because every path starts with it.
const PUBLIC_ROUTE_PREFIXES = [
  "/login",
  "/register",
  "/signup",
  "/landing",
  "/pricing",
  "/faq",
  "/contact",
  "/terms",
  "/privacy",
  "/verify-email",
  "/reset-password",
  "/forgot-password",
  "/no-access",
  "/oauth-confirm",
  "/subscription-expired",
];

export function ThaqibWidget() {
  const { hasFeature, isThiqaSuperAdmin } = useAgentContext();
  const { ai: aiLimit } = useAgentLimits();
  const { showUpgradePrompt } = useUpgradePrompt();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // Exact "/" is the landing for logged-out visitors. Logged-in users
  // get redirected to /dashboard by HomeRoute, so hiding the widget
  // on "/" only ever affects the public landing.
  const isLanding = location.pathname === "/";
  const isPublicRoute = isLanding || PUBLIC_ROUTE_PREFIXES.some((prefix) =>
    location.pathname === prefix || location.pathname.startsWith(`${prefix}/`)
  );

  if (isPublicRoute) return null;
  if (isThiqaSuperAdmin) return null;

  // Two "locked" states — both render the FAB in amber with a lock
  // badge, so the agent sees the surface even before they upgrade:
  //   * plan doesn't include the ai_assistant feature → feature-lock
  //     variant of the upgrade dialog (shows plans that unlock it).
  //   * plan includes it but this month's quota is gone → quota variant
  //     of the dialog (shows current/limit numbers).
  // Either way, clicking the FAB opens the upgrade dialog instead of
  // the chat panel.
  const hasAiFeature = hasFeature("ai_assistant");
  const quotaGone = hasAiFeature && aiLimit.exceeded;
  const locked = !hasAiFeature || quotaGone;

  const handleClick = () => {
    if (!hasAiFeature) {
      showUpgradePrompt({
        featureKey: "ai_assistant",
        featureLabel: "المساعد الذكي (ثاقب)",
      });
      return;
    }
    if (quotaGone) {
      showUpgradePrompt({
        resource: "ai",
        current: aiLimit.used,
        limit: aiLimit.effective ?? 0,
      });
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <ThaqibButton onClick={handleClick} visible={!open} locked={locked} />
      {hasAiFeature && <ThaqibPanel open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
