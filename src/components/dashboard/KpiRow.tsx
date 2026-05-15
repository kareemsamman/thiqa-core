import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Car, FileText, TrendingUp, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PeriodRange } from "./PeriodPills";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";

interface KpiTileProps {
  title: string;
  value: string;
  icon: LucideIcon;
  tone: "primary" | "blue" | "amber" | "success";
  loading?: boolean;
}

const TONE: Record<KpiTileProps["tone"], { card: string; iconBox: string; iconColor: string }> = {
  primary: {
    card: "bg-primary/5 border-primary/15",
    iconBox: "bg-primary/10",
    iconColor: "text-primary",
  },
  blue: {
    card: "bg-blue-500/5 border-blue-500/15",
    iconBox: "bg-blue-500/10",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  amber: {
    card: "bg-amber-500/5 border-amber-500/15",
    iconBox: "bg-amber-500/10",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  success: {
    card: "bg-success/5 border-success/15",
    iconBox: "bg-success/10",
    iconColor: "text-success",
  },
};

function KpiTile({ title, value, icon: Icon, tone, loading }: KpiTileProps) {
  const t = TONE[tone];
  return (
    <Card className={cn("p-5 rounded-2xl border shadow-sm hover:shadow-md transition-all", t.card)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 min-w-0">
          <p className="text-sm font-medium text-muted-foreground truncate">{title}</p>
          {loading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <p className="text-2xl font-bold text-foreground ltr-nums">{value}</p>
          )}
        </div>
        <div className={cn("rounded-xl p-3 shrink-0", t.iconBox)}>
          <Icon className={cn("h-5 w-5", t.iconColor)} />
        </div>
      </div>
    </Card>
  );
}

export function KpiRow({
  range,
  branchId,
  canViewFinancial,
}: {
  range: PeriodRange;
  /** Optional branch filter from the page-level AgentBranchFilter
   *  (global admins only). null = no extra filter — caller's natural
   *  scope still applies. */
  branchId?: string | null;
  canViewFinancial: boolean;
}) {
  const { data, isLoading } = useDashboardSummary(range, branchId);
  const kpis = data.kpis;

  return (
    <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
      <KpiTile
        title="عملاء جدد"
        value={kpis.total_clients.toLocaleString("en-US")}
        icon={Users}
        tone="primary"
        loading={isLoading}
      />
      <KpiTile
        title="سيارات جديدة"
        value={kpis.cars_insured.toLocaleString("en-US")}
        icon={Car}
        tone="blue"
        loading={isLoading}
      />
      <KpiTile
        title="معاملات"
        value={kpis.policies_count.toLocaleString("en-US")}
        icon={FileText}
        tone="amber"
        loading={isLoading}
      />
      {canViewFinancial && (
        <KpiTile
          title="صافي الأرباح"
          value={`₪${Math.round(kpis.period_profit).toLocaleString("en-US")}`}
          icon={TrendingUp}
          tone="success"
          loading={isLoading}
        />
      )}
    </div>
  );
}
