import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Shared icon chip wrapper — gradient-ish bubble on the RTL-visual-right
// side of each toast. Using ring + bg-color/xx so the chip reads as a soft
// "liquid" badge instead of a flat square.
const iconChip = (color: string, ring: string, bg: string) =>
  cn(
    "fancy-toast-icon flex items-center justify-center h-11 w-11 rounded-xl shrink-0",
    "ring-1 shadow-inner backdrop-blur-sm",
    bg,
    ring,
    color,
  );

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-left"
      dir="rtl"
      expand
      offset={20}
      gap={14}
      closeButton
      // Custom icons: large tinted chip on the start side of each toast.
      icons={{
        success: (
          <div className={iconChip("text-emerald-600 dark:text-emerald-300", "ring-emerald-500/30", "bg-emerald-500/15")}>
            <CheckCircle2 className="h-5 w-5" strokeWidth={2.5} />
          </div>
        ),
        error: (
          <div className={iconChip("text-rose-600 dark:text-rose-300", "ring-rose-500/30", "bg-rose-500/15")}>
            <XCircle className="h-5 w-5" strokeWidth={2.5} />
          </div>
        ),
        warning: (
          <div className={iconChip("text-amber-600 dark:text-amber-300", "ring-amber-500/30", "bg-amber-500/15")}>
            <AlertTriangle className="h-5 w-5" strokeWidth={2.5} />
          </div>
        ),
        info: (
          <div className={iconChip("text-sky-600 dark:text-sky-300", "ring-sky-500/30", "bg-sky-500/15")}>
            <Info className="h-5 w-5" strokeWidth={2.5} />
          </div>
        ),
        loading: (
          <div className={iconChip("text-primary", "ring-primary/30", "bg-primary/15")}>
            <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.5} />
          </div>
        ),
      }}
      toastOptions={{
        // `unstyled` lets us own the entire look — Sonner still handles layout
        // of icon / title / description / close button via data attributes.
        unstyled: true,
        classNames: {
          toast: cn(
            "fancy-toast group/toast relative flex items-start gap-3 w-[min(440px,calc(100vw-2rem))] p-4",
            // Liquid glass surface
            "rounded-2xl border",
            "bg-white/75 dark:bg-slate-900/75",
            "backdrop-blur-2xl backdrop-saturate-150",
            "border-white/40 dark:border-white/10",
            "ring-1 ring-black/5 dark:ring-white/10",
            "shadow-[0_24px_70px_-20px_rgba(15,23,42,0.35)] dark:shadow-[0_24px_70px_-20px_rgba(0,0,0,0.8)]",
            // Entrance + hover polish
            "transition-all duration-300",
            "hover:shadow-[0_28px_80px_-20px_rgba(15,23,42,0.45)]",
            "overflow-hidden",
          ),
          title: "text-[14px] font-semibold text-foreground leading-snug flex-1 pl-6",
          description: "text-[12.5px] text-muted-foreground mt-1 leading-relaxed",
          icon: "shrink-0",
          // Close button pinned to the visual left (Arabic convention) with
          // a soft pill background. `!important` is needed because Sonner
          // ships its own absolute positioning.
          closeButton: cn(
            "fancy-toast-close",
            "!absolute !top-2.5 !left-2.5 !right-auto",
            "!h-6 !w-6 !rounded-full",
            "!bg-black/5 dark:!bg-white/10",
            "hover:!bg-black/10 dark:hover:!bg-white/20",
            "!text-foreground/60 hover:!text-foreground",
            "!border-0 !shadow-none",
            "transition-all duration-150",
            "opacity-0 group-hover/toast:opacity-100 focus:opacity-100",
          ),
          // Variant tints (applied on top of the base glass surface)
          success: "!bg-gradient-to-bl !from-emerald-50/95 !via-white/80 !to-white/75 dark:!from-emerald-950/60 dark:!via-slate-900/75 dark:!to-slate-900/75 !border-emerald-500/25",
          error: "!bg-gradient-to-bl !from-rose-50/95 !via-white/80 !to-white/75 dark:!from-rose-950/60 dark:!via-slate-900/75 dark:!to-slate-900/75 !border-rose-500/25",
          warning: "!bg-gradient-to-bl !from-amber-50/95 !via-white/80 !to-white/75 dark:!from-amber-950/60 dark:!via-slate-900/75 dark:!to-slate-900/75 !border-amber-500/25",
          info: "!bg-gradient-to-bl !from-sky-50/95 !via-white/80 !to-white/75 dark:!from-sky-950/60 dark:!via-slate-900/75 dark:!to-slate-900/75 !border-sky-500/25",
          loading: "!bg-gradient-to-bl !from-primary/10 !via-white/80 !to-white/75 dark:!from-primary/20 dark:!via-slate-900/75 dark:!to-slate-900/75 !border-primary/25",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
