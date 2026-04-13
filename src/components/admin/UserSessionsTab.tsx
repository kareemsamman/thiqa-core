import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Clock,
  Globe,
  Monitor,
  Smartphone,
  Tablet,
  RefreshCw,
  MapPin,
  Activity,
} from "lucide-react";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";

interface UserSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  ip_address: string | null;
  browser_name: string | null;
  browser_version: string | null;
  os_name: string | null;
  device_type: string | null;
  country: string | null;
  city: string | null;
  is_active: boolean;
  profile?: {
    full_name: string | null;
    email: string;
  };
}

type FilterPeriod = 'today' | 'week' | 'month' | 'year' | 'custom';

export function UserSessionsTab() {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('today');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const getDateRange = (period: FilterPeriod) => {
    const now = new Date();
    switch (period) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'week':
        return { start: startOfWeek(now, { locale: ar }), end: endOfWeek(now, { locale: ar }) };
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'year':
        return { start: startOfYear(now), end: endOfYear(now) };
      case 'custom':
        return {
          start: startDate ? new Date(startDate) : subDays(now, 7),
          end: endDate ? endOfDay(new Date(endDate)) : now,
        };
      default:
        return { start: startOfDay(now), end: endOfDay(now) };
    }
  };

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange(filterPeriod);

      const { data, error } = await supabase
        .from('user_sessions')
        .select(`
          *,
          profile:profiles!user_sessions_user_id_profiles_fkey(full_name, email)
        `)
        .gte('started_at', start.toISOString())
        .lte('started_at', end.toISOString())
        .order('started_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setSessions((data as any) || []);
    } catch (error) {
      console.error('Error fetching sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [filterPeriod, startDate, endDate]);

  const formatDuration = (minutes: number | null, isActive: boolean) => {
    if (isActive) {
      return (
        <Badge variant="outline" className="bg-success/10 text-success border-success/30">
          <Activity className="h-3 w-3 ml-1 animate-pulse" />
          نشط حالياً
        </Badge>
      );
    }
    if (minutes === null) return '-';
    
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    
    if (hours > 0) {
      return `${hours}س ${mins}د`;
    }
    return `${mins}د`;
  };

  const getDeviceIcon = (deviceType: string | null) => {
    switch (deviceType) {
      case 'mobile':
        return <Smartphone className="h-4 w-4" />;
      case 'tablet':
        return <Tablet className="h-4 w-4" />;
      default:
        return <Monitor className="h-4 w-4" />;
    }
  };

  const formatDateTime = (dateString: string) => {
    return format(new Date(dateString), 'yyyy/MM/dd HH:mm', { locale: ar });
  };

  // Calculate total hours for the period
  const totalMinutes = sessions.reduce((acc, s) => acc + (s.duration_minutes || 0), 0);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalMins = Math.round(totalMinutes % 60);
  const activeSessions = sessions.filter(s => s.is_active).length;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <Select value={filterPeriod} onValueChange={(v: FilterPeriod) => setFilterPeriod(v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="الفترة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">اليوم</SelectItem>
            <SelectItem value="week">هذا الأسبوع</SelectItem>
            <SelectItem value="month">هذا الشهر</SelectItem>
            <SelectItem value="year">هذه السنة</SelectItem>
            <SelectItem value="custom">تاريخ مخصص</SelectItem>
          </SelectContent>
        </Select>

        {filterPeriod === 'custom' && (
          <div className="flex gap-2 items-center">
            <ArabicDatePicker
              value={startDate}
              onChange={(date) => setStartDate(date)}
            />
            <span className="text-muted-foreground">إلى</span>
            <ArabicDatePicker
              value={endDate}
              onChange={(date) => setEndDate(date)}
            />
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={fetchSessions}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ml-2 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">إجمالي الساعات</p>
              <p className="text-xl font-bold">{totalHours}س {totalMins}د</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/10">
              <Activity className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">جلسات نشطة</p>
              <p className="text-xl font-bold">{activeSessions}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Globe className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">إجمالي الجلسات</p>
              <p className="text-xl font-bold">{sessions.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sessions Table */}
      <div className="rounded-lg border bg-card">
        {loading ? (
          <div className="p-4 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>لا توجد جلسات في هذه الفترة</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">المستخدم</TableHead>
                <TableHead className="text-right">الوقت</TableHead>
                <TableHead className="text-right">المدة</TableHead>
                <TableHead className="text-right">المتصفح</TableHead>
                <TableHead className="text-right">الجهاز</TableHead>
                <TableHead className="text-right">IP</TableHead>
                <TableHead className="text-right">الموقع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell className="font-medium">
                    {session.profile?.full_name || session.profile?.email || 'غير معروف'}
                  </TableCell>
                  <TableCell>
                    {formatDateTime(session.started_at)}
                  </TableCell>
                  <TableCell>
                    {formatDuration(session.duration_minutes, session.is_active)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Globe className="h-3 w-3 text-muted-foreground" />
                      {session.browser_name || '-'}
                      {session.browser_version && ` ${session.browser_version}`}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {getDeviceIcon(session.device_type)}
                      <span className="text-muted-foreground text-sm">
                        {session.os_name || '-'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <bdi className="text-muted-foreground text-sm font-mono">
                      {session.ip_address || '-'}
                    </bdi>
                  </TableCell>
                  <TableCell>
                    {session.city || session.country ? (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        {session.city && session.country
                          ? `${session.city}, ${session.country}`
                          : session.city || session.country}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
