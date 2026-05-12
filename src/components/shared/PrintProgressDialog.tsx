import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2, Printer, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared print-progress overlay for any flow that generates a receipt
// via an edge function (bulk-receipt / cancellation-voucher / single-
// payment-receipt). Surfaces a fake-progress bar while the function
// uploads to Bunny — the real progress isn't observable, so callers
// just creep `value` toward 90 on a ticker and snap it to 100 when
// the promise resolves.
//
// Used in Receipts.tsx (the global الإيصالات page) AND in
// ClientDetails.tsx's سجل الدفعات so the bookkeeper sees the same
// overlay no matter where the print was triggered.
//
// Non-closable on purpose: ignore outside clicks / Esc so the user
// can't accidentally dismiss the spinner before the new tab opens.

interface PrintProgressDialogProps {
  open: boolean;
  value: number;
  /** Override the title (defaults to "جاري إعداد السند"). For a سند
   *  إلغاء print, pass "جاري إعداد سند الإلغاء" so the spinner
   *  matches what the user actually clicked. */
  title?: string;
}

export function PrintProgressDialog({ open, value, title }: PrintProgressDialogProps) {
  const isDone = value >= 100;
  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md [&>button]:hidden border-0 p-0 overflow-hidden bg-gradient-to-br from-background via-background to-primary/5"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Hidden accessible title for screen readers — visual heading
            lives in the body for layout reasons. */}
        <DialogTitle className="sr-only">
          {title || "جاري إعداد السند"}
        </DialogTitle>

        <div className="flex flex-col items-center px-8 py-8 gap-5">
          {/* Animated icon — a printer in a pulsing primary-tinted
              circle while uploading, swaps to a success checkmark
              when the bar hits 100. The rotating ring around it
              provides the "something is happening" affordance the
              static progress bar alone doesn't. */}
          <div className="relative">
            <div
              className={cn(
                "absolute inset-0 rounded-full",
                isDone
                  ? "bg-success/15"
                  : "bg-primary/10 animate-pulse",
              )}
            />
            {!isDone && (
              <Loader2 className="absolute inset-0 h-20 w-20 text-primary/40 animate-spin" />
            )}
            <div
              className={cn(
                "relative h-20 w-20 rounded-full flex items-center justify-center",
                isDone ? "bg-success/10" : "bg-background shadow-sm",
              )}
            >
              {isDone ? (
                <CheckCircle2 className="h-10 w-10 text-success" />
              ) : (
                <Printer className="h-9 w-9 text-primary" />
              )}
            </div>
          </div>

          <div className="text-center space-y-1">
            <h2 className="text-lg font-bold text-foreground">
              {title || "جاري إعداد السند"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {isDone
                ? "تم — جاري فتح السند في علامة تبويب جديدة"
                : "قد تستغرق العملية بضع ثوانٍ، يرجى الانتظار..."}
            </p>
          </div>

          <div className="w-full space-y-2">
            <Progress
              value={value}
              className={cn(
                "h-2.5 transition-all",
                isDone && "[&>div]:bg-success",
              )}
            />
            <div className="flex items-center justify-between text-[10px] tabular-nums">
              <span className="text-muted-foreground">
                {isDone ? "اكتمل" : "جاري المعالجة"}
              </span>
              <span className={cn(
                "font-bold",
                isDone ? "text-success" : "text-primary",
              )}>
                {Math.round(value)}%
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
