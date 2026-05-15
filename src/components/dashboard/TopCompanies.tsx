import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "lucide-react";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { PeriodRange } from "./PeriodPills";
import { SeeAllButton } from "./SeeAllButton";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";

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
  // 'thiqa:policy-created' refresh is handled centrally by
  // Dashboard.tsx — invalidating the shared dashboard-summary
  // query updates this widget along with the others.
  const { data, isLoading } = useDashboardSummary(range, branchId);
  const rows = data.top_companies;

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
        {isLoading ? (
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
