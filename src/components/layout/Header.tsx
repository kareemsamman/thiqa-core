import { useLayoutEffect, useMemo, useRef, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NotificationsDropdown } from "./NotificationsDropdown";
import { BottomToolbarInlineSearch } from "./BottomToolbarInlineSearch";
import { navigationGroups } from "./Sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { usePolicyWizardController } from "@/hooks/usePolicyWizardController";
import { useRecentClient } from "@/hooks/useRecentClient";

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
  };
}

const ICON_BUTTON_CLASS =
  "h-11 w-11 rounded-full bg-secondary/70 hover:bg-secondary transition-colors text-foreground";

// `action` is kept in the prop signature so existing callers don't break,
// but the header no longer renders it — per-page primary actions now live
// in the page body next to filters.
export function Header({ title, subtitle }: HeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAdmin, isSuperAdmin } = useAuth();
  const { hasFeature, isThiqaSuperAdmin } = useAgentContext();
  const { openWizard } = usePolicyWizardController();
  const { recentClient } = useRecentClient();
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  const isOnClientProfilePage = /^\/clients\/[^/]+/.test(location.pathname);

  // When the active tab changes, make sure it's visible in the 629px
  // lane. Skip entirely when the tab is already within the lane's
  // viewport — otherwise snap it into the center *instantly* (no
  // scroll-smooth), so navigating doesn't produce a visible
  // scroll-right-then-left jitter.
  useLayoutEffect(() => {
    const tab = activeTabRef.current;
    if (!tab) return;
    const lane = tab.closest("nav");
    if (!lane) return;

    const laneRect = lane.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const fullyVisible =
      tabRect.left >= laneRect.left && tabRect.right <= laneRect.right;
    if (fullyVisible) return;

    tab.scrollIntoView({
      behavior: "instant" as ScrollBehavior,
      block: "nearest",
      inline: "center",
    });
  }, [location.pathname]);

  const siblingTabs = useMemo(() => {
    const matchesPath = (href: string) =>
      location.pathname === href || location.pathname.startsWith(href + "/");

    const group = navigationGroups.find((g) => g.items.some((i) => matchesPath(i.href)));
    if (!group) return [];
    if (group.adminOnly && !isAdmin && !isThiqaSuperAdmin) return [];

    return group.items.filter((item) => {
      if (isThiqaSuperAdmin) return true;
      if (item.thiqaSuperAdminOnly && !isThiqaSuperAdmin) return false;
      if (item.superAdminOnly && !isSuperAdmin) return false;
      if (item.adminOnly && !isAdmin) return false;
      if (item.featureKey && !hasFeature(item.featureKey)) return false;
      return true;
    });
  }, [location.pathname, isAdmin, isSuperAdmin, isThiqaSuperAdmin, hasFeature]);

  const isTabActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(href + "/");

  const openNewPolicy = () => {
    openWizard({
      clientId: isOnClientProfilePage ? recentClient?.id : undefined,
    });
  };

  return (
    <>
      {/* Desktop header — tabs sit in an absolutely-centered nav so they
          stay pinned to the visual center no matter how long the title
          gets or how wide the search grows on focus. Title lives on the
          right, cluster on the left, both anchored to their respective
          ends by flex justify-between. */}
      <header className="hidden md:flex relative items-center justify-between sticky top-0 z-30 h-20 bg-background px-6 mb-6">
        {/* Right: title + subtitle */}
        <div className="min-w-0 flex-shrink overflow-hidden max-w-[28%]">
          <h1 className="text-xl font-semibold text-foreground truncate">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>

        {/* Center: sibling tabs, absolutely pinned so neither the
            growing cluster nor a longer title nudges them. Locked to a
            fixed 629px lane — when a group has more tabs than fit, the
            lane scrolls internally with a visible thin scrollbar. */}
        <nav className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[629px] overflow-x-auto overflow-y-hidden">
          {/* `w-max` sizes the row to exactly its natural content width
              so it CAN exceed the 629px lane and trigger the parent's
              scroll; `mx-auto` centers it when it's narrower. */}
          <div className="flex items-center gap-2 w-max mx-auto pb-1">
            {siblingTabs.map((tab) => {
              const active = isTabActive(tab.href);
              return (
                <button
                  key={tab.href}
                  ref={active ? activeTabRef : undefined}
                  type="button"
                  onClick={() => navigate(tab.href)}
                  className={cn(
                    "h-11 px-5 rounded-full text-[15px] font-medium whitespace-nowrap transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background flex-shrink-0",
                    active
                      ? "bg-foreground text-background shadow-md hover:bg-foreground/90"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                  )}
                >
                  {tab.name}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Left: cluster — search grows on focus via expandedInputClassName,
            and flex justify-between keeps the cluster anchored to the
            header's left edge while it expands. */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <BottomToolbarInlineSearch
            collapsible
            direction="down"
            dropdownMatchWidth
            // Include the sm: variant so tailwind-merge fully replaces
            // the component's default `sm:w-[200px]` — otherwise the
            // base width silently loses at md+ screens and the input
            // never actually grows.
            inputClassName="h-11 w-[280px] sm:w-[280px] bg-secondary/70 border-transparent"
            expandedInputClassName="w-[320px] sm:w-[320px]"
          />

          <Button
            onClick={openNewPolicy}
            className="h-11 px-4 rounded-full gap-2 shadow-md hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] text-[15px]"
          >
            <Plus className="h-4 w-4" />
            <span>وثيقة جديدة</span>
          </Button>

          <NotificationsDropdown
            className={cn(ICON_BUTTON_CLASS, "md:h-11 md:w-11")}
            iconClassName="md:h-[18px] md:w-[18px] text-foreground"
            badgeVariant="dot"
          />
        </div>
      </header>

      {/* Mobile header - title row + tabs strip */}
      <div className="md:hidden mb-4">
        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-foreground truncate">{title}</h1>
            {subtitle && (
              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              onClick={openNewPolicy}
              size="sm"
              className="h-9 px-3 rounded-full gap-2"
            >
              <Plus className="h-4 w-4 sm:hidden" />
              <FileText className="h-4 w-4 hidden sm:inline" />
              <span className="hidden sm:inline">وثيقة جديدة</span>
            </Button>
          </div>
        </div>

        {siblingTabs.length > 0 && (
          <nav className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-2 -mx-1 px-1">
            {siblingTabs.map((tab) => {
              const active = isTabActive(tab.href);
              return (
                <button
                  key={tab.href}
                  type="button"
                  onClick={() => navigate(tab.href)}
                  className={cn(
                    "h-9 px-4 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200 flex-shrink-0",
                    active
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                  )}
                >
                  {tab.name}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </>
  );
}
