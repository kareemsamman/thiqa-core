import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, FileText, X, Maximize2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationsDropdown } from "./NotificationsDropdown";
import { cn } from "@/lib/utils";
import { useRecentClient } from "@/hooks/useRecentClient";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  usePolicyWizardController,
  type WizardInstance,
} from "@/hooks/usePolicyWizardController";
import { BottomToolbarInlineSearch } from "./BottomToolbarInlineSearch";

export function BottomToolbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { recentClient, clearRecentClient } = useRecentClient();
  const {
    instances,
    activeId,
    openWizard,
    restoreInstance,
    closeInstance,
    consumeDockOrigin,
  } = usePolicyWizardController();

  const isMobile = useIsMobile();

  // Everything except the active instance is "minimized" from the user's
  // perspective — these become tabs in the toolbar that can be restored
  // or closed individually. Above a threshold the trailing chips collapse
  // into a "+N" overflow popover so the toolbar never wraps or blows out
  // its width — 1 inline on mobile, 3 inline on desktop.
  const minimizedInstances = instances.filter((i) => i.id !== activeId);
  const inlineLimit = isMobile ? 1 : 3;
  const inlineChips = minimizedInstances.slice(0, inlineLimit);
  const overflowChips = minimizedInstances.slice(inlineLimit);
  const lastMinimizedId = minimizedInstances[minimizedInstances.length - 1]?.id ?? null;

  const [isHovered, setIsHovered] = useState(false);
  const [isOverContent, setIsOverContent] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const draftChipRef = useRef<HTMLButtonElement>(null);

  // FLIP animation: when a new minimized chip appears, capture the click
  // origin (from the dialog's minimize button) and animate the newest chip
  // from that exact point to its final position in the toolbar. Only the
  // most recently minimized instance consumes the dock origin.
  useLayoutEffect(() => {
    if (!lastMinimizedId) return;
    const chip = draftChipRef.current;
    if (!chip) return;
    const origin = consumeDockOrigin();

    let startTransform = "translate(0, 0) scale(0.9)";
    let startOpacity = "0";
    let duration = 280;
    let easing = "cubic-bezier(0.34, 1.56, 0.64, 1)";

    if (origin) {
      const rect = chip.getBoundingClientRect();
      const targetX = rect.left + rect.width / 2;
      const targetY = rect.top + rect.height / 2;
      const dx = origin.x - targetX;
      const dy = origin.y - targetY;
      startTransform = `translate(${dx}px, ${dy}px) scale(0.35)`;
      startOpacity = "0.6";
      duration = 620;
    }

    chip.style.transition = "none";
    chip.style.transformOrigin = "center";
    chip.style.transform = startTransform;
    chip.style.opacity = startOpacity;

    // Force reflow so the browser commits the starting state before we
    // switch to the target transform. Without this, the transition is
    // skipped entirely.
    void chip.offsetWidth;

    chip.style.transition = `transform ${duration}ms ${easing}, opacity ${Math.min(duration, 300)}ms ease-out`;
    chip.style.transform = "translate(0, 0) scale(1)";
    chip.style.opacity = "1";

    const clearInline = () => {
      chip.style.transition = "";
      chip.style.transform = "";
      chip.style.opacity = "";
      chip.style.transformOrigin = "";
      chip.removeEventListener("transitionend", clearInline);
    };
    chip.addEventListener("transitionend", clearInline);
    return () => {
      chip.removeEventListener("transitionend", clearInline);
    };
  }, [lastMinimizedId, consumeDockOrigin]);

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
      {/* Sticky bottom toolbar with glassy style */}
      <div 
        ref={toolbarRef}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50"
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

          {/* Minimized wizard tab strip — one chip per minimized instance,
              each with its own restore + close buttons. Past the inline
              limit (1 on mobile, 3 on desktop) the trailing chips collapse
              into a "+N" popover that opens upward from the toolbar. */}
          {minimizedInstances.length > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                {inlineChips.map((instance) => (
                  <MinimizedChip
                    key={instance.id}
                    instance={instance}
                    isLast={instance.id === lastMinimizedId}
                    chipRef={instance.id === lastMinimizedId ? draftChipRef : undefined}
                    onRestore={restoreInstance}
                    onClose={closeInstance}
                  />
                ))}

                {overflowChips.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        title={`${overflowChips.length} مسودات أخرى`}
                        aria-label="المزيد من المسودات"
                        className={cn(
                          "flex items-center gap-1 h-9 px-3 rounded-full",
                          "bg-primary text-primary-foreground shadow-md shadow-primary/20",
                          "hover:shadow-lg hover:shadow-primary/30 transition-shadow",
                        )}
                      >
                        <Layers className="h-3.5 w-3.5" />
                        <span className="text-xs font-semibold ltr-nums">
                          +{overflowChips.length}
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="end"
                      sideOffset={12}
                      className="w-72 p-2 flex flex-col gap-1.5"
                      dir="rtl"
                    >
                      <p className="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-muted-foreground">
                        المسودات الأخرى
                      </p>
                      {overflowChips.map((instance) => (
                        <MinimizedChip
                          key={instance.id}
                          instance={instance}
                          variant="stacked"
                          onRestore={restoreInstance}
                          onClose={closeInstance}
                        />
                      ))}
                    </PopoverContent>
                  </Popover>
                )}
              </div>
              <div className="h-6 w-px bg-border/50" />
            </>
          )}

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
            <span className="hidden sm:inline">وثيقة جديدة</span>
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

// Minimized wizard chip. Renders in two layouts:
//   variant="inline"  (default) — horizontal pill for the toolbar tab strip.
//   variant="stacked"           — full-width row used inside the overflow
//                                 popover where vertical stacking is fine.
function MinimizedChip({
  instance,
  isLast = false,
  chipRef,
  variant = "inline",
  onRestore,
  onClose,
}: {
  instance: WizardInstance;
  isLast?: boolean;
  chipRef?: React.RefObject<HTMLButtonElement>;
  variant?: "inline" | "stacked";
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const summary = instance.draftSummary;
  const title = summary
    ? `استئناف: ${summary.clientName || "وثيقة جديدة"} — ${summary.stepTitle}`
    : "استئناف وثيقة جديدة";

  if (variant === "stacked") {
    return (
      <div
        className={cn(
          "group relative flex items-center rounded-xl overflow-hidden",
          "bg-primary text-primary-foreground",
          "hover:brightness-110 transition",
        )}
      >
        <button
          type="button"
          onClick={() => onRestore(instance.id)}
          title={title}
          className="relative flex flex-1 min-w-0 items-center gap-2 h-11 pr-3 pl-2 text-right"
        >
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
            <FileText className="h-4 w-4" />
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-primary animate-pulse" />
          </span>
          <span className="flex flex-col items-start min-w-0 leading-tight flex-1">
            <span className="text-xs font-semibold truncate w-full">
              {summary?.clientName || "مسودة وثيقة"}
            </span>
            <span className="text-[10px] opacity-70 truncate w-full">
              {summary
                ? `${summary.stepNumber}/${summary.totalSteps} · ${summary.stepTitle}`
                : "اضغط للاستئناف"}
            </span>
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
            <Maximize2 className="h-3.5 w-3.5" />
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose(instance.id);
          }}
          title="إغلاق هذه المسودة"
          aria-label="إغلاق هذه المسودة"
          className="flex h-11 w-9 items-center justify-center border-r border-primary-foreground/20 hover:bg-primary-foreground/15"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex items-center rounded-full overflow-hidden",
        "bg-primary text-primary-foreground shadow-md shadow-primary/20",
        "hover:shadow-lg hover:shadow-primary/30",
      )}
    >
      <button
        ref={isLast ? chipRef : undefined}
        type="button"
        onClick={() => onRestore(instance.id)}
        title={title}
        className="relative flex items-center gap-2 h-9 pr-2 pl-2 max-w-[240px]"
      >
        {/* Shimmer sweep on hover */}
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent group-hover:translate-x-full transition-transform duration-700 ease-out" />

        <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
          <FileText className="h-3.5 w-3.5" />
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-primary animate-pulse" />
        </span>

        <span className="hidden sm:flex flex-col items-start min-w-0 leading-tight">
          <span className="text-[10px] font-semibold opacity-80 truncate max-w-[140px]">
            {summary?.clientName || "مسودة وثيقة"}
          </span>
          <span className="text-[9px] opacity-70 truncate max-w-[140px]">
            {summary
              ? `${summary.stepNumber}/${summary.totalSteps} · ${summary.stepTitle}`
              : "اضغط للاستئناف"}
          </span>
        </span>

        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15 group-hover:bg-primary-foreground/25 group-hover:rotate-12 transition-all duration-300">
          <Maximize2 className="h-3 w-3" />
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose(instance.id);
        }}
        title="إغلاق هذه المسودة"
        aria-label="إغلاق هذه المسودة"
        className="flex h-9 w-7 items-center justify-center border-r border-primary-foreground/20 hover:bg-primary-foreground/15"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
