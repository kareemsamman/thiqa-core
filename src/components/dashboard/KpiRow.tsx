import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Car, FileText, TrendingUp, LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PeriodRange } from "./PeriodPills";

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

interface Kpis {
  total_clients: number;
  cars_insured: number;
  policies_count: number;
  period_profit: number;
}

export function KpiRow({
  range,
  canViewFinancial,
}: {
  range: PeriodRange;
  canViewFinancial: boolean;
}) {
  const [data, setData] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data: rows, error } = await (supabase.rpc as any)("dashboard_kpis_v2", {
          p_start_date: range.start,
          p_end_date: range.end,
        });
        if (error) throw error;
        if (cancelled) return;
        const row = Array.isArray(rows) ? rows[0] : rows;
        setData({
          total_clients: Number(row?.total_clients ?? 0),
          cars_insured: Number(row?.cars_insured ?? 0),
          policies_count: Number(row?.policies_count ?? 0),
          period_profit: Number(row?.period_profit ?? 0),
        });
      } catch (e) {
        console.error("Error loading KPIs:", e);
        if (!cancelled) setData({ total_clients: 0, cars_insured: 0, policies_count: 0, period_profit: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range.start, range.end]);

  return (
    <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
      <KpiTile
        title="عملاء جدد"
        value={(data?.total_clients ?? 0).toLocaleString("en-US")}
        icon={Users}
        tone="primary"
        loading={loading}
      />
      <KpiTile
        title="سيارات جديدة"
        value={(data?.cars_insured ?? 0).toLocaleString("en-US")}
        icon={Car}
        tone="blue"
        loading={loading}
      />
      <KpiTile
        title="معاملات"
        value={(data?.policies_count ?? 0).toLocaleString("en-US")}
        icon={FileText}
        tone="amber"
        loading={loading}
      />
      {canViewFinancial && (
        <KpiTile
          title="صافي الأرباح"
          value={`₪${Math.round(data?.period_profit ?? 0).toLocaleString("en-US")}`}
          icon={TrendingUp}
          tone="success"
          loading={loading}
        />
      )}
    </div>
  );
}
