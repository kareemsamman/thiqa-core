import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle, Wallet } from "lucide-react";

interface DebtIndicatorProps {
  totalOwed: number;
  totalPaid: number;
  className?: string;
  showAmount?: boolean;
}

export function DebtIndicator({ totalOwed, totalPaid, className, showAmount = true }: DebtIndicatorProps) {
  const remaining = totalOwed - totalPaid;
  const paidPercentage = totalOwed > 0 ? (totalPaid / totalOwed) * 100 : 100;

  if (remaining <= 0) {
    return (
      <Badge variant="success" className={cn("gap-1", className)}>
        <CheckCircle className="h-3 w-3" />
        مسدد
      </Badge>
    );
  }

  if (paidPercentage >= 75) {
    return (
      <Badge className={cn("gap-1 bg-amber-500 hover:bg-amber-600", className)}>
        <Wallet className="h-3 w-3" />
        {showAmount ? `₪${remaining.toLocaleString()}` : "جزئي"}
      </Badge>
    );
  }

  if (paidPercentage >= 25) {
    return (
      <Badge className={cn("gap-1 bg-orange-500 hover:bg-orange-600", className)}>
        <AlertCircle className="h-3 w-3" />
        {showAmount ? `₪${remaining.toLocaleString()}` : "متبقي"}
      </Badge>
    );
  }

  return (
    <Badge variant="destructive" className={cn("gap-1", className)}>
      <AlertCircle className="h-3 w-3" />
      {showAmount ? `₪${remaining.toLocaleString()}` : "غير مسدد"}
    </Badge>
  );
}
