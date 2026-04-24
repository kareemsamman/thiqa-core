import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAgentContext } from "@/hooks/useAgentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";

type BucketKey = "overdue_60" | "overdue_30" | "current" | "paid";

interface Bucket {
  bucket: BucketKey;
  tx_count: number;
  amount: number;
}

const CFG: Record<BucketKey, { label: string; color: string; track: string }> = {
  overdue_60: {
    label: "متأخر أكثر من 60 يوم",
    color: "hsl(280 70% 55%)",
    track: "bg-purple-500/10",
  },
  overdue_30: {
    label: "متأخر 30-60 يوم",
    color: "hsl(0 84% 60%)",
    track: "bg-red-500/10",
  },
  current: {
    label: "أقل من 30 يوم",
    color: "hsl(210 90% 55%)",
    track: "bg-blue-500/10",
  },
  paid: {
    label: "مدفوع بالكامل",
    color: "hsl(142 76% 36%)",
    track: "bg-success/10",
  },
};

const ORDER: BucketKey[] = ["overdue_60", "overdue_30", "current", "paid"];

export function DebtBuckets() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { hasFeature } = useAgentContext();
  const { showUpgradePrompt } = useUpgradePrompt();
  const [rows, setRows] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await (supabase.rpc as any)("dashboard_client_debt_buckets");
        if (error) throw error;
        if (cancelled) return;
        setRows(
          (data ?? []).map((r: any) => ({
            bucket: r.bucket as BucketKey,
            tx_count: Number(r.tx_count ?? 0),
            amount: Number(r.amount ?? 0),
          }))
        );
      } catch (e) {
        console.error("Error loading debt buckets:", e);
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
  }, []);

  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  const maxAmount = Math.max(
    1,
    ...ORDER.filter((k) => k !== "paid").map((k) => byKey.get(k)?.amount ?? 0)
  );

  const canDebt = can("page.debt_tracking") && hasFeature("debt_tracking");

  const handleSeeAll = () => {
    if (canDebt) {
      navigate("/debt-tracking");
    } else {
      showUpgradePrompt({
        featureKey: "debt_tracking",
        featureLabel: "متابعة الديون",
      });
    }
  };

  return (
    <Card className="rounded-2xl border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-semibold">حالة مدفوعات العملاء</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">لا تشمل بوالص الوسطاء · الحزم تُحتسب معاملة واحدة</p>
        </div>
        <Button variant="ghost" size="sm" className="text-primary" onClick={handleSeeAll}>
          {canDebt ? "عرض الكل" : <><Lock className="h-3.5 w-3.5 ml-1" /> الترقية</>}
          {canDebt && <ChevronLeft className="mr-1 h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)
        ) : (
          ORDER.map((key) => {
            const row = byKey.get(key);
            const count = row?.tx_count ?? 0;
            const amount = row?.amount ?? 0;
            const pct = key === "paid" ? 100 : Math.min(100, Math.round((amount / maxAmount) * 100));
            const c = CFG[key];
            return (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{c.label}</span>
                  <span className="ltr-nums text-muted-foreground">
                    {count.toLocaleString("en-US")}
                    {key !== "paid" && (
                      <span className="mx-2 text-foreground font-semibold">
                        ₪{Math.round(amount).toLocaleString("en-US")}
                      </span>
                    )}
                  </span>
                </div>
                <div className={`h-2.5 rounded-full overflow-hidden ${c.track}`}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: c.color }}
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
