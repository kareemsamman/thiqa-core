import { useLayoutEffect, useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Layers, X, FileText, Maximize2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  usePolicyWizardController,
  type WizardInstance,
} from "@/hooks/usePolicyWizardController";

interface HeaderDraftsButtonProps {
  className?: string;
}

// Shows a header-cluster button that lists minimized policy-wizard
// drafts. Hidden entirely when there are none. Replaces the draft
// chip strip that used to live in BottomToolbar so drafts are always
// reachable from the top of the screen.
export function HeaderDraftsButton({ className }: HeaderDraftsButtonProps) {
  const {
    instances,
    activeId,
    restoreInstance,
    closeInstance,
    consumeDockOrigin,
  } = usePolicyWizardController();

  // Sort minimized drafts newest-first by their first-minimize timestamp
  // so the latest parked draft always tops the list. Missing timestamps
  // fall back to 0 (legacy/open instances).
  const minimizedInstances = instances
    .filter((i) => i.id !== activeId)
    .slice()
    .sort((a, b) => (b.minimizedAt ?? 0) - (a.minimizedAt ?? 0));
  const newestMinimizedId = minimizedInstances[0]?.id ?? null;
  const lastMinimizedId = newestMinimizedId;

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  // FLIP: when a new draft arrives (lastMinimizedId changes), play the
  // same minimize→dock flight the bottom toolbar had, but aimed at this
  // button's position. If the controller has a dock origin (the
  // minimize click in the wizard dialog captured one), fly from there
  // with a bouncy ease; otherwise do a short pop so the user still gets
  // visual feedback.
  useLayoutEffect(() => {
    if (!lastMinimizedId) return;
    const btn = buttonRef.current;
    if (!btn) return;
    const origin = consumeDockOrigin();

    let startTransform = "translate(0, 0) scale(0.85)";
    let startOpacity = "0.3";
    let duration = 260;
    let easing = "cubic-bezier(0.34, 1.56, 0.64, 1)";

    if (origin) {
      const rect = btn.getBoundingClientRect();
      const targetX = rect.left + rect.width / 2;
      const targetY = rect.top + rect.height / 2;
      const dx = origin.x - targetX;
      const dy = origin.y - targetY;
      startTransform = `translate(${dx}px, ${dy}px) scale(0.35)`;
      startOpacity = "0.5";
      duration = 620;
    }

    btn.style.transition = "none";
    btn.style.transformOrigin = "center";
    btn.style.transform = startTransform;
    btn.style.opacity = startOpacity;
    void btn.offsetWidth; // force reflow so the start frame commits

    btn.style.transition = `transform ${duration}ms ${easing}, opacity ${Math.min(duration, 300)}ms ease-out`;
    btn.style.transform = "translate(0, 0) scale(1)";
    btn.style.opacity = "1";

    const clear = () => {
      btn.style.transition = "";
      btn.style.transform = "";
      btn.style.opacity = "";
      btn.style.transformOrigin = "";
      btn.removeEventListener("transitionend", clear);
    };
    btn.addEventListener("transitionend", clear);
    return () => btn.removeEventListener("transitionend", clear);
  }, [lastMinimizedId, consumeDockOrigin]);

  if (minimizedInstances.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={buttonRef}
          variant="ghost"
          size="icon"
          className={cn(
            "relative h-11 w-11 rounded-full bg-secondary/70 hover:bg-secondary text-foreground",
            "data-[state=open]:bg-background data-[state=open]:text-foreground data-[state=open]:shadow-[0_-2px_8px_rgba(0,0,0,0.06)] data-[state=open]:ring-1 data-[state=open]:ring-border",
            className,
          )}
          aria-label={`${minimizedInstances.length} مسودات`}
          title={`${minimizedInstances.length} مسودات مصغرة`}
        >
          <Layers className="h-[18px] w-[18px]" />
          <Badge
            className="absolute -left-1 -top-1 h-5 min-w-5 rounded-full px-1 text-[10px] flex items-center justify-center border-2 border-background"
            variant="default"
          >
            <span className="ltr-nums">{minimizedInstances.length}</span>
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-64 p-2 flex flex-col gap-1.5"
        dir="rtl"
      >
        <PopoverPrimitive.Arrow
          width={14}
          height={7}
          className="fill-popover drop-shadow-sm"
        />
        <p className="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-muted-foreground">
          المسودات المصغرة
        </p>
        {minimizedInstances.map((instance) => (
          <DraftRow
            key={instance.id}
            instance={instance}
            isNewest={instance.id === newestMinimizedId}
            onRestore={(id) => {
              setOpen(false);
              restoreInstance(id);
            }}
            onClose={closeInstance}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

// Arabic-locale formatter: short date + short time in one pass (e.g.
// "١٩‏/٤‏/٢٠٢٦ ٢:٥٣ م"). Instantiated once at module load — new
// formatters per-render are surprisingly expensive in hot lists.
const DRAFT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("ar", {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatMinimizedAt(ts: number | null): string {
  if (!ts) return "";
  try {
    return DRAFT_TIMESTAMP_FORMATTER.format(new Date(ts));
  } catch {
    return "";
  }
}

function DraftRow({
  instance,
  isNewest,
  onRestore,
  onClose,
}: {
  instance: WizardInstance;
  isNewest: boolean;
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const summary = instance.draftSummary;
  const title = summary
    ? `استئناف: ${summary.clientName || "وثيقة جديدة"} — ${summary.stepTitle}`
    : "استئناف وثيقة جديدة";
  const stamp = formatMinimizedAt(instance.minimizedAt);

  // The newest minimized draft gets a distinct blue gradient so the user
  // can spot "the one I just parked" at a glance. Older drafts fall back
  // to the standard dark primary background.
  const newestBadgeStyle = isNewest
    ? {
        backgroundImage:
          "linear-gradient(rgb(69, 94, 187) 0%, rgb(138, 150, 203) 100%), rgba(255, 255, 255, 0.02)",
      }
    : undefined;

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
        className="relative flex flex-1 min-w-0 items-center gap-2 min-h-11 py-1.5 pr-3 pl-2 text-right"
      >
        <span
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15"
          style={newestBadgeStyle}
        >
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
          {stamp && (
            <span className="text-[9px] opacity-55 truncate w-full">
              {stamp}
            </span>
          )}
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
        className="flex w-9 self-stretch items-center justify-center border-r border-primary-foreground/20 hover:bg-primary-foreground/15"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
