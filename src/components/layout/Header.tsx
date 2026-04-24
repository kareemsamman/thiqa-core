import { useCallback, useLayoutEffect, useMemo, useRef, useState, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, FileText, Keyboard, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NotificationsDropdown } from "./NotificationsDropdown";
import { BottomToolbarInlineSearch } from "./BottomToolbarInlineSearch";
import { HeaderDraftsButton } from "./HeaderDraftsButton";
import { ShortcutsCheatsheetDialog } from "./ShortcutsCheatsheetDialog";
import { navigationGroups } from "./Sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useAgentLimits } from "@/hooks/useAgentLimits";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { usePolicyWizardController } from "@/hooks/usePolicyWizardController";
import { useRecentClient } from "@/hooks/useRecentClient";
import { useShortcutAction } from "@/hooks/useShortcutAction";

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
  const { policies: policiesLimit, loading: limitsLoading } = useAgentLimits();
  const { showUpgradePrompt } = useUpgradePrompt();
  // Only commit to the locked variant once limits have actually loaded,
  // so we don't flash the amber lock on an agent who's perfectly within
  // quota. During the hydration window the unlocked variant renders with
  // `disabled=limitsLoading` + a handler guard — prevents the bypass
  // (can't click through the flash) without misleading the user about
  // their plan.
  const policiesLocked = !limitsLoading && policiesLimit.exceeded;
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

  const openNewPolicy = useCallback(() => {
    // Drop clicks during the hydration window — we don't know the quota
    // yet, and opening the wizard speculatively is the bypass the lock is
    // meant to prevent. The button also renders locked while `limitsLoading`
    // so in practice this only catches a fast double-click on the flash.
    if (limitsLoading) return;
    if (policiesLimit.exceeded) {
      showUpgradePrompt({
        resource: "policies",
        current: policiesLimit.used,
        limit: policiesLimit.effective ?? 0,
      });
      return;
    }
    openWizard({
      clientId: isOnClientProfilePage ? recentClient?.id : undefined,
    });
  }, [openWizard, isOnClientProfilePage, recentClient?.id, limitsLoading, policiesLimit, showUpgradePrompt]);

  // Expose the header's "new policy" button to the global shortcut bus.
  // The listener in MainLayout routes the bound combo here; subscribing
  // inside Header means the shortcut only works while the authenticated
  // shell is mounted (i.e. we won't steal keys on /login).
  useShortcutAction('new_policy', openNewPolicy);

  // Shortcuts cheatsheet — F1 (default) or the header keyboard button
  // pops a panel listing every configured shortcut so staff don't have
  // to memorize or dig into settings to recall them.
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  useShortcutAction(
    'show_shortcuts',
    useCallback(() => setCheatsheetOpen((v) => !v), []),
  );

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

          {policiesLocked ? (
            <Button
              onClick={openNewPolicy}
              variant="outline"
              className="h-11 px-4 rounded-full gap-2 shadow-md hover:shadow-lg border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 active:scale-[0.98] text-[15px]"
              title="تجاوزت حد المعاملات — اضغط للترقية"
            >
              <Lock className="h-4 w-4" />
              <span>معاملة جديدة</span>
              <Sparkles className="h-3.5 w-3.5 opacity-70" />
            </Button>
          ) : (
            <Button
              onClick={openNewPolicy}
              disabled={limitsLoading}
              className="h-11 px-4 rounded-full gap-2 shadow-md hover:shadow-lg hover:shadow-foreground/20 active:scale-[0.98] text-[15px] bg-foreground text-background hover:bg-foreground/90"
            >
              <Plus className="h-4 w-4" />
              <span>معاملة جديدة</span>
            </Button>
          )}

          <HeaderDraftsButton />

          {/* Keyboard cheatsheet button — sits in the header cluster so
              staff can always find their shortcuts from one click, no
              matter which page they're on. */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(ICON_BUTTON_CLASS, "md:h-11 md:w-11")}
            onClick={() => setCheatsheetOpen(true)}
            aria-label="اختصارات لوحة المفاتيح"
            title="اختصارات لوحة المفاتيح"
          >
            <Keyboard className="md:h-[18px] md:w-[18px] text-foreground" />
          </Button>

          <NotificationsDropdown
            className={cn(ICON_BUTTON_CLASS, "md:h-11 md:w-11")}
            iconClassName="md:h-[18px] md:w-[18px] text-foreground"
            badgeVariant="dot"
          />
        </div>
      </header>

      <ShortcutsCheatsheetDialog
        open={cheatsheetOpen}
        onOpenChange={setCheatsheetOpen}
      />

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
            {policiesLocked ? (
              <Button
                onClick={openNewPolicy}
                size="sm"
                variant="outline"
                className="h-9 px-3 rounded-full gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                title="تجاوزت حد المعاملات — اضغط للترقية"
              >
                <Lock className="h-4 w-4" />
                <span className="hidden sm:inline">معاملة جديدة</span>
              </Button>
            ) : (
              <Button
                onClick={openNewPolicy}
                disabled={limitsLoading}
                size="sm"
                className="h-9 px-3 rounded-full gap-2 bg-foreground text-background hover:bg-foreground/90"
              >
                <Plus className="h-4 w-4 sm:hidden" />
                <FileText className="h-4 w-4 hidden sm:inline" />
                <span className="hidden sm:inline">معاملة جديدة</span>
              </Button>
            )}
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
