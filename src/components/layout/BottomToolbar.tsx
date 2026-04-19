import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationsDropdown } from "./NotificationsDropdown";
import { cn } from "@/lib/utils";
import { useRecentClient } from "@/hooks/useRecentClient";
import { usePolicyWizardController } from "@/hooks/usePolicyWizardController";
import { BottomToolbarInlineSearch } from "./BottomToolbarInlineSearch";

export function BottomToolbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { recentClient, clearRecentClient } = useRecentClient();
  const { openWizard } = usePolicyWizardController();

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

          {/* Create Insurance Button — always opens a fresh wizard instance
              so the user can have several drafts going at once. */}
          <Button
            onClick={() => {
              openWizard({
                clientId: isOnClientProfilePage ? recentClient?.id : undefined,
              });
            }}
            className="rounded-full gap-2"
            size="sm"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">معاملة جديدة</span>
            <FileText className="h-4 w-4 sm:hidden" />
          </Button>

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

