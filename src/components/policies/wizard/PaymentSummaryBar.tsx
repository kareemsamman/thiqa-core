import { Card } from "@/components/ui/card";
import { AlertCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaymentSummaryBarProps {
  totalPrice: number;
  totalPaid: number;
  remaining: number;
  hasError?: boolean;
  errorMessage?: string;
  officeCommission?: number;
}

export function PaymentSummaryBar({ 
  totalPrice, 
  totalPaid, 
  remaining, 
  hasError,
  errorMessage,
  officeCommission = 0,
}: PaymentSummaryBarProps) {
  const isPaid = remaining === 0 && totalPrice > 0;
  const isOverpaid = remaining < 0;
  
  return (
    <Card className={cn(
      "p-4 sticky top-0 z-10",
      hasError || isOverpaid 
        ? "border-destructive bg-destructive/5" 
        : isPaid 
          ? "border-success bg-success/5"
          : "bg-card"
    )}>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <span className="text-xs text-muted-foreground block mb-1">إجمالي المعاملة</span>
          <p className="font-bold text-lg">₪{totalPrice.toLocaleString()}</p>
          {officeCommission > 0 && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              ₪{(totalPrice - officeCommission).toLocaleString()} تأمين + ₪{officeCommission.toLocaleString()} عمولة مكتب
            </p>
          )}
        </div>
        <div>
          <span className="text-xs text-muted-foreground block mb-1">مجموع الدفعات</span>
          <p className={cn(
            "font-bold text-lg",
            isOverpaid ? "text-destructive" : isPaid ? "text-success" : ""
          )}>
            ₪{totalPaid.toLocaleString()}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground block mb-1">المتبقي</span>
          <p className={cn(
            "font-bold text-lg",
            isOverpaid ? "text-destructive" : isPaid ? "text-success" : remaining > 0 ? "text-amber-600" : ""
          )}>
            ₪{remaining.toLocaleString()}
          </p>
        </div>
      </div>
      
      {isPaid && !hasError && (
        <div className="flex items-center justify-center gap-2 mt-3 text-success text-sm">
          <CheckCircle className="h-4 w-4" />
          <span>تم دفع كامل المبلغ</span>
        </div>
      )}
      
      {(hasError || isOverpaid) && errorMessage && (
        <div className="flex items-center justify-center gap-2 mt-3 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{errorMessage}</span>
        </div>
      )}
    </Card>
  );
}
