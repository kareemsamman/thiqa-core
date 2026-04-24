import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { History, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getInsuranceTypeLabel } from "@/lib/insuranceTypes";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { SeeAllButton } from "./SeeAllButton";
import { PeriodRange } from "./PeriodPills";

interface Item {
  id: string;
  created_at: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  insurance_price: number;
  client: { full_name: string } | null;
  company: { name: string; name_ar: string | null } | null;
}

function formatAgo(iso: string) {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.round(ms / 60000);
    if (mins < 1) return "الآن";
    if (mins < 60) return `${mins} د`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} س`;
    const days = Math.round(hours / 24);
    return `${days} ي`;
  } catch {
    return "";
  }
}

export function ActivityMiniCard({ range }: { range: PeriodRange }) {
  const navigate = useNavigate();
  const { hasFeature } = useAgentContext();
  const { showUpgradePrompt } = useUpgradePrompt();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  // No dedicated `activity` feature in the plan catalog; the /activity
  // route is permission-only. Gate by `dashboard` so the lock flips
  // for plans that don't include the main dashboard module — which is
  // the only realistic scenario where an agent couldn't reach it.
  const canActivity = hasFeature("dashboard");
  const handleSeeAll = () => {
    if (canActivity) {
      navigate("/activity");
    } else {
      showUpgradePrompt({ featureKey: "dashboard", featureLabel: "سجل النشاط" });
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const endInclusive = `${range.end}T23:59:59.999Z`;
        const { data, error } = await supabase
          .from("policies")
          .select(
            `id, created_at, policy_type_parent, policy_type_child, insurance_price,
             client:clients(full_name),
             company:insurance_companies(name, name_ar)`
          )
          .is("deleted_at", null)
          .gte("created_at", range.start)
          .lte("created_at", endInclusive)
          .order("created_at", { ascending: false })
          .limit(3);
        if (error) throw error;
        if (!cancelled) setItems((data ?? []) as any);
      } catch (e) {
        console.error("Error loading activity:", e);
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

  return (
    <Card className="rounded-2xl border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-success/10 p-1.5">
            <History className="h-4 w-4 text-success" />
          </div>
          <CardTitle className="text-base font-semibold">آخر النشاطات</CardTitle>
        </div>
        <SeeAllButton locked={!canActivity} onClick={handleSeeAll} />
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)
        ) : items.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">لا توجد نشاطات في هذه الفترة</div>
        ) : (
          items.map((it) => (
            <div
              key={it.id}
              className="flex items-center gap-3 rounded-lg bg-secondary/40 p-2.5 hover:bg-secondary cursor-pointer transition-colors"
              onClick={handleSeeAll}
            >
              <div className="rounded-lg bg-success/10 p-2 shrink-0">
                <FileText className="h-4 w-4 text-success" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm text-foreground truncate">
                  {it.client?.full_name || "—"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {getInsuranceTypeLabel(it.policy_type_parent as any, it.policy_type_child as any)}
                  {it.company && ` · ${it.company.name_ar || it.company.name}`}
                </p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0 ltr-nums">
                {formatAgo(it.created_at)}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
