import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { SeeAllButton } from "./SeeAllButton";
import { PeriodRange, DashboardPeriod } from "./PeriodPills";
import { useDashboardSummary, useDashboardMonthly } from "@/hooks/useDashboardSummary";

const INCOME_COLOR = "hsl(210 90% 55%)";
const EXPENSE_COLOR = "hsl(25 95% 55%)";

const PERIOD_LABEL: Record<DashboardPeriod, string> = {
  today: "اليوم",
  week: "هذا الأسبوع",
  month: "هذا الشهر",
};

export function IncomeExpenseChart({
  range,
  period,
  branchId,
}: {
  range: PeriodRange;
  period: DashboardPeriod;
  branchId?: string | null;
}) {
  const navigate = useNavigate();
  const { hasFeature } = useAgentContext();
  const { showUpgradePrompt } = useUpgradePrompt();

  // Period-scoped totals (top-line numbers) come from the shared
  // dashboard-summary cache — same key as KpiRow/Donut/etc., so
  // toggling period fires ONE refetch that updates every widget.
  const { data: summary } = useDashboardSummary(range, branchId);
  const totals = summary.income_expense_totals;

  // Six-month trend (the area graph itself) is independent of the
  // dashboard period — it stays at its own cache key so period
  // toggles don't cause it to refetch unnecessarily.
  const { rows, isLoading: monthlyLoading } = useDashboardMonthly(branchId);

  const canAccounting = hasFeature("accounting");

  const handleSeeAll = () => {
    if (canAccounting) {
      navigate("/accounting");
    } else {
      showUpgradePrompt({
        featureKey: "accounting",
        featureLabel: "المحاسبة",
      });
    }
  };

  return (
    <Card className="rounded-2xl border shadow-sm h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-semibold">الإيرادات مقابل المصروفات</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            الأرقام تعكس {PERIOD_LABEL[period]} · الرسم يعرض آخر 6 أشهر
          </p>
        </div>
        <SeeAllButton locked={!canAccounting} onClick={handleSeeAll} />
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <div className="flex items-center gap-6 text-sm mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: INCOME_COLOR }} />
            <span className="text-muted-foreground">إيرادات:</span>
            <span className="font-semibold ltr-nums">₪{Math.round(totals.income).toLocaleString("en-US")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: EXPENSE_COLOR }} />
            <span className="text-muted-foreground">مصروفات:</span>
            <span className="font-semibold ltr-nums">₪{Math.round(totals.expense).toLocaleString("en-US")}</span>
          </div>
        </div>
        <div className="flex-1 min-h-[220px]">
          {monthlyLoading ? (
            <Skeleton className="h-full w-full rounded-lg" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="inc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={INCOME_COLOR} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={INCOME_COLOR} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={EXPENSE_COLOR} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={EXPENSE_COLOR} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis
                  dataKey="month"
                  tickFormatter={(v: string) => {
                    try {
                      return new Date(v).toLocaleDateString("ar", { month: "short" });
                    } catch { return v; }
                  }}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)}
                  width={40}
                />
                <Tooltip
                  formatter={(v: number, n: string) => [`₪${Math.round(v).toLocaleString("en-US")}`, n === "income" ? "إيرادات" : "مصروفات"]}
                  labelFormatter={(v: string) => {
                    try {
                      return new Date(v).toLocaleDateString("ar", { month: "long", year: "numeric" });
                    } catch { return v; }
                  }}
                  contentStyle={{
                    direction: "rtl",
                    textAlign: "right",
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Area type="monotone" dataKey="income" stroke={INCOME_COLOR} strokeWidth={2} fill="url(#inc)" />
                <Area type="monotone" dataKey="expense" stroke={EXPENSE_COLOR} strokeWidth={2} fill="url(#exp)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
