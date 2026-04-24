import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { supabase } from "@/integrations/supabase/client";

interface Overview {
  active_count: number;
  expiring_30d_count: number;
  expired_count: number;
  cancelled_count: number;
}

const COLORS = {
  active: "hsl(142 76% 36%)",
  expiring: "hsl(38 92% 50%)",
  expired: "hsl(0 84% 60%)",
  cancelled: "hsl(220 9% 65%)",
};

export function PoliciesDonut() {
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: rows, error } = await (supabase.rpc as any)("dashboard_policies_overview");
        if (error) throw error;
        if (cancelled) return;
        const row = Array.isArray(rows) ? rows[0] : rows;
        setData({
          active_count: Number(row?.active_count ?? 0),
          expiring_30d_count: Number(row?.expiring_30d_count ?? 0),
          expired_count: Number(row?.expired_count ?? 0),
          cancelled_count: Number(row?.cancelled_count ?? 0),
        });
      } catch (e) {
        console.error("Error loading policies overview:", e);
        if (!cancelled) setData({ active_count: 0, expiring_30d_count: 0, expired_count: 0, cancelled_count: 0 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const chartData = [
    { name: "سارية", value: data?.active_count ?? 0, color: COLORS.active },
    { name: "تنتهي قريباً", value: data?.expiring_30d_count ?? 0, color: COLORS.expiring },
    { name: "منتهية", value: data?.expired_count ?? 0, color: COLORS.expired },
    { name: "ملغاة", value: data?.cancelled_count ?? 0, color: COLORS.cancelled },
  ].filter((d) => d.value > 0);

  const total = chartData.reduce((s, d) => s + d.value, 0);

  return (
    <Card className="rounded-2xl border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">نظرة عامة على المعاملات</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="text-primary"
          onClick={() => navigate("/policies")}
        >
          عرض الكل <ChevronLeft className="mr-1 h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="h-[180px] relative">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Skeleton className="h-32 w-32 rounded-full" />
            </div>
          ) : total === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              لا توجد بيانات
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.color} />
                    ))}
                  </Pie>
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
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className="text-2xl font-bold ltr-nums">{total.toLocaleString("en-US")}</p>
                <p className="text-xs text-muted-foreground">إجمالي</p>
              </div>
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-sm">
          <LegendRow color={COLORS.active} label="سارية" value={data?.active_count ?? 0} />
          <LegendRow color={COLORS.expiring} label="تنتهي قريباً" value={data?.expiring_30d_count ?? 0} />
          <LegendRow color={COLORS.expired} label="منتهية" value={data?.expired_count ?? 0} />
          <LegendRow color={COLORS.cancelled} label="ملغاة" value={data?.cancelled_count ?? 0} />
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
