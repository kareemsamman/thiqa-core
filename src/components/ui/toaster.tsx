import { CheckCircle2, XCircle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// Same black circular chip used by the Sonner toaster so the two
// systems look identical from the user's side. destructive variant
// gets an X glyph, everything else gets the info/check glyph — the
// chip itself is always solid black with a white icon inside.
const CHIP_CLASS = cn(
  "inline-flex h-8 w-8 items-center justify-center rounded-full shrink-0",
  "bg-black text-white shadow-sm",
);

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const Icon = variant === "destructive" ? XCircle : title ? CheckCircle2 : Info;
        return (
          <Toast key={id} variant={variant} {...props}>
            <div className={CHIP_CLASS}>
              <Icon className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
