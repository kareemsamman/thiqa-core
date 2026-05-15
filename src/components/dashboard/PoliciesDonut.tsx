import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { PeriodRange } from "./PeriodPills";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";

const COLORS = {
  active: "hsl(142 76% 36%)",
  expiring: "hsl(38 92% 50%)",
  expired: "hsl(0 84% 60%)",
  cancelled: "hsl(220 9% 65%)",
};

export function PoliciesDonut({
  range,
  branchId,
}: {
  range: PeriodRange;
  branchId?: string | null;
}) {
  const { data, isLoading } = useDashboardSummary(range, branchId);
  const overview = data.policies_overview;

  const chartData = [
    { name: "سارية", value: overview.active_count, color: COLORS.active },
    { name: "تنتهي قريباً", value: overview.expiring_30d_count, color: COLORS.expiring },
    { name: "منتهية", value: overview.expired_count, color: COLORS.expired },
    { name: "ملغاة", value: overview.cancelled_count, color: COLORS.cancelled },
  ].filter((d) => d.value > 0);

  const total = chartData.reduce((s, d) => s + d.value, 0);

  return (
    <Card className="rounded-2xl border shadow-sm h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">نظرة عامة على المعاملات</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <div className="flex-1 min-h-[200px] relative">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Skeleton className="h-32 w-32 rounded-full" />
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    // When everything is zero we still render a single
                    // "ghost" segment so the card visually reads as a
                    // chart and not a blank slate. The center overlay
                    // takes over and shows the "لا توجد بيانات" copy.
                    data={total === 0 ? [{ name: "", value: 1, color: "hsl(var(--muted))" }] : chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={total === 0 ? 0 : 2}
                    dataKey="value"
                    isAnimationActive={total !== 0}
                  >
                    {(total === 0 ? [{ name: "", value: 1, color: "hsl(var(--muted))" }] : chartData).map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
                  {total > 0 && (
                    <Tooltip
                      formatter={(v: number, n: string) => [v.toLocaleString("en-US"), n]}
                      contentStyle={{
                        direction: "rtl",
                        textAlign: "right",
                        backgroundColor: "hsl(var(--background))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                  )}
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {total === 0 ? (
                  <p className="text-xs text-muted-foreground">لا توجد بيانات</p>
                ) : (
                  <>
                    <p className="text-2xl font-bold ltr-nums">{total.toLocaleString("en-US")}</p>
                    <p className="text-xs text-muted-foreground">إجمالي</p>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-sm">
          <LegendRow color={COLORS.active} label="سارية" value={overview.active_count} />
          <LegendRow color={COLORS.expiring} label="تنتهي قريباً" value={overview.expiring_30d_count} />
          <LegendRow color={COLORS.expired} label="منتهية" value={overview.expired_count} />
          <LegendRow color={COLORS.cancelled} label="ملغاة" value={overview.cancelled_count} />
        </div>
      </CardContent>
    </Card>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-muted-foreground truncate">{label}</span>
      </div>
      <span className="font-semibold ltr-nums">{value.toLocaleString("en-US")}</span>
    </div>
  );
}
