import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { SeeAllButton } from "./SeeAllButton";

interface Notif {
  id: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
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

export function NotificationsMiniCard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { showUpgradePrompt } = useUpgradePrompt();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const canNotifications = can("page.notifications");

  const handleSeeAll = () => {
    if (canNotifications) {
      navigate("/notifications");
    } else {
      showUpgradePrompt({
        featureKey: "notifications",
        featureLabel: "التنبيهات",
      });
    }
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [listRes, countRes] = await Promise.all([
          supabase
            .from("notifications")
            .select("id, title, message, link, is_read, created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(3),
          supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("is_read", false),
        ]);
        if (cancelled) return;
        if (listRes.error) throw listRes.error;
        setNotifs((listRes.data ?? []) as Notif[]);
        setUnreadTotal(countRes.count ?? 0);
      } catch (e) {
        console.error("Error loading notifications:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const channel = supabase
      .channel(`dashboard-notif-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        load
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return (
    <Card className="rounded-2xl border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-amber-500/10 p-1.5">
            <Bell className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle className="text-base font-semibold">التنبيهات</CardTitle>
          {unreadTotal > 0 && (
            <Badge
              variant="outline"
              className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 h-5 px-2"
            >
              {unreadTotal}
            </Badge>
          )}
        </div>
        <SeeAllButton locked={!canNotifications} onClick={handleSeeAll} />
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))
        ) : notifs.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">لا توجد تنبيهات</div>
        ) : (
          notifs.map((n) => (
            <div
              key={n.id}
              className="group flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-secondary/30 p-3 transition-colors hover:bg-secondary/60 cursor-pointer"
              onClick={() => {
                if (n.link) navigate(n.link);
                else handleSeeAll();
              }}
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="font-medium text-sm text-foreground truncate">{n.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-1">{n.message}</p>
              </div>
              <div className="shrink-0 text-left flex flex-col items-end gap-1">
                <span className="text-xs text-muted-foreground ltr-nums">{formatAgo(n.created_at)}</span>
                {!n.is_read && (
                  <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="غير مقروء" />
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
