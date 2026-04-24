import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { History, ChevronLeft, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getInsuranceTypeLabel } from "@/lib/insuranceTypes";

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

export function ActivityMiniCard() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("policies")
          .select(
            `id, created_at, policy_type_parent, policy_type_child, insurance_price,
             client:clients(full_name),
             company:insurance_companies(name, name_ar)`
          )
          .is("deleted_at", null)
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
  }, []);

  return (
    <Card className="rounded-2xl border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-success" />
          <CardTitle className="text-base font-semibold">آخر النشاطات</CardTitle>
        </div>
        <Button variant="ghost" size="sm" className="text-primary" onClick={() => navigate("/policies")}>
          عرض الكل <ChevronLeft className="mr-1 h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)
        ) : items.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">لا توجد نشاطات حديثة</div>
        ) : (
          items.map((it) => (
            <div
              key={it.id}
              className="flex items-center gap-3 rounded-lg bg-secondary/40 p-2.5 hover:bg-secondary cursor-pointer transition-colors"
              onClick={() => navigate("/policies")}
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
