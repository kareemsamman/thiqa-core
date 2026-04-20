import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// All toast variants share one visual: a solid black circular chip on
// the end (visual-right in RTL) with a white glyph inside. The chip
// shape never changes — only the glyph does — so success / error /
// warning / info read the same at a glance. No tinted backgrounds on
// the card itself; it stays the same liquid-white glass panel every
// time.
const chip = cn(
  "inline-flex h-8 w-8 items-center justify-center rounded-full shrink-0",
  "bg-black text-white shadow-sm",
);

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      dir="rtl"
      expand
      offset={20}
      gap={10}
      closeButton
      icons={{
        success: (
          <div className={chip}>
            <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
          </div>
        ),
        error: (
          <div className={chip}>
            <XCircle className="h-4 w-4" strokeWidth={2.5} />
          </div>
        ),
        warning: (
          <div className={chip}>
            <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />
          </div>
        ),
        info: (
          <div className={chip}>
            <Info className="h-4 w-4" strokeWidth={2.5} />
          </div>
        ),
        loading: (
          <div className={chip}>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
          </div>
        ),
      }}
      toastOptions={{
        // We own the layout. `items-center` keeps the chip on the title's
        // baseline, padding is logical so RTL and LTR get symmetric
        // spacing, and pe-10 reserves the inline-end strip for the
        // absolutely-positioned close button.
        unstyled: true,
        classNames: {
          toast: cn(
            "glass-toast relative flex items-center gap-5",
            "w-[min(400px,calc(100vw-2rem))]",
            "py-3 ps-4 pe-11",
            "rounded-2xl border",
            // Higher opacity and stronger ring/shadow so the toast actually
            // registers against the page — the previous bg-white/75 was
            // too sheer; people in the bottom-right corner of a busy
            // dashboard missed it entirely. bg-white/95 still reads as a
            // glass panel because of the saturate+blur, but it pops.
            "bg-white/95 dark:bg-slate-900/90",
            "backdrop-blur-2xl backdrop-saturate-150",
            "border-black/10 dark:border-white/10",
            "ring-1 ring-black/10 dark:ring-white/10",
            "shadow-[0_24px_70px_-18px_rgba(15,23,42,0.45)] dark:shadow-[0_24px_70px_-18px_rgba(0,0,0,0.85)]",
          ),
          title:
            "flex-1 min-w-0 text-[13.5px] font-semibold text-foreground leading-snug break-words [unicode-bidi:plaintext]",
          description:
            "text-[12px] text-muted-foreground mt-0.5 leading-relaxed break-words [unicode-bidi:plaintext]",
          icon: "shrink-0",
          closeButton: "glass-toast-close",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
