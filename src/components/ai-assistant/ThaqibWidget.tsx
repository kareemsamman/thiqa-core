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
  "/terms",
  "/privacy",
  "/verify-email",
  "/reset-password",
  "/forgot-password",
  "/no-access",
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
  if (isThiqaSuperAdmin || !hasFeature("ai_assistant")) return null;

  // AI quota is exhausted → clicking the FAB surfaces the upgrade
  // dialog instead of opening the chat. ThaqibButton itself flips to
  // the locked visual via the `locked` prop.
  const handleClick = () => {
    if (aiLimit.exceeded) {
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
      <ThaqibButton onClick={handleClick} visible={!open} locked={aiLimit.exceeded} />
      <ThaqibPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
