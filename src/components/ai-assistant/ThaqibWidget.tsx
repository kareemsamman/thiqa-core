import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAgentContext } from "@/hooks/useAgentContext";
import { ThaqibButton } from "./ThaqibButton";
import { ThaqibPanel } from "./ThaqibPanel";

// Public / pre-auth routes where the floating Thaqib button must never
// appear. Keeping the list here (instead of wrapping every public Route
// in App.tsx) means new public pages automatically inherit the hide
// behavior as long as their path starts with one of these prefixes.
const PUBLIC_ROUTE_PREFIXES = [
  "/login",
  "/signup",
  "/landing",
  "/pricing",
  "/verify-email",
  "/reset-password",
  "/forgot-password",
  "/no-access",
  "/subscription-expired",
];

export function ThaqibWidget() {
  const { hasFeature, isThiqaSuperAdmin } = useAgentContext();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const isPublicRoute = PUBLIC_ROUTE_PREFIXES.some((prefix) =>
    location.pathname === prefix || location.pathname.startsWith(`${prefix}/`)
  );

  if (isPublicRoute) return null;
  if (isThiqaSuperAdmin || !hasFeature("ai_assistant")) return null;

  return (
    <>
      <ThaqibButton onClick={() => setOpen(true)} visible={!open} />
      <ThaqibPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
