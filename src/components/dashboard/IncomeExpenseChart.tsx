import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { SeeAllButton } from "./SeeAllButton";
import { PeriodRange, DashboardPeriod } from "./PeriodPills";

interface Row {
  month: string;
  income: number;
  expense: number;
}

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
}: {
  range: PeriodRange;
  period: DashboardPeriod;
}) {
  const navigate = useNavigate();
  const { hasFeature } = useAgentContext();
  const { showUpgradePrompt } = useUpgradePrompt();
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ income: 0, expense: 0 });
  const [loading, setLoading] = useState(true);

  // Monthly trend (always 6 months — it's a trend chart)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase.rpc as any)("dashboard_income_expense_monthly", {
          p_months: 6,
        });
        if (error) throw error;
        if (cancelled) return;
        setRows(
          (data ?? []).map((r: any) => ({
            month: r.month,
            income: Number(r.income ?? 0),
            expense: Number(r.expense ?? 0),
          }))
        );
      } catch (e) {
        console.error("Error loading income/expense monthly:", e);
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Period-scoped totals (track the period pill)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase.rpc as any)("dashboard_income_expense_totals", {
          p_start_date: range.start,
          p_end_date: range.end,
        });
        if (error) throw error;
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        setTotals({
          income: Number(row?.income ?? 0),
          expense: Number(row?.expense ?? 0),
        });
      } catch (e) {
        console.error("Error loading income/expense totals:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [range.start, range.end]);

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
    <Card className="rounded-2xl border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-semibold">الإيرادات مقابل المصروفات</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            الأرقام تعكس {PERIOD_LABEL[period]} · الرسم يعرض آخر 6 أشهر
          </p>
        </div>
        <SeeAllButton locked={!canAccounting} onClick={handleSeeAll} />
      </CardHeader>
      <CardContent>
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
        <div className="h-[220px]">
          {loading ? (
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
