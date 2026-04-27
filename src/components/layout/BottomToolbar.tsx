import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, FileText, X, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationsDropdown } from "./NotificationsDropdown";
import { cn } from "@/lib/utils";
import { useRecentClient } from "@/hooks/useRecentClient";
import { usePolicyWizardController } from "@/hooks/usePolicyWizardController";
import { useAgentLimits } from "@/hooks/useAgentLimits";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { BottomToolbarInlineSearch } from "./BottomToolbarInlineSearch";
import { HeaderDraftsButton } from "./HeaderDraftsButton";
import { useIsMobile } from "@/hooks/use-mobile";

export function BottomToolbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { recentClient, clearRecentClient } = useRecentClient();
  const { openWizard } = usePolicyWizardController();
  const { policies: policiesLimit, loading: limitsLoading } = useAgentLimits();
  const { showUpgradePrompt } = useUpgradePrompt();
  // Mobile owns the drafts button here; desktop owns it inside the
  // header cluster. Gating with the JS check (not just `md:hidden`
  // CSS) keeps both copies from mounting at once and racing the
  // minimize→dock flight animation in HeaderDraftsButton.
  const isMobile = useIsMobile();
  // Only commit to the locked variant once limits have loaded — otherwise
  // we flash the amber lock on agents who are perfectly within quota.
  // During hydration the unlocked variant renders with disabled=true so
  // the flash can't be clicked through.
  const policiesLocked = !limitsLoading && policiesLimit.exceeded;

  const [isHovered, setIsHovered] = useState(false);
  const [isOverContent, setIsOverContent] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Detect if toolbar is overlapping content
  useEffect(() => {
    const checkOverlap = () => {
      if (!toolbarRef.current) return;
      
      const rect = toolbarRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const checkY = rect.top - 10; // Check just above the toolbar
      
      // Temporarily hide toolbar to check what's underneath
      toolbarRef.current.style.visibility = 'hidden';
      const elementBelow = document.elementFromPoint(centerX, checkY);
      toolbarRef.current.style.visibility = '';
      
      // Check if there's meaningful content (not just body/main/html)
      if (elementBelow) {
        const tagName = elementBelow.tagName.toLowerCase();
        const isContent = !['body', 'html', 'main'].includes(tagName);
        setIsOverContent(isContent);
      } else {
        setIsOverContent(false);
      }
    };

    checkOverlap();
    window.addEventListener('scroll', checkOverlap, { passive: true });
    window.addEventListener('resize', checkOverlap);
    
    // Re-check after content changes
    const observer = new MutationObserver(checkOverlap);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener('scroll', checkOverlap);
      window.removeEventListener('resize', checkOverlap);
      observer.disconnect();
    };
  }, [location.pathname]);

  // Check if user is on a client profile page (viewing client details)
  // The ClientDetails component sets recentClient when viewing a client
  // URL params are cleared after opening, so we check if we're on /clients with a recentClient set
  const isOnClientProfilePage = (location.pathname === "/clients" || location.pathname.startsWith("/clients/")) && !!recentClient;

  const showRecentClient =
    !!recentClient && location.pathname !== "/clients" && location.pathname !== "/login" && location.pathname !== "/no-access";

  // Calculate opacity: transparent when over content and not hovered
  const shouldFade = isOverContent && !isHovered;

  return (
    <>
      {/* Sticky bottom toolbar — mobile-only. On desktop everything
          this toolbar holds (new-policy button, search, notifications)
          already lives in the unified header, so we hide it at md+ to
          avoid the duplicate. */}
      <div
        ref={toolbarRef}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 md:hidden"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-full border border-border bg-muted/95 backdrop-blur-xl shadow-lg shadow-foreground/5 ring-1 ring-foreground/5",
            "transition-opacity duration-300",
            shouldFade ? "opacity-30 hover:opacity-100" : "opacity-100"
          )}
        >
          {/* Recent client quick access (appears after you open a client profile then go to another page) */}
          {showRecentClient && (
            <div className="flex items-center gap-1">
              <button
                className={cn(
                  "flex items-center gap-2 h-9 px-3 rounded-full border border-border/50",
                  "bg-secondary/40 hover:bg-secondary/60 transition-colors"
                )}
                onClick={() => navigate(`/clients/${recentClient.id}`)}
                title={`العودة لملف ${recentClient.name}`}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary font-bold text-xs">
                  {recentClient.initial}
                </div>
                <span className="hidden sm:inline text-sm font-medium max-w-28 truncate">
                  {recentClient.name}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full h-9 w-9"
                onClick={clearRecentClient}
                aria-label="إخفاء ملف العميل"
                title="إخفاء"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </Button>
              <div className="h-6 w-px bg-border/50" />
            </div>
          )}

          {/* Minimized drafts moved to the top header — see
              HeaderDraftsButton. The bottom toolbar stops owning drafts;
              it just keeps the new-policy/search/notifications trio. */}

          {/* Create Insurance Button — pre-flight gates on policy quota.
              When the agent is over the cap the button flips to an amber
              locked variant that opens the upgrade popup instead of
              launching the wizard. */}
          {policiesLocked ? (
            <Button
              onClick={() =>
                showUpgradePrompt({
                  resource: "policies",
                  current: policiesLimit.used,
                  limit: policiesLimit.effective ?? 0,
                })
              }
              variant="outline"
              size="sm"
              className="rounded-full gap-2 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
              title="تجاوزت حد المعاملات — اضغط للترقية"
            >
              <Lock className="h-4 w-4" />
              <span>معاملة جديدة</span>
            </Button>
          ) : (
            <Button
              onClick={() => {
                if (limitsLoading) return;
                openWizard({
                  clientId: isOnClientProfilePage ? recentClient?.id : undefined,
                });
              }}
              disabled={limitsLoading}
              className="rounded-full gap-2"
              size="sm"
            >
              <Plus className="h-4 w-4" />
              <span>معاملة جديدة</span>
            </Button>
          )}

          {/* Minimized policy-wizard drafts. Self-hides when zero, so
              the toolbar stays compact until the user actually parks a
              wizard. Mobile-only mount — the desktop header owns the
              same button at md+ widths. */}
          {isMobile && <HeaderDraftsButton className="h-9 w-9 bg-secondary/40" />}

          {/* Separator */}
          <div className="h-6 w-px bg-border/50" />

          {/* Inline search (dropdown above the input) */}
          <BottomToolbarInlineSearch />

          {/* Separator */}
          <div className="h-6 w-px bg-border/50" />

          {/* Notifications */}
          <NotificationsDropdown />
        </div>
      </div>
    </>
  );
}

