import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ExpiryBadge } from "@/components/shared/ExpiryBadge";
import { getInsuranceTypeLabel } from "@/lib/insuranceTypes";
import { usePermissions } from "@/hooks/usePermissions";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { SeeAllButton } from "./SeeAllButton";

interface ExpiringPolicy {
  id: string;
  group_id: string | null;
  end_date: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  client: { full_name: string } | null;
  car: { car_number: string } | null;
  renewal_tracking: { renewal_status: string | null }[] | { renewal_status: string | null } | null;
}

export function FollowUpsCard() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { showUpgradePrompt } = useUpgradePrompt();
  const [policies, setPolicies] = useState<ExpiringPolicy[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const canReports = can("page.policy_reports");
  const handleSeeAll = () => {
    if (canReports) {
      navigate("/reports/policies?tab=renewals");
    } else {
      showUpgradePrompt({ featureKey: "policy_reports", featureLabel: "تقارير المعاملات" });
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const today = new Date();
        const horizon = new Date();
        horizon.setDate(today.getDate() + 30);
        const todayStr = today.toISOString().split("T")[0];
        const horizonStr = horizon.toISOString().split("T")[0];

        const { data, error } = await supabase
          .from("policies")
          .select(
            `id, group_id, end_date, policy_type_parent, policy_type_child,
             client:clients(full_name),
             car:cars(car_number),
             renewal_tracking:policy_renewal_tracking(renewal_status)`
          )
          .is("deleted_at", null)
          .eq("cancelled", false)
          .gte("end_date", todayStr)
          .lte("end_date", horizonStr)
          .order("end_date", { ascending: true })
          .limit(30);
        if (error) throw error;
        if (cancelled) return;

        const filtered = (data ?? []).filter((p: any) => {
          const rt = p.renewal_tracking;
          const status = Array.isArray(rt) ? rt[0]?.renewal_status : rt?.renewal_status;
          return status !== "renewed";
        });

        // Package-aware dedupe: one row per package, earliest end_date first.
        const seen = new Set<string>();
        const deduped: ExpiringPolicy[] = [];
        for (const p of filtered as any[]) {
          const key = p.group_id ?? p.id;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(p as ExpiringPolicy);
        }

        setTotalCount(deduped.length);
        setPolicies(deduped.slice(0, 5));
      } catch (e) {
        console.error("Error loading follow-ups:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card className="rounded-2xl border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <CardTitle className="text-base font-semibold">متابعات خلال 30 يوم</CardTitle>
          {!loading && totalCount > 0 && (
            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
              {totalCount}
            </Badge>
          )}
        </div>
        <SeeAllButton locked={!canReports} onClick={handleSeeAll} />
      </CardHeader>
      <CardContent className="space-y-2.5">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))
        ) : policies.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            لا توجد بوالص تنتهي خلال 30 يوم
          </div>
        ) : (
          policies.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-secondary/40 p-3 hover:bg-secondary cursor-pointer transition-colors"
              onClick={handleSeeAll}
            >
              <div className="flex items-center gap-3 min-w-0">
                <ExpiryBadge endDate={p.end_date} showDays={true} />
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {p.client?.full_name || "غير معروف"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <bdi>{p.car?.car_number || "-"}</bdi>
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="text-xs shrink-0">
                {getInsuranceTypeLabel(p.policy_type_parent as any, p.policy_type_child as any)}
              </Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
