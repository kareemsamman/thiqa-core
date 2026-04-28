import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { LifeBuoy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const supabase = supabaseTyped as any;

interface TicketRow {
  id: string;
  ticket_number: string;
  subject: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  category_id: string | null;
  subcategory_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CategoryRow {
  id: string;
  name_ar: string;
}

const STATUS_LABEL: Record<TicketRow["status"], string> = {
  open: "مفتوح",
  in_progress: "قيد المعالجة",
  done: "تم",
  cancelled: "ملغى",
};

const STATUS_TONE: Record<TicketRow["status"], string> = {
  open: "bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300",
  in_progress: "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300",
  done: "bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-300",
  cancelled: "bg-muted border-border text-muted-foreground",
};

/**
 * Per-agent support ticket list embedded inside ThiqaAgentDetail.
 * Mirrors the global inbox layout but pre-scoped to one agent_id, so
 * the admin doesn't have to filter manually when they're already
 * looking at a specific agent. Click-through goes to /support/:ticketId
 * which super-admins can read and reply on (with the status changer).
 */
export function AgentSupportTickets({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [categories, setCategories] = useState<Record<string, CategoryRow>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAll();
  }, [agentId]);

  const fetchAll = async () => {
    setLoading(true);
    const { data: tData } = await supabase
      .from("support_tickets")
      .select("id, ticket_number, subject, status, category_id, subcategory_id, created_at, updated_at")
      .eq("agent_id", agentId)
      .order("updated_at", { ascending: false });
    const ts = (tData as TicketRow[]) || [];
    setTickets(ts);

    if (ts.length > 0) {
      const catIds = Array.from(new Set([
        ...ts.map((t) => t.category_id).filter(Boolean) as string[],
        ...ts.map((t) => t.subcategory_id).filter(Boolean) as string[],
      ]));
      if (catIds.length > 0) {
        const { data: cData } = await supabase
          .from("support_categories")
          .select("id, name_ar")
          .in("id", catIds);
        const cm: Record<string, CategoryRow> = {};
        (cData as CategoryRow[] || []).forEach((c) => (cm[c.id] = c));
        setCategories(cm);
      }
    }

    setLoading(false);
  };

  const counts = useMemo(() => {
    const c = { total: tickets.length, open: 0, in_progress: 0, done: 0, cancelled: 0 };
    tickets.forEach((t) => { c[t.status] += 1; });
    return c;
  }, [tickets]);

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">تذاكر الدعم</h2>
            <p className="text-sm text-muted-foreground">
              كل التذاكر التي قدّمها فريق هذا الوكيل · {counts.open} مفتوح · {counts.in_progress} قيد المعالجة
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/thiqa/support")} className="gap-2">
            <LifeBuoy className="h-4 w-4" />
            مركز الدعم العام
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground border border-dashed rounded-xl">
            لم يفتح هذا الوكيل أي تذاكر بعد.
          </div>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => {
              const cat = t.category_id ? categories[t.category_id] : null;
              const sub = t.subcategory_id ? categories[t.subcategory_id] : null;
              return (
                <div
                  key={t.id}
                  onClick={() => navigate(`/support/${t.id}`)}
                  className="p-3 rounded-xl border bg-background hover:bg-muted/30 hover:border-primary/30 cursor-pointer transition-all"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground ltr-nums">{t.ticket_number}</span>
                    <Badge variant="outline" className={cn("text-[10px] font-medium", STATUS_TONE[t.status])}>
                      {STATUS_LABEL[t.status]}
                    </Badge>
                    {cat && <Badge variant="outline" className="text-[10px]">{cat.name_ar}{sub ? ` / ${sub.name_ar}` : ""}</Badge>}
                  </div>
                  <div className="font-medium mt-0.5 truncate">{t.subject}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 ltr-nums">
                    آخر تحديث: {format(new Date(t.updated_at), "dd/MM/yyyy HH:mm")}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
