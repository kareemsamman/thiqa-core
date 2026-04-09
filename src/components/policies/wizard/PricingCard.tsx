import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PricingBreakdown } from "./types";

interface PricingCardProps {
  pricing: PricingBreakdown;
  showAddons?: boolean;
  className?: string;
}

export function PricingCard({ pricing, showAddons = true, className }: PricingCardProps) {
  const hasAddons = pricing.roadServicePrice > 0 || pricing.accidentFeePrice > 0 || pricing.elzamiPrice > 0 || pricing.thirdFullPrice > 0;
  const hasCommission = pricing.officeCommission > 0;
  
  return (
    <Card className={cn(
      "p-4 border-2",
      hasAddons ? "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent" : "bg-muted/30",
      className
    )}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          {hasAddons && <Package className="h-4 w-4 text-primary" />}
          تفاصيل السعر
        </h4>
        {hasAddons && (
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
            باقة
          </Badge>
        )}
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">السعر الأساسي:</span>
          <span className="font-medium ltr-nums">₪{pricing.basePrice.toLocaleString()}</span>
        </div>
        
        {/* ELZAMI shown in red as it's a cost */}
        {showAddons && pricing.elzamiPrice > 0 && (
          <div className="flex justify-between text-red-600">
            <span className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              + إلزامي (تكلفة):
            </span>
            <span className="font-medium ltr-nums">₪{pricing.elzamiPrice.toLocaleString()}</span>
          </div>
        )}

        {/* THIRD_FULL addon when ELZAMI is main policy */}
        {showAddons && pricing.thirdFullPrice > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>+ ثالث/شامل:</span>
            <span className="ltr-nums">₪{pricing.thirdFullPrice.toLocaleString()}</span>
          </div>
        )}
        
        {showAddons && pricing.roadServicePrice > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>+ خدمات الطريق:</span>
            <span className="ltr-nums">₪{pricing.roadServicePrice.toLocaleString()}</span>
          </div>
        )}
        
        {showAddons && pricing.accidentFeePrice > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>+ إعفاء رسوم حادث:</span>
            <span className="ltr-nums">₪{pricing.accidentFeePrice.toLocaleString()}</span>
          </div>
        )}

        {/* Office Commission */}
        {hasCommission && (
          <div className="flex justify-between text-amber-600">
            <span>+ عمولة للمكتب:</span>
            <span className="font-medium ltr-nums">₪{pricing.officeCommission.toLocaleString()}</span>
          </div>
        )}
        
        <div className="flex justify-between pt-2 border-t font-semibold text-lg">
          <span>الإجمالي:</span>
          <span className="text-primary ltr-nums">₪{pricing.totalPrice.toLocaleString()}</span>
        </div>

        {/* Payable (debt) if different from total */}
        {hasCommission && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>المستحق على العميل:</span>
            <span className="ltr-nums">₪{pricing.payablePrice.toLocaleString()}</span>
          </div>
        )}
        
      </div>
    </Card>
  );
}
