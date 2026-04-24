import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Lock, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAgentContext } from "@/hooks/useAgentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { PeriodRange } from "./PeriodPills";

interface Company {
  company_id: string;
  company_name: string;
  tx_count: number;
  total_amount: number;
}

const BAR_COLORS = [
  "hsl(210 90% 55%)",
  "hsl(280 70% 55%)",
  "hsl(38 92% 50%)",
  "hsl(142 76% 36%)",
  "hsl(0 84% 60%)",
];

export function TopCompanies({ range }: { range: PeriodRange }) {
  const navigate = useNavigate();
  const { can } = usePermissions();
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
        });
        if (error) throw error;
        if (cancelled) return;
        setRows(
          (data ?? []).map((r: any) => ({
            company_id: r.company_id,
            company_name: r.company_name,
            tx_count: Number(r.tx_count ?? 0),
            total_amount: Number(r.total_amount ?? 0),
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
  }, [range.start, range.end]);

  const max = Math.max(1, ...rows.map((r) => r.total_amount));
  const canSettlement = can("page.company_settlement");

  const handleSeeAll = () => {
    if (canSettlement) {
      navigate("/reports/company-settlement");
    } else {
      showUpgradePrompt({
        featureKey: "company_settlement",
        featureLabel: "تسوية الشركات",
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
        <Button variant="ghost" size="sm" className="text-primary" onClick={handleSeeAll}>
          {canSettlement ? "عرض الكل" : <><Lock className="h-3.5 w-3.5 ml-1" /> الترقية</>}
          {canSettlement && <ChevronLeft className="mr-1 h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            لا يوجد إنتاج في هذه الفترة
          </div>
        ) : (
          rows.map((r, i) => {
            const pct = Math.round((r.total_amount / max) * 100);
            return (
              <div key={r.company_id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground truncate">{r.company_name}</span>
                  <span className="text-muted-foreground ltr-nums shrink-0 mr-2">
                    {r.tx_count} · ₪{Math.round(r.total_amount).toLocaleString("en-US")}
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
