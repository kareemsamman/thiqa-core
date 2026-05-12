import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";

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
  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-sm [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {title || "جاري إعداد السند"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <Progress value={value} className="h-2" />
          <p className="text-xs text-muted-foreground text-center ltr-nums">
            {value < 100
              ? "قد تستغرق العملية بضع ثوانٍ، يرجى الانتظار..."
              : "تم — جاري فتح السند"}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
