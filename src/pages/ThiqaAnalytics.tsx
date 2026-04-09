import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { Eye, MousePointerClick, UserPlus, Globe, TrendingUp, Calendar } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";

type AnalyticsEvent = {
  id: string;
  event_type: string;
  page: string | null;
  referrer: string | null;
  session_id: string | null;
  created_at: string;
};

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "hsl(var(--warning))",
  "hsl(var(--success))",
  "#8b5cf6",
  "#f59e0b",
  "#06b6d4",
  "#ec4899",
];

function getReferrerDomain(referrer: string | null): string {
  if (!referrer) return "مباشر (Direct)";
  try {
    const url = new URL(referrer);
    const host = url.hostname.replace("www.", "");
    if (host.includes("google")) return "Google";
    if (host.includes("facebook") || host.includes("fb.")) return "Facebook";
    if (host.includes("instagram")) return "Instagram";
    if (host.includes("linkedin")) return "LinkedIn";
    if (host.includes("twitter") || host.includes("x.com")) return "X / Twitter";
    if (host.includes("whatsapp")) return "WhatsApp";
    return host;
  } catch {
    return "أخرى";
  }
}

export default function ThiqaAnalytics() {
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("30");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = subDays(new Date(), parseInt(range)).toISOString();
      const { data } = await supabase
        .from("site_analytics_events")
        .select("id, event_type, page, referrer, session_id, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: true });
      setEvents((data as AnalyticsEvent[]) || []);
      setLoading(false);
    })();
  }, [range]);

  const stats = useMemo(() => {
    const pageViews = events.filter((e) => e.event_type === "page_view");
    const signupClicks = events.filter((e) => e.event_type === "signup_click");
    const signupComplete = events.filter((e) => e.event_type === "signup_complete");
    const uniqueSessions = new Set(events.map((e) => e.session_id)).size;

    return { pageViews: pageViews.length, signupClicks: signupClicks.length, signupComplete: signupComplete.length, uniqueSessions };
  }, [events]);

  const conversionRate = stats.pageViews > 0 ? ((stats.signupComplete / stats.pageViews) * 100).toFixed(1) : "0";

  // Daily chart data
  const dailyData = useMemo(() => {
    const days = parseInt(range);
    const map: Record<string, { date: string; views: number; clicks: number; signups: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = format(subDays(new Date(), days - 1 - i), "yyyy-MM-dd");
      map[d] = { date: d, views: 0, clicks: 0, signups: 0 };
    }
    events.forEach((e) => {
      const d = format(new Date(e.created_at), "yyyy-MM-dd");
      if (!map[d]) return;
      if (e.event_type === "page_view") map[d].views++;
      if (e.event_type === "signup_click") map[d].clicks++;
      if (e.event_type === "signup_complete") map[d].signups++;
    });
    return Object.values(map);
  }, [events, range]);

  // Referrer breakdown
  const referrerData = useMemo(() => {
    const map: Record<string, number> = {};
    events
      .filter((e) => e.event_type === "page_view")
      .forEach((e) => {
        const src = getReferrerDomain(e.referrer);
        map[src] = (map[src] || 0) + 1;
      });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [events]);

  // Page breakdown
  const pageData = useMemo(() => {
    const map: Record<string, number> = {};
    events
      .filter((e) => e.event_type === "page_view")
      .forEach((e) => {
        const p = e.page || "/";
        map[p] = (map[p] || 0) + 1;
      });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [events]);

  return (
    <MainLayout>
    <div className="space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">تحليلات الموقع</h1>
            <p className="text-sm text-muted-foreground">تتبّع أداء صفحة الهبوط والتسجيل</p>
          </div>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-[180px]">
              <Calendar className="h-4 w-4 ml-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">آخر 7 أيام</SelectItem>
              <SelectItem value="14">آخر 14 يوم</SelectItem>
              <SelectItem value="30">آخر 30 يوم</SelectItem>
              <SelectItem value="90">آخر 90 يوم</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stat cards */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard icon={Eye} label="مشاهدات الصفحة" value={stats.pageViews} color="text-primary" />
            <StatCard icon={Globe} label="زوار فريدون" value={stats.uniqueSessions} color="text-blue-500" />
            <StatCard icon={MousePointerClick} label="نقرات تسجيل" value={stats.signupClicks} color="text-orange-500" />
            <StatCard icon={UserPlus} label="تسجيلات مكتملة" value={stats.signupComplete} color="text-green-500" />
            <StatCard icon={TrendingUp} label="معدل التحويل" value={`${conversionRate}%`} color="text-purple-500" />
          </div>
        )}

        {/* Charts row */}
        {!loading && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Daily trend */}
            <Card className="lg:col-span-2 border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">الزيارات اليومية</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => format(new Date(v), "MM/dd")}
                      />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        labelFormatter={(v) => format(new Date(v as string), "yyyy-MM-dd")}
                        contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="views" name="مشاهدات" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="clicks" name="نقرات تسجيل" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="signups" name="تسجيلات" stroke="#22c55e" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Referrer pie */}
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">مصادر الزيارات</CardTitle>
              </CardHeader>
              <CardContent>
                {referrerData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">لا توجد بيانات</p>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={referrerData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                          style={{ fontSize: 11 }}
                        >
                          {referrerData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Pages table */}
        {!loading && pageData.length > 0 && (
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">أكثر الصفحات زيارة</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pageData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
                    <Bar dataKey="value" name="زيارات" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
    </div>
    </MainLayout>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4 flex flex-col gap-2">
        <div className={`${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <p className="text-2xl font-bold text-foreground">{typeof value === "number" ? value.toLocaleString() : value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
