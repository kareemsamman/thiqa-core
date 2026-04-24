import { useCallback, useLayoutEffect, useMemo, useRef, useState, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, FileText, Keyboard, Lock, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

  // Header search now opens as a popover below the icon and extends
  // leftward (RTL `align="start"` == right edge of trigger) so the
  // expanding input doesn't push the cluster around or overlap the
  // center tabs. The underlying BottomToolbarInlineSearch stays the
  // same component — here we just render it inside the popover in its
  // always-expanded (non-collapsible) mode.
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      {/* Desktop header — three inline zones: title (start), tabs
          (flex-1, content-centered), cluster (end). Tabs used to sit
          in an absolutely-centered 629px lane which visually read as
          off-center because the cluster overlapped its left half;
          flex-1 + inner justify-center puts them in the TRUE visual
          middle between the title and the cluster. */}
      <Popover open={searchOpen} onOpenChange={setSearchOpen}>
      <header className="hidden md:flex relative items-center sticky top-0 z-30 h-20 bg-background px-6 mb-6 gap-4">
        {/* Right: title + subtitle. The `border-l` puts a thin vertical
            line at the title block's left edge — in RTL that reads as
            a divider "after the logo", separating the page title from
            the center-tabs zone the user is about to enter. */}
        <div className="min-w-0 shrink overflow-hidden max-w-[28%] border-l border-border/70 pl-4">
          <h1 className="text-xl font-semibold text-foreground truncate">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>

        {/* Center: sibling tabs in a flex-1 lane so they always sit
            centered in whatever space remains between title and
            cluster. If there are too many tabs to fit, the lane
            scrolls internally instead of pushing the cluster. */}
        <nav className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden flex justify-center">
          <div className="flex items-center gap-2 w-max pb-1">
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

        {/* Left: cluster. PopoverAnchor wraps the whole cluster so the
            search popover below matches the cluster's full width
            (from the search icon all the way to the leftmost icon),
            instead of being a fixed 400px leaning to one side. */}
        <PopoverAnchor asChild>
        <div className="flex items-center gap-2 shrink-0">
          <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(ICON_BUTTON_CLASS, "md:h-11 md:w-11")}
                aria-label="بحث"
                title="بحث"
              >
                <Search className="md:h-[18px] md:w-[18px] text-foreground" />
              </Button>
            </PopoverTrigger>
            {/* Popover width matches the anchor (cluster) so the panel
                spans from the search icon on the right all the way to
                the bell on the left. align="center" + matching width
                means the panel sits edge-to-edge with the cluster. */}
            <PopoverContent
              align="center"
              side="bottom"
              sideOffset={8}
              style={{ width: 'var(--radix-popper-anchor-width)' }}
              className="p-0 bg-transparent border-0 shadow-none"
            >
              {/* dropdownMatchWidth makes the results panel match the
                  input's own width; the BottomToolbarInlineSearch
                  already renders its own rounded/shadow glass shell,
                  so the popover wrapper itself stays invisible. */}
              <BottomToolbarInlineSearch
                direction="down"
                dropdownMatchWidth
                inputClassName="h-11 w-full bg-white border-border/60 shadow-md"
              />
            </PopoverContent>

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

          {/* Thin vertical divider separating the primary search + "new
              policy" action from the secondary utility icons (drafts,
              keyboard, notifications) that follow — requested as a
              visual break "before the icons" in the cluster. */}
          <div className="h-7 w-px bg-border/70 mx-1" aria-hidden="true" />

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
        </PopoverAnchor>
      </header>
      </Popover>

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
