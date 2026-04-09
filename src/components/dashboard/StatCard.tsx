import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  change?: {
    value: number;
    trend: "up" | "down";
  };
  icon: LucideIcon;
  variant?: "default" | "primary" | "success" | "warning";
}

export function StatCard({ title, value, change, icon: Icon, variant = "default" }: StatCardProps) {
  const variants = {
    default: "bg-card border-border",
    primary: "bg-primary/5 border-primary/20",
    success: "bg-success/5 border-success/20",
    warning: "bg-warning/5 border-warning/20",
  };

  const iconVariants = {
    default: "bg-secondary text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
  };

  return (
    <Card className={cn("p-6 transition-all duration-200 hover:shadow-md border", variants[variant])}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          {change && (
            <p className={cn("text-sm font-medium", change.trend === "up" ? "text-success" : "text-destructive")}>
              {change.trend === "up" ? "↑" : "↓"} {Math.abs(change.value)}%
              <span className="mr-1 text-muted-foreground">مقارنة بالشهر الماضي</span>
            </p>
          )}
        </div>
        <div className={cn("rounded-xl p-3", iconVariants[variant])}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </Card>
  );
}
