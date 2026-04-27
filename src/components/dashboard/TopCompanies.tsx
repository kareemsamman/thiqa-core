import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { PeriodRange } from "./PeriodPills";
import { SeeAllButton } from "./SeeAllButton";

interface Company {
  company_id: string;
  company_name: string;
  tx_count: number;
  total_profit: number;
}

const BAR_COLORS = [
  "hsl(210 90% 55%)",
  "hsl(280 70% 55%)",
  "hsl(38 92% 50%)",
  "hsl(142 76% 36%)",
  "hsl(0 84% 60%)",
];

export function TopCompanies({
  range,
  branchId,
}: {
  range: PeriodRange;
  branchId?: string | null;
}) {
  const navigate = useNavigate();
  const { hasFeature } = useAgentContext();
  const { showUpgradePrompt } = useUpgradePrompt();
  const [rows, setRows] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await (supabase.rpc as any)("dashboard_top_companies", {
          p_start_date: range.start,
          p_end_date: range.end,
          p_limit: 5,
          p_branch_id: branchId ?? null,
        });
        if (error) throw error;
        if (cancelled) return;
        setRows(
          (data ?? []).map((r: any) => ({
            company_id: r.company_id,
            company_name: r.company_name,
            tx_count: Number(r.tx_count ?? 0),
            total_profit: Number(r.total_profit ?? 0),
          }))
        );
      } catch (e) {
        console.error("Error loading top companies:", e);
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const handler = () => load();
    window.addEventListener("thiqa:policy-created", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("thiqa:policy-created", handler);
    };
  }, [range.start, range.end, branchId]);

  const max = Math.max(1, ...rows.map((r) => Math.abs(r.total_profit)));
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
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <CardTitle className="text-base font-semibold">أفضل شركات التأمين</CardTitle>
        </div>
        <SeeAllButton locked={!canAccounting} onClick={handleSeeAll} />
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            لا يوجد ربح مسجل في هذه الفترة
          </div>
        ) : (
          rows.map((r, i) => {
            const pct = Math.round((Math.abs(r.total_profit) / max) * 100);
            return (
              <div key={r.company_id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground truncate">{r.company_name}</span>
                  <span className="text-muted-foreground ltr-nums shrink-0 mr-2">
                    {r.tx_count} · ₪{Math.round(r.total_profit).toLocaleString("en-US")}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary/70 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
