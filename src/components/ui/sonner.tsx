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
          // Room on the visual-left for the close button (ps-10) and on the
          // visual-right for the icon chip (pe-14 is handled by flex gap).
          toast: cn(
            "fancy-toast relative flex items-start gap-3 w-[min(440px,calc(100vw-2rem))] p-4 ps-10",
            // Liquid glass surface
            "rounded-2xl border",
            "bg-white/80 dark:bg-slate-900/80",
            "backdrop-blur-2xl backdrop-saturate-150",
            "border-white/40 dark:border-white/10",
            "ring-1 ring-black/5 dark:ring-white/10",
            "shadow-[0_24px_70px_-20px_rgba(15,23,42,0.35)] dark:shadow-[0_24px_70px_-20px_rgba(0,0,0,0.8)]",
            "transition-all duration-300",
            "hover:shadow-[0_28px_80px_-20px_rgba(15,23,42,0.45)]",
            "overflow-hidden",
          ),
          // Title takes the remaining flex space and wraps instead of clipping.
          title: "text-[14px] font-semibold text-foreground leading-snug flex-1 min-w-0 break-words [unicode-bidi:plaintext]",
          description: "text-[12.5px] text-muted-foreground mt-1 leading-relaxed break-words [unicode-bidi:plaintext]",
          icon: "shrink-0",
          // Custom class handles positioning via CSS (inset-inline-start)
          // so it stays on the visual-left in both LTR and RTL. Using
          // inline-logical properties avoids the left/right ambiguity that
          // Sonner's default styles introduce.
          closeButton: "fancy-toast-close",
          // Variant tints (applied on top of the base glass surface)
          success: "!bg-gradient-to-bl !from-emerald-50/95 !via-white/85 !to-white/80 dark:!from-emerald-950/60 dark:!via-slate-900/80 dark:!to-slate-900/80 !border-emerald-500/30",
          error: "!bg-gradient-to-bl !from-rose-50/95 !via-white/85 !to-white/80 dark:!from-rose-950/60 dark:!via-slate-900/80 dark:!to-slate-900/80 !border-rose-500/30",
          warning: "!bg-gradient-to-bl !from-amber-50/95 !via-white/85 !to-white/80 dark:!from-amber-950/60 dark:!via-slate-900/80 dark:!to-slate-900/80 !border-amber-500/30",
          info: "!bg-gradient-to-bl !from-sky-50/95 !via-white/85 !to-white/80 dark:!from-sky-950/60 dark:!via-slate-900/80 dark:!to-slate-900/80 !border-sky-500/30",
          loading: "!bg-gradient-to-bl !from-primary/10 !via-white/85 !to-white/80 dark:!from-primary/20 dark:!via-slate-900/80 dark:!to-slate-900/80 !border-primary/30",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
