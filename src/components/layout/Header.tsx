import { useState, useMemo, useRef, useEffect, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, Plus, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NotificationsDropdown } from "./NotificationsDropdown";
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
const ICON_CLASS = "h-[18px] w-[18px] text-foreground";

// `action` is kept in the prop signature so existing callers don't break,
// but the header no longer renders it — per-page primary actions now live
// in the page body next to filters. Safe to drop from callers over time.
export function Header({ title, subtitle }: HeaderProps) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const { isAdmin, isSuperAdmin } = useAuth();
  const { hasFeature, isThiqaSuperAdmin } = useAgentContext();
  const { openWizard } = usePolicyWizardController();
  const { recentClient } = useRecentClient();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isOnClientProfilePage = /^\/clients\/[^/]+/.test(location.pathname);

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

  useEffect(() => {
    if (searchExpanded) {
      const t = window.setTimeout(() => searchInputRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
  }, [searchExpanded]);

  const openNewPolicy = () => {
    openWizard({
      clientId: isOnClientProfilePage ? recentClient?.id : undefined,
    });
  };

  const collapseSearch = () => {
    setSearchExpanded(false);
    setSearchQuery("");
  };

  return (
    <>
      {/* Desktop header */}
      <header className="hidden md:flex sticky top-0 z-30 h-20 items-center gap-4 bg-white/75 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/60 border-b border-border/50 px-6 mb-6 shadow-[0_1px_0_0_hsl(var(--border)/0.3)]">
        {/* Right: title + subtitle */}
        <div className="min-w-0 flex-shrink-0">
          <h1 className="text-xl font-semibold text-foreground truncate">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>

        {/* Center: sibling tabs (from active nav group) */}
        <nav className="flex-1 flex items-center justify-center min-w-0 overflow-x-auto scrollbar-none">
          <div className="flex items-center gap-2">
            {siblingTabs.map((tab) => {
              const active = isTabActive(tab.href);
              return (
                <button
                  key={tab.href}
                  type="button"
                  onClick={() => navigate(tab.href)}
                  className={cn(
                    "h-11 px-5 rounded-full text-[15px] font-medium whitespace-nowrap transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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

        {/* Left: search, new-policy button, bell */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {searchExpanded ? (
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground pointer-events-none" />
              <Input
                ref={searchInputRef}
                placeholder="بحث..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={() => {
                  if (!searchQuery) collapseSearch();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") collapseSearch();
                }}
                className="h-11 w-[220px] rounded-full pr-9 pl-9 bg-secondary/70 border-transparent focus-visible:bg-background"
              />
              <button
                type="button"
                onClick={collapseSearch}
                className="absolute left-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-background"
                aria-label="إغلاق البحث"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className={ICON_BUTTON_CLASS}
              onClick={() => setSearchExpanded(true)}
              aria-label="بحث"
            >
              <Search className={ICON_CLASS} />
            </Button>
          )}

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
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-foreground truncate">{title}</h1>
            {subtitle && (
              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full bg-secondary/70 hover:bg-secondary text-foreground"
              onClick={() => setSearchExpanded(true)}
              aria-label="بحث"
            >
              <Search className="h-4 w-4 text-foreground" />
            </Button>
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
