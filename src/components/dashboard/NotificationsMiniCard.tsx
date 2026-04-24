import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Bell, ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
  const { user } = useAuth();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [loading, setLoading] = useState(true);

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

  const markAllRead = async () => {
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("is_read", false);
  };

  return (
    <Card className="rounded-2xl border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <CardTitle className="text-base font-semibold">التنبيهات</CardTitle>
          {unreadTotal > 0 && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30">
              {unreadTotal}
            </Badge>
          )}
        </div>
        {unreadTotal > 0 && (
          <Button variant="ghost" size="sm" className="text-primary" onClick={markAllRead}>
            تحديد الكل كمقروء <ChevronLeft className="mr-1 h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)
        ) : notifs.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">لا توجد تنبيهات</div>
        ) : (
          notifs.map((n) => (
            <div
              key={n.id}
              className={`rounded-lg p-2.5 transition-colors cursor-pointer ${
                n.is_read ? "bg-secondary/30 hover:bg-secondary/60" : "bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20"
              }`}
              onClick={() => {
                if (n.link) window.location.href = n.link;
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-sm text-foreground truncate flex-1">{n.title}</p>
                <span className="text-xs text-muted-foreground shrink-0 ltr-nums">{formatAgo(n.created_at)}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{n.message}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
