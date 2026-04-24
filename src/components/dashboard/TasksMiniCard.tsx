import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { SeeAllButton } from "./SeeAllButton";
import { PeriodRange } from "./PeriodPills";

interface Task {
  id: string;
  title: string;
  due_date: string;
  due_time: string;
}

function formatDate(d: string) {
  try {
    const date = new Date(d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return "اليوم";
    if (diff === 1) return "غداً";
    if (diff === -1) return "أمس";
    return date.toLocaleDateString("ar", { day: "numeric", month: "short" });
  } catch {
    return d;
  }
}

export function TasksMiniCard({ range }: { range: PeriodRange }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasFeature } = useAgentContext();
  const { showUpgradePrompt } = useUpgradePrompt();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("tasks")
          .select("id, title, due_date, due_time")
          .eq("assigned_to", user.id)
          .eq("status", "pending")
          .gte("due_date", range.start)
          .lte("due_date", range.end)
          .order("due_date", { ascending: true })
          .order("due_time", { ascending: true })
          .limit(3);
        if (error) throw error;
        if (!cancelled) setTasks((data ?? []) as Task[]);
      } catch (e) {
        console.error("Error loading tasks:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, range.start, range.end]);

  const canTasks = hasFeature("tasks");

  const handleSeeAll = () => {
    if (canTasks) {
      navigate("/tasks");
    } else {
      showUpgradePrompt({ featureKey: "tasks", featureLabel: "المهام" });
    }
  };

  return (
    <Card className="rounded-2xl border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-blue-500/10 p-1.5">
            <CheckSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-base font-semibold">مهامي</CardTitle>
        </div>
        <SeeAllButton locked={!canTasks} onClick={handleSeeAll} />
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)
        ) : tasks.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">لا توجد مهام في هذه الفترة</div>
        ) : (
          tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 p-2.5 hover:bg-secondary cursor-pointer transition-colors"
              onClick={handleSeeAll}
            >
              <p className="font-medium text-sm text-foreground truncate flex-1">{t.title}</p>
              <Badge variant="outline" className="text-xs shrink-0 gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(t.due_date)}
              </Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
