import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Icon,
  // group / item icons (used inside `navigationGroups`)
  SquaresFour,
  Users,
  FileText,
  Buildings,
  UserGear,
  Bell,
  ChartBar,
  Wallet,
  CreditCard,
  Image,
  ChatCircle,
  Signature,
  CurrencyDollar,
  ClockCounterClockwise,
  Pulse,
  Truck,
  Shield,
  Megaphone,
  Warning,
  ListChecks,
  AddressBook,
  FileX,
  Envelope,
  // chrome icons (used directly in JSX)
  CaretLeft,
  Question,
  CircleNotch,
  SignOut,
  List,
  Plus,
  Minus,
  Gear,
  UserCircle,
  MagnifyingGlass,
  Palette,
  Crown,
} from "@phosphor-icons/react";
// PanelLeftClose / PanelLeftOpen kept on lucide-react — the user
// specifically picked the lucide design (rounded rect + vertical
// divider + chevron) for the sidebar collapse toggle.
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarNotificationBadge } from "./SidebarNotificationBadge";
import { SidebarDebtBadge } from "./SidebarDebtBadge";
import { SidebarTaskBadge } from "./SidebarTaskBadge";
import { SidebarClaimsBadge } from "./SidebarClaimsBadge";
import { SidebarAccidentsBadge } from "./SidebarAccidentsBadge";
import { SidebarRenewalsBadge } from "./SidebarRenewalsBadge";
import { SidebarSearch } from "./SidebarSearch";
import { ProfileEditDrawer } from "./ProfileEditDrawer";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useAgentContext } from "@/hooks/useAgentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { Lock, Sparkle } from "@phosphor-icons/react";
import thiqaLogo from "@/assets/thiqa-logo-full.svg";
import { useSidebarState } from "@/hooks/useSidebarState";

// Nav source-of-truth lives in ./navigation so non-layout modules
// (usePermissions, etc.) can import it without pulling in the entire
// Sidebar component. Re-exported here for back-compat with existing
// callers that import from "./Sidebar".
export {
  navigationGroups,
  getFirstAccessibleRoute,
  type NavItem,
  type NavGroup,
} from "./navigation";
import { navigationGroups, type NavGroup, type NavItem } from "./navigation";

// Persist the nav scroll across both route navigations (Sidebar
// remounts because MainLayout wraps every page) AND full-page refreshes.
// sessionStorage so it lives for the tab's session but doesn't leak
// across tabs / browser restarts. Fall back to a module-level number
// when sessionStorage is unavailable (SSR / private mode edge cases).
const NAV_SCROLL_STORAGE_KEY = 'thiqa:sidebar:navScrollTop';
const INITIAL_ACTIVE_SCROLL_KEY = 'thiqa:sidebar:initialActiveScrolled';
let PRESERVED_NAV_SCROLL_FALLBACK = 0;

function readPreservedScroll(): number {
  try {
    const raw = sessionStorage.getItem(NAV_SCROLL_STORAGE_KEY);
    const parsed = raw == null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : PRESERVED_NAV_SCROLL_FALLBACK;
  } catch {
    return PRESERVED_NAV_SCROLL_FALLBACK;
  }
}

function writePreservedScroll(value: number) {
  PRESERVED_NAV_SCROLL_FALLBACK = value;
  try {
    sessionStorage.setItem(NAV_SCROLL_STORAGE_KEY, String(value));
  } catch {
    /* ignore — fallback already updated */
  }
}

function hasDoneInitialActiveScroll(): boolean {
  try {
    return sessionStorage.getItem(INITIAL_ACTIVE_SCROLL_KEY) === '1';
  } catch {
    return false;
  }
}

function markInitialActiveScrollDone() {
  try {
    sessionStorage.setItem(INITIAL_ACTIVE_SCROLL_KEY, '1');
  } catch {
    /* ignore */
  }
}

function SidebarContent({ collapsed, onCollapse, onNavigate }: {
  collapsed: boolean;
  onCollapse?: (val: boolean) => void;
  onNavigate?: () => void;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const lastScrolledPathRef = useRef<string | null>(null);
  const lastScrollTimersRef = useRef<number[]>([]);
  const navRef = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Preserve the nav's scrollTop across route navigations AND full-page
  // refreshes (sessionStorage-backed). On mount we restore what was
  // saved last time; on every scroll we update the cache so the next
  // mount — even after F5 — can restore it.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // Restore immediately, then again after layout settles. The second
    // restore catches cases where collapsible groups expand on load and
    // change the content height after the first assignment.
    const saved = readPreservedScroll();
    const restore = () => { nav.scrollTop = saved; };
    restore();
    const raf = requestAnimationFrame(restore);
    const t = window.setTimeout(restore, 120);
    const handleScroll = () => {
      writePreservedScroll(nav.scrollTop);
    };
    nav.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      nav.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Callback ref for the active NavLink. Auto-scroll runs at most once
  // per browser session — the very first landing after opening a tab —
  // so refresh / deep-link behaviour stays useful without clobbering
  // the saved scroll on subsequent navigations or reloads. The "done"
  // flag lives in sessionStorage so it survives remounts and refreshes
  // together with the scroll offset.
  const activeNavLinkRef = useCallback(
    (node: HTMLAnchorElement | null) => {
      if (!node) return;
      if (hasDoneInitialActiveScroll()) return;
      // Don't run when we already have a saved scroll from a prior
      // session interaction — the saved offset is authoritative.
      if (readPreservedScroll() > 0) {
        markInitialActiveScrollDone();
        return;
      }
      markInitialActiveScrollDone();
      lastScrolledPathRef.current = location.pathname;
      const scroll = () => {
        node.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        if (navRef.current) writePreservedScroll(navRef.current.scrollTop);
      };
      requestAnimationFrame(scroll);
      const t1 = window.setTimeout(scroll, 150);
      const t2 = window.setTimeout(scroll, 450);
      lastScrollTimersRef.current.forEach((id) => window.clearTimeout(id));
      lastScrollTimersRef.current = [t1, t2];
    },
    [location.pathname],
  );
  const { user, profile, signOut, isAdmin, branchName, isSuperAdmin } = useAuth();
  // Avatar source: prefer the profile row (admin can edit it), but fall
  // back to whatever Google handed us in user_metadata for OAuth users
  // who haven't been mirrored into profiles.avatar_url yet.
  const avatarUrl = profile?.avatar_url
    || (user?.user_metadata as Record<string, unknown> | undefined)?.avatar_url as string | undefined
    || (user?.user_metadata as Record<string, unknown> | undefined)?.picture as string | undefined
    || null;
  const { data: siteSettings } = useSiteSettings();
  const { hasFeature, isThiqaSuperAdmin, agent, planInfo } = useAgentContext();
  const { can } = usePermissions();
  const { showUpgradePrompt } = useUpgradePrompt();

  // Two-stage filter:
  //   1. Hide items the user lacks permission for (agent admin decides
  //      per-employee) — they shouldn't even know the item exists.
  //   2. Keep items the plan doesn't include but decorate them as
  //      "locked" so the user sees what they're missing. Clicking a
  //      locked item opens the upgrade popup instead of navigating.
  //   Thiqa super admin sees everything in the Thiqa group only.
  const filteredGroups = navigationGroups
    .filter(group => {
      if (isThiqaSuperAdmin) return group.name === 'إدارة ثقة';
      return true;
    })
    .map(group => ({
      ...group,
      items: group.items
        .filter(item => {
          if (isThiqaSuperAdmin) return true;
          if (item.thiqaSuperAdminOnly && !isThiqaSuperAdmin) return false;
          if (item.superAdminOnly && !isSuperAdmin) return false;
          if (item.permissionKey && !can(item.permissionKey)) return false;
          return true;
        })
        .map(item => ({
          ...item,
          locked: !isThiqaSuperAdmin && !!item.featureKey && !hasFeature(item.featureKey),
        })),
    }))
    .filter(group => group.items.length > 0);

  // Check if any item in a group is active. Matches nested routes too
  // so e.g. /clients/abc still activates the "العملاء" group + item.
  const matchesPath = (href: string) =>
    location.pathname === href || location.pathname.startsWith(href + "/");
  const isGroupActive = (group: NavGroup) => {
    return group.items.some(item => matchesPath(item.href));
  };

  // Open ONLY the group that contains the currently active route; keep
  // every other group collapsed. Re-runs on route change so navigating
  // from a tasks page to a clients page closes "الرئيسية" and opens
  // "إدارة العملاء". Manual toggles via the chevron are still preserved
  // until the next route change.
  useEffect(() => {
    const next: Record<string, boolean> = {};
    filteredGroups.forEach((group) => {
      next[group.name] = isGroupActive(group);
    });
    setOpenGroups(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, filteredGroups.length]);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    navigate('/login', { replace: true });
  };

  const handleNavClick = () => {
    onNavigate?.();
  };

  // Accordion behaviour: opening a group closes every other group;
  // closing the active one is a no-op for the others. Means there's
  // always at most ONE expanded group in the nav at a time.
  const toggleGroup = (groupName: string) => {
    setOpenGroups((prev) => {
      const wasOpen = !!prev[groupName];
      if (wasOpen) {
        return { ...prev, [groupName]: false };
      }
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach((k) => { next[k] = false; });
      next[groupName] = true;
      return next;
    });
  };

  const userName = profile?.full_name || profile?.email?.split('@')[0] || 'مستخدم';
  const userInitial = userName.charAt(0);
  const userRole = isAdmin ? 'مدير' : 'موظف';
  const userBranch = branchName;

  const renderBadge = (item: NavItem) => {
    if (!item.badge) return null;
    if (item.badge === 'notifications') return <SidebarNotificationBadge collapsed={collapsed} />;
    if (item.badge === 'debt') return <SidebarDebtBadge collapsed={collapsed} />;
    if (item.badge === 'tasks') return <SidebarTaskBadge collapsed={collapsed} />;
    if (item.badge === 'claims') return <SidebarClaimsBadge collapsed={collapsed} />;
    if (item.badge === 'accidents') return <SidebarAccidentsBadge collapsed={collapsed} />;
    if (item.badge === 'renewals') return <SidebarRenewalsBadge collapsed={collapsed} />;
    return null;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Per-item entrance animation. When the parent CollapsibleContent
          flips data-state="open", each sub-item runs the nav-leaf-in
          keyframe with a stagger driven by the `--i` index variable on
          the row. Uses an animation (not a transition) so it doesn't
          fight Tailwind's `transition-colors` for hover. */}
      <style>{`
        @keyframes nav-leaf-in {
          0%   { opacity: 0; transform: translateY(-6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .nav-leaf {
          opacity: 0;
        }
        [data-state="open"] > .nav-leaves .nav-leaf,
        [data-state="open"] .nav-leaves .nav-leaf {
          animation: nav-leaf-in 220ms ease-out forwards;
          animation-delay: calc(var(--i, 0) * 35ms + 60ms);
        }
      `}</style>
      {/* Logo header.
          Expanded: brand mark + name on the right (RTL start), collapse
          button on the left (RTL end).
          Collapsed: brand mark centred; the expand button moves to the
          row below so the small column doesn't get crowded. */}
      <div
        className={cn(
          "flex h-20 items-center justify-between border-b border-black/[0.06]",
          // Padded only when expanded; collapsed mode lets the logo
          // centre itself in the narrow column with no gutter.
          collapsed ? "px-0" : "px-4",
        )}
      >
        {!collapsed && (
          <>
            <div className="flex items-center gap-2">
              <img src="https://thiqacrm.b-cdn.net/Group%201000011517.png" alt="Thiqa" className="h-9 w-9 rounded-lg object-contain" />
              <span className="text-base font-semibold text-slate-900">Thiqa</span>
            </div>
            {onCollapse && (
              <button
                type="button"
                onClick={() => onCollapse(true)}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                aria-label="تصغير القائمة"
              >
                <PanelLeftClose className="h-5 w-5" strokeWidth={2} />
              </button>
            )}
          </>
        )}
        {collapsed && (
          <img src="https://thiqacrm.b-cdn.net/Group%201000011517.png" alt="Thiqa" className="mx-auto h-9 w-9 rounded-lg object-contain" />
        )}
      </div>

      {/* Search */}
      <SidebarSearch collapsed={collapsed} onNavigate={onNavigate} />

      {/* Navigation */}
      <nav ref={navRef} className="flex-1 flex flex-col gap-1 p-2 overflow-y-auto">
        {filteredGroups.map((group) => {
          const isOpen = openGroups[group.name] ?? false;
          const GroupIcon = group.icon;
          
          if (collapsed) {
            // Collapsed mode: ONE button per group. Hovering opens a
            // FULL-HEIGHT flyout panel positioned to the visual LEFT
            // of the rail (mirrors the Untitled UI reference where
            // hovering a group icon expands the panel). Clicking the
            // group icon navigates to the first UNLOCKED item — if
            // every item in the group is locked we fall through to
            // the upgrade popup keyed to the first item, matching how
            // locked leaves behave in the expanded sidebar.
            const isActiveGroup = isGroupActive(group);
            const GroupIcon = group.icon;
            const firstUnlocked = group.items.find(
              (i) => !(i as typeof i & { locked?: boolean }).locked,
            );
            const allLocked = !firstUnlocked;
            const firstItem = firstUnlocked ?? group.items[0];

            // Common visual for the trigger so NavLink and button
            // variants render identically.
            const triggerClass = cn(
              "flex items-center justify-center rounded-[0.4rem] h-11 w-11 mx-auto transition-colors duration-150 relative",
              isActiveGroup
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
            );
            const triggerChild = (
              <GroupIcon className="h-[22px] w-[22px]" weight={isActiveGroup ? "bold" : "regular"} />
            );

            return (
              <HoverCard key={group.name} openDelay={100} closeDelay={150}>
                <HoverCardTrigger asChild>
                  {allLocked ? (
                    <button
                      type="button"
                      title={group.name}
                      className={triggerClass}
                      onClick={() => {
                        showUpgradePrompt({
                          featureLabel: firstItem.name,
                          featureKey: firstItem.featureKey,
                        });
                      }}
                    >
                      {triggerChild}
                    </button>
                  ) : (
                    <NavLink
                      to={firstItem.href}
                      ref={isActiveGroup ? activeNavLinkRef : undefined}
                      onClick={handleNavClick}
                      title={group.name}
                      className={triggerClass}
                    >
                      {triggerChild}
                    </NavLink>
                  )}
                </HoverCardTrigger>
                <HoverCardContent
                  side="left"
                  sideOffset={0}
                  align="start"
                  alignOffset={-8}
                  collisionPadding={8}
                  className={cn(
                    // Round only the left side + drop the right
                    // border so the panel visually MERGES with the
                    // rail (no seam between them).
                    "p-0 [direction:rtl] rounded-l-2xl rounded-r-none border-y border-l border-r-0 border-black/[0.06] bg-white",
                    "shadow-[-8px_8px_30px_-12px_rgba(15,23,42,0.18)]",
                    "w-[240px] flex flex-col",
                  )}
                  style={{ height: 'calc(100vh - 16px)' }}
                >
                  {/* Header — group name. h-20 + border-b match the
                      rail's logo header dimensions exactly so the two
                      divider lines sit on the same Y. */}
                  <div className="px-4 h-20 flex items-center border-b border-black/[0.06] flex-shrink-0">
                    <span className="text-[15px] font-bold text-black flex items-center gap-2">
                      <GroupIcon className="h-[18px] w-[18px] text-black" weight="bold" />
                      {group.name}
                    </span>
                  </div>
                  {/* Items list — locked items render with the same
                      violet lock-chip treatment as the expanded
                      sidebar so the user sees what their plan is
                      missing instead of a silent navigate-then-redirect. */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                    {group.items.map((item) => {
                      const isActive = matchesPath(item.href);
                      const itemLocked = (item as typeof item & { locked?: boolean }).locked;

                      if (itemLocked) {
                        return (
                          <button
                            key={item.name}
                            type="button"
                            onClick={() => {
                              showUpgradePrompt({
                                featureLabel: item.name,
                                featureKey: item.featureKey,
                              });
                            }}
                            className={cn(
                              "group/locked w-full flex items-center gap-3 px-3 py-2 text-[13.5px] font-semibold rounded-[0.2rem] transition-colors",
                              // Brand-purple wash to match the upgrade
                              // dialogs (#4158b0). Subtle tint at rest,
                              // a touch deeper on hover so it still
                              // reads as interactive.
                              "text-[#3b4f9e] hover:text-[#2a3878]",
                              "bg-gradient-to-l from-[#5468c4]/10 via-[#4158b0]/[0.08] to-[#5468c4]/10 hover:from-[#5468c4]/20 hover:via-[#4158b0]/15 hover:to-[#5468c4]/20",
                            )}
                          >
                            <item.icon
                              className="h-[16px] w-[16px] flex-shrink-0 text-[#4158b0]"
                              weight="regular"
                            />
                            <span className="flex-1 text-right">{item.name}</span>
                            <span
                              className="inline-flex h-5 w-5 items-center justify-center rounded-md shrink-0 shadow-sm ring-1 ring-white/40 transition-transform group-hover/locked:scale-110"
                              style={{
                                background:
                                  'linear-gradient(135deg, #5468c4 0%, #4158b0 50%, #2a3878 100%)',
                              }}
                            >
                              <Lock className="h-3 w-3 text-white" weight="fill" />
                            </span>
                          </button>
                        );
                      }

                      return (
                        <NavLink
                          key={item.name}
                          to={item.href}
                          onClick={handleNavClick}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 text-[13.5px] rounded-[0.2rem] transition-colors",
                            isActive
                              ? "bg-[#f3f5f7] text-black font-bold"
                              : "text-[#656565] font-normal hover:bg-slate-50 hover:text-black",
                          )}
                        >
                          <item.icon
                            className={cn(
                              "h-[16px] w-[16px] flex-shrink-0",
                              isActive ? "text-black" : "text-slate-500",
                            )}
                            weight={isActive ? "bold" : "regular"}
                          />
                          <span className="flex-1 text-right">{item.name}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                </HoverCardContent>
              </HoverCard>
            );
          }

          // Desktop group: light Untitled-UI-style trigger. Active
          // group (the one whose route is open) gets a soft slate
          // background. Open submenu has a thin right-edge guide line
          // (RTL "start" side); the active leaf has a black dot
          // centered ON the line, plus a slate-100 pill background.
          // Counting badges are intentionally omitted from the desktop
          // nav for a cleaner look.
          const isActiveGroup = isGroupActive(group);
          return (
            <Collapsible
              key={group.name}
              open={isOpen}
              onOpenChange={() => toggleGroup(group.name)}
              className="mb-0.5"
            >
              <CollapsibleTrigger
                className={cn(
                  "group flex items-center w-full px-3 py-2.5 rounded-[0.2rem] gap-3 text-black transition-colors duration-150",
                  "hover:bg-slate-50",
                  isActiveGroup && "bg-[#f3f5f7]",
                )}
              >
                <GroupIcon
                  className="h-[18px] w-[18px] shrink-0 text-black"
                  weight={isActiveGroup ? "bold" : "regular"}
                />
                <span
                  className={cn(
                    "flex-1 text-right text-[14px] tracking-[0.01em] whitespace-nowrap text-black",
                    isActiveGroup ? "font-bold" : "font-semibold",
                  )}
                >
                  {group.name}
                </span>
                {/* + when closed (light grey), − when open (black). */}
                {isOpen ? (
                  <Minus className="h-[14px] w-[14px] shrink-0 text-black" weight="bold" />
                ) : (
                  <Plus className="h-[14px] w-[14px] shrink-0 text-[#a7a6a9]" weight="bold" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                {/* Submenu — text-only items, matching the Untitled UI
                    reference. The guide line sits on the inline-START
                    side (visual RIGHT in RTL, directly UNDER the group
                    icon column). The active item's pill bg is rendered
                    as an absolute child of NavLink and is stretched
                    4px past the line in the start direction so the
                    dot (centred on the line) ends up fully embedded
                    inside the pill. */}
                <div className="nav-leaves relative mt-1 py-1 space-y-0.5">
                  {group.items.map((item, idx) => {
                    const isActiveRoute = matchesPath(item.href);
                    const itemLocked = (item as typeof item & { locked?: boolean }).locked;

                    // Locked items render as a button (not a link) so
                    // clicking opens the upgrade popup keyed to the
                    // missing feature instead of navigating into a
                    // page that would just redirect anyway. The chip
                    // styling is muted + lock icon so it reads as
                    // "can be yours, not yet" — part of the always-be-
                    // selling UX the product asked for.
                    if (itemLocked) {
                      return (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => {
                            showUpgradePrompt({
                              featureLabel: item.name,
                              featureKey: item.featureKey,
                            });
                          }}
                          style={{ ['--i' as any]: idx }}
                          className={cn(
                            "nav-leaf group/locked relative w-full flex items-center py-2 text-[13.5px] font-semibold transition-all duration-150 rounded-md cursor-pointer",
                            // Brand-purple wash matching the upgrade
                            // dialogs (#4158b0) — replaces the old
                            // violet→fuchsia→amber candy gradient so
                            // every "upgrade-needed" surface in the
                            // app shares one identity.
                            "text-[#3b4f9e] hover:text-[#2a3878]",
                            "bg-gradient-to-l from-[#5468c4]/10 via-[#4158b0]/[0.08] to-[#5468c4]/10 hover:from-[#5468c4]/20 hover:via-[#4158b0]/15 hover:to-[#5468c4]/20",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute w-px bg-[#5468c4]/30 z-10"
                            style={{ insetInlineStart: '17px', top: '-1px', bottom: '-1px' }}
                          />
                          <span
                            className="relative z-20 flex-1 flex items-center gap-2 text-right"
                            style={{ paddingInline: '33px 12px' }}
                          >
                            <span className="flex-1">{item.name}</span>
                            <span
                              className="inline-flex h-5 w-5 items-center justify-center rounded-md shrink-0 shadow-sm ring-1 ring-white/40 transition-transform group-hover/locked:scale-110"
                              style={{
                                background:
                                  'linear-gradient(135deg, #5468c4 0%, #4158b0 50%, #2a3878 100%)',
                              }}
                            >
                              <Lock className="h-3 w-3 text-white" weight="fill" />
                            </span>
                          </span>
                        </button>
                      );
                    }

                    return (
                      <NavLink
                        key={item.name}
                        to={item.href}
                        ref={isActiveRoute ? activeNavLinkRef : undefined}
                        onClick={handleNavClick}
                        style={{ ['--i' as any]: idx }}
                        className={cn(
                          "nav-leaf relative flex items-center py-2 text-[13.5px] transition-colors duration-150 rounded-[0.2rem]",
                          isActiveRoute
                            ? "text-black font-bold"
                            : "text-[#656565] font-normal hover:text-black hover:bg-slate-50",
                        )}
                      >
                        {/* Per-row guide line segment. Rendered INSIDE
                            the NavLink (not the wrapper) because the
                            entrance animation puts a `transform` on
                            each row, which creates a stacking context
                            — keeping the line in the same context as
                            the dot lets z-index actually work. The
                            `top:-1px / bottom:-1px` overshoot fills
                            the 2px space-y-0.5 gap between rows so
                            the segments visually merge into one
                            continuous line. */}
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute w-px bg-[#e9e9e9] z-10"
                          style={{ insetInlineStart: '17px', top: '-1px', bottom: '-1px' }}
                        />
                        {/* Active pill bg — STOPS 24px before the
                            inline-start edge so the line + dot
                            column stays visible to the right of the
                            pill. */}
                        {isActiveRoute && (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-0 rounded-[0.2rem] bg-[#f3f5f7] pointer-events-none"
                            style={{ insetInlineEnd: 0, insetInlineStart: '24px' }}
                          />
                        )}
                        {/* Black dot centred ON the line. 1px line at
                            inset-inline-start:17px → centre 17.5px.
                            8px dot → start at 17.5 - 4 = 13.5px so
                            the dot centre lands on the line centre.
                            z-30 sits above the line (z-10) inside
                            the same NavLink stacking context. */}
                        {isActiveRoute && (
                          <span
                            aria-hidden="true"
                            className="absolute top-1/2 h-[8px] w-[8px] rounded-full bg-black z-30"
                            style={{ insetInlineStart: '13.5px', transform: 'translateY(-50%)' }}
                          />
                        )}
                        <span
                          className="relative z-20 flex-1 text-right"
                          style={{ paddingInline: '33px 12px' }}
                        >
                          {item.name}
                        </span>
                      </NavLink>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </nav>

      {/* Expand button — only shows when the sidebar is collapsed.
          When the sidebar is expanded the toggle lives next to the
          logo (top header), so we don't render anything here. */}
      {onCollapse && collapsed && (
        <div className="px-2 pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCollapse(false)}
            className="w-full justify-center h-10 px-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            aria-label="توسيع القائمة"
          >
            <PanelLeftOpen className="h-5 w-5" strokeWidth={2} />
          </Button>
        </div>
      )}

      {/* Trial countdown card — only on the expanded sidebar for an
          agent admin who's still on the free trial AND no nav group
          is currently expanded. Sits above the user section so it's
          always visible without competing for nav real-estate, and
          uses the brand-purple lock palette so it reads as part of
          the same "upgrade-needed" surface as the locked nav leaves
          and the upgrade dialogs. Clicking opens the upgrade popup
          keyed to no specific feature — the user's hitting it from
          the global nav, not from a blocked action, so the popup
          just shows the plan ladder.
          We hide the card the moment any nav group is opened so the
          expanded group's items can use the vertical space without
          the card competing for the bottom of the rail. */}
      {!collapsed && !isThiqaSuperAdmin && isAdmin && agent &&
       !Object.values(openGroups).some(Boolean) && (() => {
        const isTrial = agent.subscription_status === 'trial' ||
          (agent.monthly_price === 0 && agent.subscription_status === 'active');
        if (!isTrial) return null;

        // Free trial is 35 days end-to-end; trial_ends_at is the
        // anchor (set on registration). Falls back to
        // subscription_expires_at for legacy rows that pre-date the
        // dedicated trial_ends_at column.
        // Math.floor matches every other surface that displays
        // remaining trial days (settings page, user-menu badge), so
        // the card and those readouts always agree to within 0 days
        // — no more "card says 30, settings says 29" off-by-one.
        const TRIAL_LENGTH = 35;
        const endDate = agent.trial_ends_at
          ? new Date(agent.trial_ends_at)
          : agent.subscription_expires_at
            ? new Date(agent.subscription_expires_at)
            : null;
        if (!endDate) return null;
        const daysLeft = Math.max(
          0,
          Math.floor((endDate.getTime() - Date.now()) / 86400000),
        );
        const used = Math.min(TRIAL_LENGTH, Math.max(0, TRIAL_LENGTH - daysLeft));
        const progress = (used / TRIAL_LENGTH) * 100;

        return (
          <div className="px-3 pb-3 pt-2">
            <div className="rounded-2xl border border-[#5468c4]/25 bg-gradient-to-b from-[#5468c4]/8 via-[#4158b0]/5 to-white p-3.5 shadow-sm">
              <div
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm mb-2.5"
                style={{
                  background:
                    'linear-gradient(135deg, #5468c4 0%, #4158b0 50%, #2a3878 100%)',
                }}
              >
                <Lock className="h-4 w-4" weight="fill" />
              </div>
              <p className="text-right">
                <span className="text-xl font-extrabold text-slate-900 tabular-nums">
                  {used}
                </span>
                <span className="text-xs font-medium text-slate-500 mx-1">
                  / {TRIAL_LENGTH} يوم
                </span>
              </p>
              <p className="text-[11.5px] text-slate-600 leading-relaxed mt-1 mb-2.5">
                اشترك الآن لفتح كل ميزات النظام بعد انتهاء التجربة.
              </p>
              {/* Slim progress bar — used / total. Brand-purple fill
                  so it ties back to the lock chip above. */}
              <div className="h-1 w-full bg-slate-200/70 rounded-full overflow-hidden mb-2.5">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progress}%`,
                    background:
                      'linear-gradient(90deg, #5468c4 0%, #4158b0 100%)',
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => showUpgradePrompt({})}
                className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-full text-xs font-bold text-white shadow-sm hover:shadow-md transition-shadow"
                style={{
                  background:
                    'linear-gradient(135deg, #5468c4 0%, #4158b0 50%, #2a3878 100%)',
                }}
              >
                <Sparkle className="h-3.5 w-3.5" weight="fill" />
                ترقية الباقة
              </button>
            </div>
          </div>
        );
      })()}

      {/* User section.
          Expanded sidebar: an inline Collapsible that opens UPWARD
          (CollapsibleContent rendered ABOVE the trigger). Replaces
          the old floating DropdownMenu — feels native to the
          sidebar instead of an overlay. The triggering avatar row
          stays anchored at the bottom.
          Collapsed sidebar: small DropdownMenu fallback since the
          narrow column has no room to expand inline. */}
      <div className="border-t border-black/[0.06]">
        {!collapsed ? (
          (() => {
            const trial = (() => {
              if (isThiqaSuperAdmin || !agent) return null;
              const isTrial = agent.subscription_status === 'trial' || (agent.monthly_price === 0 && agent.subscription_status === 'active');
              const endDate = isTrial
                ? (agent.trial_ends_at ? new Date(agent.trial_ends_at) : (agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null))
                : (agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null);
              const days = endDate ? Math.max(0, Math.floor((endDate.getTime() - Date.now()) / 86400000)) : null;
              const periodLength = isTrial ? 35 : agent.billing_cycle === 'yearly' ? 365 : 30;
              const progress = days !== null ? Math.min(100, Math.max(0, ((periodLength - days) / periodLength) * 100)) : 0;
              return { isTrial, days, progress };
            })();

            const triggerOnboarding = () => {
              setUserMenuOpen(false);
              if (location.pathname === '/dashboard') {
                window.dispatchEvent(new Event('show-onboarding'));
                return;
              }
              navigate('/dashboard');
              setTimeout(() => {
                window.dispatchEvent(new Event('show-onboarding'));
              }, 150);
            };

            return (
              <Collapsible open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                {/* Expanded content sits ABOVE the trigger because of
                    DOM order — Radix animates height regardless. */}
                <CollapsibleContent className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                  <div className="px-3 pt-3">
                    {/* Profile info card — soft slate panel */}
                    <div className="rounded-xl bg-slate-50 border border-slate-200/70 p-3">
                      <p className="truncate text-[13px] font-semibold text-slate-900 text-right">
                        {userName}
                      </p>
                      <p className="truncate text-[11.5px] text-slate-500 text-right mt-0.5" dir="ltr">
                        {profile?.email}
                      </p>
                      {isAdmin && trial && agent && (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={cn(
                                "inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded",
                                trial.isTrial ? "text-white" :
                                agent.subscription_status === 'active' ? 'bg-green-100 text-green-700' :
                                agent.subscription_status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700',
                              )}
                              style={trial.isTrial ? {
                                background: "linear-gradient(rgb(69, 94, 187) 0%, rgb(138, 150, 203) 100%), rgba(255, 255, 255, 0.02)",
                              } : undefined}
                            >
                              {trial.isTrial ? 'تجربة مجانية' : (planInfo?.name_ar || planInfo?.name || (agent.plan === 'pro' ? 'Pro' : 'Basic'))}
                            </span>
                            {trial.days !== null && (
                              <span className={cn("text-[10px] font-medium",
                                trial.days <= 0 ? "text-destructive" : trial.days <= 7 ? "text-yellow-600" : "text-slate-500"
                              )}>
                                {trial.days <= 0 ? 'منتهي' : `${trial.days} يوم متبقي`}
                              </span>
                            )}
                          </div>
                          {trial.days !== null && (
                            <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${trial.progress}%`,
                                  background: trial.days <= 7
                                    ? undefined
                                    : "linear-gradient(rgb(69, 94, 187) 0%, rgb(138, 150, 203) 100%), rgba(255, 255, 255, 0.02)",
                                  ...(trial.days <= 7 ? { backgroundColor: 'hsl(var(--destructive))' } : null),
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action items */}
                    <div className="mt-1.5 space-y-0.5">
                      <button
                        type="button"
                        onClick={() => { setUserMenuOpen(false); setProfileOpen(true); }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[0.2rem] text-[13px] text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                      >
                        <UserCircle className="h-4 w-4 text-slate-500" weight="regular" />
                        <span className="flex-1 text-right">الملف الشخصي</span>
                      </button>

                      {isAdmin && !isThiqaSuperAdmin && (
                        <button
                          type="button"
                          onClick={() => { setUserMenuOpen(false); navigate('/subscription'); }}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[0.2rem] text-[13px] text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                        >
                          <Gear className="h-4 w-4 text-slate-500" weight="regular" />
                          <span className="flex-1 text-right">الإعدادات</span>
                        </button>
                      )}

                      {isAdmin && !isThiqaSuperAdmin && (
                        <button
                          type="button"
                          onClick={triggerOnboarding}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[0.2rem] text-[13px] text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                        >
                          <Question className="h-4 w-4 text-slate-500" weight="regular" />
                          <span className="flex-1 text-right">دليل البداية</span>
                        </button>
                      )}

                      <div className="my-1 h-px bg-slate-200/80" />

                      <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[0.2rem] text-[13px] text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                      >
                        {signingOut ? (
                          <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
                        ) : (
                          <SignOut className="h-4 w-4" weight="regular" />
                        )}
                        <span className="flex-1 text-right">تسجيل الخروج</span>
                      </button>
                    </div>
                  </div>
                </CollapsibleContent>

                {/* Trigger row — anchored at the bottom */}
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 p-3 transition-colors hover:bg-slate-50"
                  >
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt={userName}
                        referrerPolicy="no-referrer"
                        className="h-9 w-9 rounded-full object-cover ring-2 ring-white flex-shrink-0"
                      />
                    ) : (
                      <div
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full shadow-[0_4px_12px_-4px_rgba(69,94,187,0.45)]"
                        style={{
                          background:
                            "linear-gradient(180deg, #455EBB 0%, #8A96CB 100%), rgba(255, 255, 255, 0.02)",
                        }}
                      >
                        <span className="text-sm font-bold text-white">{userInitial}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0 text-right">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {userName}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {userRole}{userBranch ? ` • ${userBranch}` : ''}
                      </p>
                    </div>
                    {userMenuOpen ? (
                      <Minus className="h-4 w-4 shrink-0 text-slate-700" weight="bold" />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-[#a7a6a9]" weight="bold" />
                    )}
                  </button>
                </CollapsibleTrigger>
              </Collapsible>
            );
          })()
        ) : (
          // Collapsed mode profile — Popover (click-trigger) styled
          // exactly like the group hover flyouts: full-height panel,
          // merged with the rail (no right border / right rounding),
          // h-20 header so the divider lines line up across both
          // panels. Same content as the expanded inline menu —
          // profile card with trial info + the four action rows.
          (() => {
            const trial = (() => {
              if (isThiqaSuperAdmin || !agent) return null;
              const isTrial = agent.subscription_status === 'trial' || (agent.monthly_price === 0 && agent.subscription_status === 'active');
              const endDate = isTrial
                ? (agent.trial_ends_at ? new Date(agent.trial_ends_at) : (agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null))
                : (agent.subscription_expires_at ? new Date(agent.subscription_expires_at) : null);
              const days = endDate ? Math.max(0, Math.floor((endDate.getTime() - Date.now()) / 86400000)) : null;
              const periodLength = isTrial ? 35 : agent.billing_cycle === 'yearly' ? 365 : 30;
              const progress = days !== null ? Math.min(100, Math.max(0, ((periodLength - days) / periodLength) * 100)) : 0;
              return { isTrial, days, progress };
            })();

            const triggerOnboardingCollapsed = () => {
              setUserMenuOpen(false);
              if (location.pathname === '/dashboard') {
                window.dispatchEvent(new Event('show-onboarding'));
                return;
              }
              navigate('/dashboard');
              setTimeout(() => {
                window.dispatchEvent(new Event('show-onboarding'));
              }, 150);
            };

            return (
              <div className="p-3">
                <Popover open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-center rounded-lg p-2 transition-colors hover:bg-slate-100"
                    >
                      {profile?.avatar_url ? (
                        <img
                          src={profile.avatar_url}
                          alt={userName}
                          className="h-9 w-9 rounded-full object-cover ring-2 ring-white flex-shrink-0"
                        />
                      ) : (
                        <div
                          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full shadow-[0_4px_12px_-4px_rgba(69,94,187,0.45)]"
                          style={{
                            background:
                              "linear-gradient(180deg, #455EBB 0%, #8A96CB 100%), rgba(255, 255, 255, 0.02)",
                          }}
                        >
                          <span className="text-sm font-bold text-white">{userInitial}</span>
                        </div>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="left"
                    sideOffset={0}
                    align="end"
                    alignOffset={-8}
                    collisionPadding={8}
                    className={cn(
                      "p-0 [direction:rtl] rounded-l-2xl rounded-r-none border-y border-l border-r-0 border-black/[0.06] bg-white",
                      "shadow-[-8px_8px_30px_-12px_rgba(15,23,42,0.18)]",
                      "w-[260px] flex flex-col",
                    )}
                    style={{ height: 'calc(100vh - 16px)' }}
                  >
                    {/* Header — h-20 + border-b mirrors the rail's
                        logo header so the dividers align. */}
                    <div className="px-4 h-20 flex items-center border-b border-black/[0.06] flex-shrink-0">
                      <span className="text-[15px] font-bold text-black flex items-center gap-2">
                        <UserCircle className="h-[18px] w-[18px] text-black" weight="bold" />
                        حسابك
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3">
                      {/* Profile info card */}
                      <div className="rounded-xl bg-slate-50 border border-slate-200/70 p-3">
                        <p className="truncate text-[13px] font-semibold text-slate-900 text-right">
                          {userName}
                        </p>
                        <p className="truncate text-[11.5px] text-slate-500 text-right mt-0.5" dir="ltr">
                          {profile?.email}
                        </p>
                        {isAdmin && trial && agent && (
                          <div className="mt-2 space-y-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={cn(
                                  "inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded",
                                  trial.isTrial ? "text-white" :
                                  agent.subscription_status === 'active' ? 'bg-green-100 text-green-700' :
                                  agent.subscription_status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-red-100 text-red-700',
                                )}
                                style={trial.isTrial ? {
                                  background: "linear-gradient(rgb(69, 94, 187) 0%, rgb(138, 150, 203) 100%), rgba(255, 255, 255, 0.02)",
                                } : undefined}
                              >
                                {trial.isTrial ? 'تجربة مجانية' : (planInfo?.name_ar || planInfo?.name || (agent.plan === 'pro' ? 'Pro' : 'Basic'))}
                              </span>
                              {trial.days !== null && (
                                <span className={cn("text-[10px] font-medium",
                                  trial.days <= 0 ? "text-destructive" : trial.days <= 7 ? "text-yellow-600" : "text-slate-500"
                                )}>
                                  {trial.days <= 0 ? 'منتهي' : `${trial.days} يوم متبقي`}
                                </span>
                              )}
                            </div>
                            {trial.days !== null && (
                              <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${trial.progress}%`,
                                    background: trial.days <= 7
                                      ? undefined
                                      : "linear-gradient(rgb(69, 94, 187) 0%, rgb(138, 150, 203) 100%), rgba(255, 255, 255, 0.02)",
                                    ...(trial.days <= 7 ? { backgroundColor: 'hsl(var(--destructive))' } : null),
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Action rows */}
                      <div className="mt-1.5 space-y-0.5">
                        <button
                          type="button"
                          onClick={() => { setUserMenuOpen(false); setProfileOpen(true); }}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[0.2rem] text-[13px] text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                        >
                          <UserCircle className="h-4 w-4 text-slate-500" weight="regular" />
                          <span className="flex-1 text-right">الملف الشخصي</span>
                        </button>

                        {isAdmin && !isThiqaSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => { setUserMenuOpen(false); navigate('/subscription'); }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[0.2rem] text-[13px] text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                          >
                            <Gear className="h-4 w-4 text-slate-500" weight="regular" />
                            <span className="flex-1 text-right">الإعدادات</span>
                          </button>
                        )}

                        {isAdmin && !isThiqaSuperAdmin && (
                          <button
                            type="button"
                            onClick={triggerOnboardingCollapsed}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[0.2rem] text-[13px] text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                          >
                            <Question className="h-4 w-4 text-slate-500" weight="regular" />
                            <span className="flex-1 text-right">دليل البداية</span>
                          </button>
                        )}

                        <div className="my-1 h-px bg-slate-200/80" />

                        <button
                          type="button"
                          onClick={handleSignOut}
                          disabled={signingOut}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[0.2rem] text-[13px] text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                        >
                          {signingOut ? (
                            <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
                          ) : (
                            <SignOut className="h-4 w-4" weight="regular" />
                          )}
                          <span className="flex-1 text-right">تسجيل الخروج</span>
                        </button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            );
          })()
        )}
      </div>

      {/* Profile Edit Drawer */}
      <ProfileEditDrawer open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  );
}

// ============================================================================
// MobileTopBar — fixed top bar on mobile with logo, a profile avatar button
// that opens the profile edit drawer, and a hamburger that opens the nav.
// ============================================================================
function MobileTopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, profile, isAdmin } = useAuth();
  const avatarUrl = profile?.avatar_url
    || (user?.user_metadata as Record<string, unknown> | undefined)?.avatar_url as string | undefined
    || (user?.user_metadata as Record<string, unknown> | undefined)?.picture as string | undefined
    || null;
  const { data: siteSettings } = useSiteSettings();
  const { isThiqaSuperAdmin } = useAgentContext();
  const [profileOpen, setProfileOpen] = useState(false);

  const userName = profile?.full_name || profile?.email?.split('@')[0] || 'مستخدم';
  const userInitial = (userName.charAt(0) || '?').toUpperCase();

  return (
    <>
      <div
        className="fixed top-0 inset-x-0 z-50 md:hidden h-14 hero-gradient flex items-center justify-between px-3 shadow-lg"
        dir="rtl"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="https://thiqacrm.b-cdn.net/Group%201000011517.png" alt="Thiqa" className="h-7 w-7 rounded object-contain shrink-0" />
          <span className="text-white/90 text-sm font-semibold truncate">Thiqa</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
            aria-label="الملف الشخصي"
          >
            <Avatar className="h-8 w-8 border border-white/20">
              {avatarUrl && <AvatarImage src={avatarUrl} alt={userName} referrerPolicy="no-referrer" />}
              <AvatarFallback className="bg-white/10 text-white text-xs font-semibold">
                {userInitial}
              </AvatarFallback>
            </Avatar>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white/80 hover:text-white hover:bg-white/10 h-9 w-9"
            onClick={onOpenMenu}
            aria-label="فتح القائمة"
          >
            <List className="h-5 w-5" weight="regular" />
          </Button>
        </div>
      </div>

      <ProfileEditDrawer open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}

// ============================================================================
// MobileSidebarContent — redesigned mobile nav: light theme, clean rows,
// profile header, inline search, and an always-visible sign out at the bottom.
// The desktop sidebar still uses the dark SidebarContent above.
// ============================================================================
function MobileSidebarContent({ onNavigate }: { onNavigate: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, signOut, isAdmin, branchName, isSuperAdmin } = useAuth();
  const avatarUrl = profile?.avatar_url
    || (user?.user_metadata as Record<string, unknown> | undefined)?.avatar_url as string | undefined
    || (user?.user_metadata as Record<string, unknown> | undefined)?.picture as string | undefined
    || null;
  const { data: siteSettings } = useSiteSettings();
  const { hasFeature, isThiqaSuperAdmin } = useAgentContext();
  const { showUpgradePrompt } = useUpgradePrompt();

  // Mirror the desktop sidebar's two-stage filter: hide items the user
  // has no permission for (they shouldn't know they exist), but keep
  // plan-locked items visible with a lock chip so the user can see
  // what's behind the next tier. Tapping a locked item opens the
  // upgrade dialog instead of routing into a redirect.
  const filteredGroups = useMemo(() => {
    return navigationGroups
      .filter(group => {
        if (isThiqaSuperAdmin) return group.name === 'إدارة ثقة';
        if (group.adminOnly && !isAdmin) return false;
        return true;
      })
      .map(group => ({
        ...group,
        items: group.items
          .filter(item => {
            if (isThiqaSuperAdmin) return true;
            if (item.thiqaSuperAdminOnly && !isThiqaSuperAdmin) return false;
            if (item.superAdminOnly && !isSuperAdmin) return false;
            if (item.adminOnly && !isAdmin) return false;
            return true;
          })
          .map(item => ({
            ...item,
            locked: !isThiqaSuperAdmin && !!item.featureKey && !hasFeature(item.featureKey),
          })),
      }))
      .filter(group => group.items.length > 0);
  }, [isAdmin, isSuperAdmin, isThiqaSuperAdmin, hasFeature]);

  // Apply text-search filter
  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredGroups;
    return filteredGroups
      .map(group => ({
        ...group,
        items: group.items.filter(item => item.name.toLowerCase().includes(q)),
      }))
      .filter(group => group.items.length > 0);
  }, [filteredGroups, query]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const userName = profile?.full_name || profile?.email?.split('@')[0] || 'مستخدم';
  const userInitial = (userName.charAt(0) || '?').toUpperCase();
  const userRole = isAdmin ? 'مدير' : 'موظف';

  const renderBadge = (item: NavItem) => {
    if (!item.badge) return null;
    if (item.badge === 'notifications') return <SidebarNotificationBadge collapsed={false} />;
    if (item.badge === 'debt') return <SidebarDebtBadge collapsed={false} />;
    if (item.badge === 'tasks') return <SidebarTaskBadge collapsed={false} />;
    if (item.badge === 'claims') return <SidebarClaimsBadge collapsed={false} />;
    if (item.badge === 'accidents') return <SidebarAccidentsBadge collapsed={false} />;
    if (item.badge === 'renewals') return <SidebarRenewalsBadge collapsed={false} />;
    return null;
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Header: logo + site title. Logo sits on a tinted circle so white
          or light-colored logos stay visible against the white sheet bg.
          Drawer adds its own grab handle above this automatically. */}
      <div className="flex items-center gap-3 px-4 py-3 border-b mt-2">
        <div className="h-11 w-11 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 p-1.5">
          {isThiqaSuperAdmin ? (
            <img src={thiqaLogo} alt="Thiqa" className="max-h-full max-w-full object-contain" />
          ) : (
            <img src="https://thiqacrm.b-cdn.net/Group%201000011517.png" alt="Thiqa" className="max-h-full max-w-full object-contain" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">Thiqa</p>
          <p className="text-[11px] text-muted-foreground">نظام إدارة التأمين</p>
        </div>
      </div>

      {/* Profile card */}
      <button
        type="button"
        onClick={() => setProfileOpen(true)}
        className="flex items-center gap-3 px-4 py-3 border-b hover:bg-muted/40 transition-colors text-right"
      >
        <Avatar className="h-11 w-11 border">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={userName} referrerPolicy="no-referrer" />}
          <AvatarFallback className="bg-primary/10 text-primary font-semibold">
            {userInitial}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{userName}</p>
          <p className="text-xs text-muted-foreground truncate">
            {userRole}
            {branchName && <span className="mx-1">·</span>}
            {branchName}
          </p>
        </div>
        <CaretLeft className="h-4 w-4 text-muted-foreground shrink-0" weight="regular" />
      </button>

      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <MagnifyingGlass className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" weight="regular" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن صفحة..."
            className="h-10 pr-9 text-sm"
          />
        </div>
      </div>

      {/* Nav list */}
      <nav className="flex-1 overflow-y-auto p-2">
        {visibleGroups.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            لا توجد نتائج
          </div>
        ) : (
          visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.name} className="mb-3">
                <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-foreground tracking-wide">
                  <GroupIcon className="h-4 w-4 text-muted-foreground" />
                  <span>{group.name}</span>
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActiveRoute = location.pathname === item.href;
                    const ItemIcon = item.icon;

                    if (item.locked) {
                      return (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => {
                            showUpgradePrompt({
                              featureLabel: item.name,
                              featureKey: item.featureKey,
                            });
                          }}
                          className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors text-right text-[#3b4f9e] hover:text-[#2a3878] bg-gradient-to-l from-[#5468c4]/10 via-[#4158b0]/[0.08] to-[#5468c4]/10 hover:from-[#5468c4]/20 hover:via-[#4158b0]/15 hover:to-[#5468c4]/20"
                        >
                          <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-white/60 text-[#4158b0]">
                            <ItemIcon className="h-4 w-4" />
                          </div>
                          <span className="flex-1 truncate">{item.name}</span>
                          <span
                            className="inline-flex h-5 w-5 items-center justify-center rounded-md shrink-0 shadow-sm ring-1 ring-white/40"
                            style={{
                              background:
                                'linear-gradient(135deg, #5468c4 0%, #4158b0 50%, #2a3878 100%)',
                            }}
                          >
                            <Lock className="h-3 w-3 text-white" weight="fill" />
                          </span>
                        </button>
                      );
                    }

                    return (
                      <NavLink
                        key={item.name}
                        to={item.href}
                        onClick={onNavigate}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                          isActiveRoute
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted/60 text-foreground"
                        )}
                      >
                        <div
                          className={cn(
                            "h-9 w-9 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                            isActiveRoute
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <ItemIcon className="h-4 w-4" />
                        </div>
                        <span className="flex-1 truncate">{item.name}</span>
                        {renderBadge(item)}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}

        {/* Account & help — mirrors the desktop profile dropdown so mobile
            users can reach the same links without the profile menu.
            Admin-only: workers don't get a settings/subscription path. */}
        {!query && !isThiqaSuperAdmin && isAdmin && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              <UserCircle className="h-3 w-3" weight="regular" />
              <span>الحساب والمساعدة</span>
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  navigate('/subscription');
                  onNavigate();
                }}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60 text-foreground text-right"
              >
                <div className="h-9 w-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <Gear className="h-4 w-4" weight="regular" />
                </div>
                <span className="flex-1 truncate">الإعدادات</span>
              </button>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    onNavigate();
                    if (location.pathname === '/dashboard') {
                      window.dispatchEvent(new Event('show-onboarding'));
                    } else {
                      navigate('/dashboard');
                      setTimeout(() => {
                        window.dispatchEvent(new Event('show-onboarding'));
                      }, 150);
                    }
                  }}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60 text-foreground text-right"
                >
                  <div className="h-9 w-9 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                    <Question className="h-4 w-4" weight="regular" />
                  </div>
                  <span className="flex-1 truncate">دليل البداية</span>
                </button>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Sign out footer — extra bottom padding so the button clears the
          iOS home indicator / mobile browser chrome. */}
      <div className="px-3 pt-3 pb-6 border-t">
        <Button
          variant="outline"
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
        >
          {signingOut ? (
            <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
          ) : (
            <SignOut className="h-4 w-4" weight="regular" />
          )}
          تسجيل الخروج
        </Button>
      </div>

      {/* Profile Edit Drawer */}
      <ProfileEditDrawer open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  );
}

export function Sidebar() {
  const { collapsed, setCollapsed } = useSidebarState();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Auto-collapse at narrow desktop widths (< xl, 1280px). Expanded
  // sidebar is 222px + margins, leaving ~620px of content area at
  // 900-1000px viewports — the layout inside (header + stat cards
  // etc.) starts folding badly. Force collapse whenever the viewport
  // is below the xl breakpoint so there's enough room for content.
  // User can still expand manually at that width via the collapse
  // chevron; the effect only fires on resize crossings + initial mount.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const apply = () => {
      if (mq.matches) setCollapsed(true);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [setCollapsed]);

  return (
    <>
      {/* Mobile top navbar */}
      <MobileTopBar onOpenMenu={() => setMobileOpen(true)} />

      {/* Mobile nav — vaul-powered bottom drawer with native swipe-to-dismiss */}
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerContent className="h-[90vh] max-h-[90vh] p-0 bg-background text-foreground" dir="rtl">
          <MobileSidebarContent onNavigate={() => setMobileOpen(false)} />
        </DrawerContent>
      </Drawer>

      {/* Desktop sidebar - floating with margin */}
      <aside
        className={cn(
          "fixed right-2 top-2 bottom-2 z-40 rounded-2xl border border-black/[0.06] bg-white transition-all duration-300 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)] hidden md:block overflow-hidden",
          collapsed ? "w-16" : "w-[222px]"
        )}
      >
        <SidebarContent 
          collapsed={collapsed} 
          onCollapse={setCollapsed}
        />
      </aside>
    </>
  );
}

// Export for MainLayout to know sidebar width
export function useSidebarWidth() {
  return { desktop: 222, collapsed: 64 };
}
