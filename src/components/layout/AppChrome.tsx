import { useNavigate, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { BottomToolbar } from "./BottomToolbar";
import { AnnouncementPopup } from "./AnnouncementPopup";
import { TaskPopupReminder } from "@/components/tasks/TaskPopupReminder";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useAuth } from "@/hooks/useAuth";
import { useGlobalShortcutListener } from "@/hooks/useGlobalShortcutListener";
import { Button } from "@/components/ui/button";
import { ArrowRight, Building2 } from "lucide-react";

// Routes that are explicitly public (no sidebar / no chrome). Anything
// not in this list is treated as an authenticated surface and gets the
// chrome rendered. Using a startsWith check covers nested IDs like
// /clients/:clientId without listing every variation.
const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/register',
  '/landing',
  '/pricing',
  '/privacy',
  '/terms',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/no-access',
  '/subscription-expired',
  '/signature',
  '/payment-success',
  '/payment-fail',
];

function isPublicPath(pathname: string): boolean {
  // Root is the marketing landing page — always public, even for
  // logged-in visitors who navigated back to it.
  if (pathname === '/') return true;
  return PUBLIC_PATH_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Persistent app shell — sidebar, bottom toolbar, popups, the global
// shortcut listener and the impersonation banner. Mounts once at the
// App level so route changes (which unmount the page chunk inside
// Suspense) don't tear down the navigation chrome. MainLayout used to
// own these; now it only handles the per-page <main> padding so that
// the sidebar stays put across navigations.
export function AppChrome() {
  const { user } = useAuth();
  const location = useLocation();
  const { isThiqaSuperAdmin, isImpersonating, impersonatedAgent, stopImpersonation } = useAgentContext();
  const navigate = useNavigate();
  // Shortcut listener has to run regardless of the chrome being shown
  // (it's a window-level listener), so keep it before the public-path
  // bail. It still no-ops on logged-out sessions because there are no
  // bindings to react to.
  useGlobalShortcutListener();

  const handleExitImpersonation = () => {
    stopImpersonation();
    navigate('/thiqa');
  };

  if (!user) return null;
  if (isPublicPath(location.pathname)) return null;

  return (
    <>
      {isImpersonating && impersonatedAgent && (
        <div className="fixed top-0 inset-x-0 z-[60] hero-gradient text-white h-10 flex items-center justify-between px-4 shadow-md" dir="rtl">
          <div className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4" />
            <span>أنت تتصفح نظام الوكيل:</span>
            <span className="font-bold">{impersonatedAgent.name_ar || impersonatedAgent.name}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-white/30 text-white hover:bg-white/10 gap-1"
            onClick={handleExitImpersonation}
          >
            <ArrowRight className="h-3 w-3" />
            العودة للوحة ثقة
          </Button>
        </div>
      )}

      <Sidebar />

      {!isThiqaSuperAdmin && <BottomToolbar />}
      {!isThiqaSuperAdmin && <AnnouncementPopup />}
      {!isThiqaSuperAdmin && <TaskPopupReminder />}
      {!isThiqaSuperAdmin && <OnboardingWizard />}
    </>
  );
}
