import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, ChevronLeft, Lock, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";

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

export function TasksMiniCard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { hasFeature } = useAgentContext();
  const { showUpgradePrompt } = useUpgradePrompt();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("tasks")
          .select("id, title, due_date, due_time")
          .eq("assigned_to", user.id)
          .eq("status", "pending")
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
  }, [user?.id]);

  const canTasks = can("page.tasks") && hasFeature("tasks");

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
          <CheckSquare className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <CardTitle className="text-base font-semibold">مهامي</CardTitle>
        </div>
        <Button variant="ghost" size="sm" className="text-primary" onClick={handleSeeAll}>
          {canTasks ? "عرض الكل" : <><Lock className="h-3.5 w-3.5 ml-1" /> الترقية</>}
          {canTasks && <ChevronLeft className="mr-1 h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)
        ) : tasks.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">لا توجد مهام معلقة</div>
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
