import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Tinted icon chip. `glass-chip` is a CSS handle for the soft radial
// highlight defined in index.css — everything else is Tailwind so the
// variant colors stay inline.
const chip = (bg: string, fg: string, ring: string) =>
  cn(
    "glass-chip inline-flex h-9 w-9 items-center justify-center rounded-xl shrink-0",
    "ring-1 backdrop-blur-sm",
    bg,
    fg,
    ring,
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
      gap={12}
      closeButton
      icons={{
        success: (
          <div className={chip("bg-emerald-500/15", "text-emerald-600 dark:text-emerald-300", "ring-emerald-500/30")}>
            <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={2.5} />
          </div>
        ),
        error: (
          <div className={chip("bg-rose-500/15", "text-rose-600 dark:text-rose-300", "ring-rose-500/30")}>
            <XCircle className="h-[18px] w-[18px]" strokeWidth={2.5} />
          </div>
        ),
        warning: (
          <div className={chip("bg-amber-500/15", "text-amber-600 dark:text-amber-300", "ring-amber-500/30")}>
            <AlertTriangle className="h-[18px] w-[18px]" strokeWidth={2.5} />
          </div>
        ),
        info: (
          <div className={chip("bg-sky-500/15", "text-sky-600 dark:text-sky-300", "ring-sky-500/30")}>
            <Info className="h-[18px] w-[18px]" strokeWidth={2.5} />
          </div>
        ),
        loading: (
          <div className={chip("bg-primary/15", "text-primary", "ring-primary/30")}>
            <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2.5} />
          </div>
        ),
      }}
      toastOptions={{
        // We own the layout. `items-center` keeps the chip on the title's
        // baseline instead of floating above it, and padding is logical so
        // RTL and LTR get symmetric spacing. `pe-14` reserves the inline-
        // end strip for the absolutely-positioned close button.
        unstyled: true,
        classNames: {
          toast: cn(
            "glass-toast relative flex items-center gap-3.5",
            "w-[min(460px,calc(100vw-2rem))]",
            "py-3.5 ps-4 pe-14",
            "rounded-2xl border",
            "bg-white/85 dark:bg-slate-900/85",
            "backdrop-blur-2xl backdrop-saturate-150",
            "border-white/40 dark:border-white/10",
            "ring-1 ring-black/5 dark:ring-white/10",
            "shadow-[0_24px_70px_-20px_rgba(15,23,42,0.35)] dark:shadow-[0_24px_70px_-20px_rgba(0,0,0,0.8)]",
            "transition-shadow duration-300",
            "hover:shadow-[0_28px_80px_-20px_rgba(15,23,42,0.45)]",
          ),
          title:
            "flex-1 min-w-0 text-[14px] font-semibold text-foreground leading-snug break-words [unicode-bidi:plaintext]",
          description:
            "text-[12.5px] text-muted-foreground mt-1 leading-relaxed break-words [unicode-bidi:plaintext]",
          icon: "shrink-0",
          closeButton: "glass-toast-close",
          success:
            "!bg-gradient-to-bl !from-emerald-50/95 !via-white/85 !to-white/80 dark:!from-emerald-950/60 dark:!via-slate-900/85 dark:!to-slate-900/85 !border-emerald-500/30",
          error:
            "!bg-gradient-to-bl !from-rose-50/95 !via-white/85 !to-white/80 dark:!from-rose-950/60 dark:!via-slate-900/85 dark:!to-slate-900/85 !border-rose-500/30",
          warning:
            "!bg-gradient-to-bl !from-amber-50/95 !via-white/85 !to-white/80 dark:!from-amber-950/60 dark:!via-slate-900/85 dark:!to-slate-900/85 !border-amber-500/30",
          info:
            "!bg-gradient-to-bl !from-sky-50/95 !via-white/85 !to-white/80 dark:!from-sky-950/60 dark:!via-slate-900/85 dark:!to-slate-900/85 !border-sky-500/30",
          loading:
            "!bg-gradient-to-bl !from-primary/10 !via-white/85 !to-white/80 dark:!from-primary/20 dark:!via-slate-900/85 dark:!to-slate-900/85 !border-primary/30",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
