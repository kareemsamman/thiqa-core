import { ReactNode } from "react";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useSidebarState } from "@/hooks/useSidebarState";

interface MainLayoutProps {
  children: ReactNode;
}

// Per-page <main> wrapper. The persistent navigation chrome (sidebar,
// bottom toolbar, popups, impersonation banner, shortcut listener)
// lives in <AppChrome /> at the App level so it survives lazy route
// transitions — earlier the entire MainLayout (sidebar included)
// unmounted on every navigation, which made the right-side nav
// flicker. This component now only handles the content area's margin
// against the sidebar and the impersonation banner offset.
export function MainLayout({ children }: MainLayoutProps) {
  const { isThiqaSuperAdmin, isImpersonating } = useAgentContext();
  const { collapsed } = useSidebarState();

  // Desktop sidebar: 64px collapsed (w-16) + 8px gap, 222px expanded
  // (w-[222px]) + 8px gap. Margins below match `right-2` + width + a
  // small content gap so page content sits flush against the sidebar.
  const sidebarMargin = collapsed ? 'md:mr-[4.5rem]' : 'md:mr-[15rem]';

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <main className={`min-h-screen transition-all duration-300 p-3 pt-[3.75rem] md:pt-6 md:p-6 ${sidebarMargin} ${isThiqaSuperAdmin ? 'pb-6' : 'pb-40 md:pb-6'} ${isImpersonating ? 'mt-10' : ''}`}>
        <div className="max-w-full">{children}</div>
      </main>
    </div>
  );
}