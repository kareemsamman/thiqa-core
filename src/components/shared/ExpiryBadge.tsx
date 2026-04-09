import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, Clock, CheckCircle, XCircle } from "lucide-react";

interface ExpiryBadgeProps {
  endDate: string;
  cancelled?: boolean | null;
  showDays?: boolean;
  className?: string;
}

export function ExpiryBadge({ endDate, cancelled, showDays = true, className }: ExpiryBadgeProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  
  const diffTime = end.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (cancelled) {
    return (
      <Badge variant="secondary" className={cn("gap-1", className)}>
        <XCircle className="h-3 w-3" />
        ملغاة
      </Badge>
    );
  }

  if (diffDays < 0) {
    return (
      <Badge variant="destructive" className={cn("gap-1", className)}>
        <XCircle className="h-3 w-3" />
        منتهية {showDays && `(${Math.abs(diffDays)} يوم)`}
      </Badge>
    );
  }

  if (diffDays <= 7) {
    return (
      <Badge className={cn("gap-1 bg-red-500 hover:bg-red-600", className)}>
        <AlertTriangle className="h-3 w-3" />
        {showDays ? `${diffDays} يوم` : "تنتهي قريباً"}
      </Badge>
    );
  }

  if (diffDays <= 30) {
    return (
      <Badge className={cn("gap-1 bg-amber-500 hover:bg-amber-600", className)}>
        <Clock className="h-3 w-3" />
        {showDays ? `${diffDays} يوم` : "تنتهي قريباً"}
      </Badge>
    );
  }

  return (
    <Badge variant="success" className={cn("gap-1", className)}>
      <CheckCircle className="h-3 w-3" />
      {showDays ? `${diffDays} يوم` : "نشطة"}
    </Badge>
  );
}
