import { cn } from "@/lib/utils";

export type DashboardPeriod = "today" | "week" | "month";

export interface PeriodRange {
  start: string; // YYYY-MM-DD
  end: string;
}

export function getPeriodRange(period: DashboardPeriod): PeriodRange {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  if (period === "today") {
    return { start: todayStr, end: todayStr };
  }
  if (period === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { start: start.toISOString().split("T")[0], end: todayStr };
  }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: monthStart.toISOString().split("T")[0],
    end: monthEnd.toISOString().split("T")[0],
  };
}

const LABELS: Record<DashboardPeriod, string> = {
  today: "اليوم",
  week: "هذا الأسبوع",
  month: "هذا الشهر",
};

const ORDER: DashboardPeriod[] = ["today", "week", "month"];

export function PeriodPills({
  value,
  onChange,
}: {
  value: DashboardPeriod;
  onChange: (v: DashboardPeriod) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-secondary/60 p-1">
      {ORDER.map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              "h-9 px-4 rounded-full text-sm font-medium transition-all",
              active
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}
