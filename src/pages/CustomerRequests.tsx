import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { Loader2, RefreshCw, CheckCircle2, Phone, Inbox, Clock, FileText, HelpCircle, Sparkles, MessageCircle, UserCog, Trash2, Calendar, Search, X, CalendarClock } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface CustomerRequest {
  id: string;
  title: string;
  content: string;
  request_type: string;
  phone_number: string;
  status: string;
  handled_at: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  open: "مفتوح",
  handled: "تم التواصل",
  closed: "مغلق",
};

// Map request_type → friendly Arabic label, icon, and tone. Tones drive
// the card's accent (icon box + status pill colour) so the eye can spot
// quote vs. manager vs. help requests at a glance. Falls back to the raw
// string + neutral tone for any future request kind we haven't catalogued.
type RequestTone = "primary" | "blue" | "amber" | "rose";
const REQUEST_TYPE_META: Record<string, { label: string; icon: typeof FileText; tone: RequestTone }> = {
  quote: { label: "عرض سعر", icon: FileText, tone: "amber" },
  help: { label: "طلب مساعدة", icon: HelpCircle, tone: "primary" },
  support: { label: "طلب مساعدة", icon: HelpCircle, tone: "primary" },
  manager: { label: "طلب التواصل مع الإدارة", icon: UserCog, tone: "blue" },
  accident_appointment: { label: "تحديد موعد — حادث طرق", icon: CalendarClock, tone: "rose" },
};

const TONE_CLASSES: Record<RequestTone, { iconBox: string; iconColor: string; ring: string }> = {
  primary: {
    iconBox: "bg-primary/10",
    iconColor: "text-primary",
    ring: "ring-primary/15",
  },
  blue: {
    iconBox: "bg-blue-500/10",
    iconColor: "text-blue-600 dark:text-blue-400",
    ring: "ring-blue-500/15",
  },
  amber: {
    iconBox: "bg-amber-500/10",
    iconColor: "text-amber-600 dark:text-amber-400",
    ring: "ring-amber-500/15",
  },
  rose: {
    iconBox: "bg-rose-500/10",
    iconColor: "text-rose-600 dark:text-rose-400",
    ring: "ring-rose-500/15",
  },
};

// Filter groups: "help" and "support" both surface as "طلب مساعدة" in
// the UI so the dropdown collapses them under one option that matches
// either underlying request_type value.
const REQUEST_TYPE_GROUPS: Record<string, string[]> = {
  quote: ["quote"],
  help: ["help", "support"],
  manager: ["manager"],
  accident_appointment: ["accident_appointment"],
};

// Israeli mobile numbers come in from WhatsApp as "972XXXXXXXXX". Drop
// the country code and add the leading 0 so the table reads like a
// local phone number ("0525143581") and a tap-to-call link opens the
// dialer with the canonical local format.
function formatLocalPhone(phone: string): string {
  const digits = (phone || "").replace(/[^\d]/g, "");
  if (digits.startsWith("972")) return "0" + digits.slice(3);
  if (digits.startsWith("0")) return digits;
  return phone;
}

// wa.me requires international digits with no plus or dashes. Customers
// stored as "0XXXXXXXXX" need the country code; "972XXXXXXXXX" rows
// come straight through.
function toWhatsAppDigits(phone: string): string {
  const digits = (phone || "").replace(/[^\d]/g, "");
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  return digits;
}

// Short notification chime synthesised on the fly via Web Audio API —
// no asset to ship, no autoplay headaches once the user has interacted
// with the page at least once. Two quick beeps so it cuts through.
function playNotificationChime() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    const beep = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime + start;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.start(t0);
      osc.stop(t0 + duration + 0.01);
    };
    beep(880, 0, 0.18);
    beep(1175, 0.18, 0.22);
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {
    // Audio failure is harmless — the toast still fires.
  }
}

export default function CustomerRequests() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<CustomerRequest | null>(null);

  const { data: requests, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["customer_requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_requests")
        .select("id, title, content, request_type, phone_number, status, handled_at, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CustomerRequest[];
    },
  });

  const filtered = useMemo(() => {
    if (!requests) return [];
    // Free-text query: digits are matched against the normalized phone
    // number (strip "972"/"0" so "525143581" hits both "0525..." and
    // "972525..."), while non-digit input matches anywhere in the title
    // or content (case-insensitive). Searching "קיה" finds Hebrew car
    // descriptions, searching "525" finds the phone — same input box.
    const q = searchQuery.trim();
    const qDigits = q.replace(/\D/g, "");
    const qLower = q.toLowerCase();
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all") {
        const group = REQUEST_TYPE_GROUPS[typeFilter];
        if (group && !group.includes(r.request_type)) return false;
      }
      if (!q) return true;
      const phoneDigits = (r.phone_number || "").replace(/\D/g, "");
      const phoneMatch = qDigits.length > 0 && phoneDigits.includes(qDigits);
      const textMatch =
        r.title?.toLowerCase().includes(qLower) ||
        r.content?.toLowerCase().includes(qLower);
      return phoneMatch || textMatch;
    });
  }, [requests, statusFilter, typeFilter, searchQuery]);

  const stats = useMemo(() => {
    const all = requests ?? [];
    return {
      total: all.length,
      open: all.filter((r) => r.status === "open").length,
      handled: all.filter((r) => r.status === "handled").length,
    };
  }, [requests]);

  // Realtime: chime + toast whenever a new request lands. RLS on
  // customer_requests scopes the channel to the current agent's rows,
  // so we don't get noise from other tenants. We use a ref to skip the
  // first event after a hard refresh — without it, the optimistic
  // refetch double-toasts.
  const seenIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (requests) {
      requests.forEach((r) => seenIdsRef.current.add(r.id));
    }
  }, [requests]);

  useEffect(() => {
    const channel = supabase
      .channel("customer_requests_inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "customer_requests" },
        (payload) => {
          const row = payload.new as CustomerRequest;
          if (!row?.id || seenIdsRef.current.has(row.id)) return;
          seenIdsRef.current.add(row.id);
          playNotificationChime();
          const typeLabel =
            REQUEST_TYPE_META[row.request_type]?.label ?? row.request_type;
          toast({
            title: "طلب جديد من بوت واتساب",
            description: `${typeLabel} — ${formatLocalPhone(row.phone_number)}`,
          });
          queryClient.invalidateQueries({ queryKey: ["customer_requests"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const markHandled = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("customer_requests")
        .update({ status: "handled", handled_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "تم تحديث الطلب" });
      queryClient.invalidateQueries({ queryKey: ["customer_requests"] });
    },
    onError: (e: any) =>
      toast({ title: "خطأ", description: e?.message ?? "فشل التحديث", variant: "destructive" }),
  });

  const deleteRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customer_requests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "تم حذف الطلب" });
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["customer_requests"] });
    },
    onError: (e: any) =>
      toast({ title: "خطأ", description: e?.message ?? "فشل الحذف", variant: "destructive" }),
  });

  return (
    <MainLayout>
      <Header
        title="طلبات الذكاء الاصطناعي"
        subtitle="طلبات العملاء القادمة من بوت واتساب — عروض الأسعار، طلبات المساعدة، وغيرها"
      />

      <div className="p-3 md:p-6 space-y-6" dir="rtl">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            label="مفتوح"
            value={stats.open}
            icon={Inbox}
            tone="primary"
            onClick={() => setStatusFilter("open")}
            active={statusFilter === "open"}
          />
          <StatCard
            label="تم التواصل"
            value={stats.handled}
            icon={CheckCircle2}
            tone="success"
            onClick={() => setStatusFilter("handled")}
            active={statusFilter === "handled"}
          />
          <StatCard
            label="إجمالي الطلبات"
            value={stats.total}
            icon={Sparkles}
            tone="muted"
            onClick={() => setStatusFilter("all")}
            active={statusFilter === "all"}
          />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث برقم العميل أو نص الطلب (مثال: קיה أو 0525)"
              className="pr-9 pl-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="مسح البحث"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              <SelectItem value="quote">عرض سعر</SelectItem>
              <SelectItem value="manager">طلب الإدارة</SelectItem>
              <SelectItem value="accident_appointment">تحديد موعد — حادث طرق</SelectItem>
              <SelectItem value="help">طلب مساعدة</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الطلبات</SelectItem>
              <SelectItem value="open">مفتوح</SelectItem>
              <SelectItem value="handled">تم التواصل</SelectItem>
              <SelectItem value="closed">مغلق</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            className="shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Cards */}
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">لا توجد طلبات لعرضها</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map((r, idx) => (
              <RequestCard
                key={r.id}
                request={r}
                isNewest={idx === 0}
                onMarkHandled={() => markHandled.mutate(r.id)}
                onDelete={() => setDeleteTarget(r)}
                markHandledPending={markHandled.isPending}
              />
            ))}
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteRequest.mutate(deleteTarget.id)}
        title="حذف الطلب"
        description={
          deleteTarget
            ? `هل أنت متأكد من حذف طلب "${deleteTarget.title}"؟ لا يمكن التراجع عن هذا الإجراء.`
            : undefined
        }
        loading={deleteRequest.isPending}
      />
    </MainLayout>
  );
}

interface RequestCardProps {
  request: CustomerRequest;
  isNewest: boolean;
  onMarkHandled: () => void;
  onDelete: () => void;
  markHandledPending: boolean;
}

function RequestCard({ request: r, isNewest, onMarkHandled, onDelete, markHandledPending }: RequestCardProps) {
  const meta = REQUEST_TYPE_META[r.request_type] ?? {
    label: r.request_type,
    icon: FileText,
    tone: "primary" as RequestTone,
  };
  const Icon = meta.icon;
  const tone = TONE_CLASSES[meta.tone];
  const localPhone = formatLocalPhone(r.phone_number);
  const isOpen = r.status === "open";

  return (
    <Card className={`group relative rounded-2xl border shadow-sm hover:shadow-md transition-all overflow-hidden ${isOpen ? "" : "bg-muted/20"}`}>
      <CardContent className="p-5 space-y-4">
        {/* Top row: icon + type, status pill, delete */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`shrink-0 rounded-xl p-2.5 ${tone.iconBox}`}>
              <Icon className={`h-5 w-5 ${tone.iconColor}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-medium">{meta.label}</p>
              <h3 className="font-semibold text-[15px] leading-snug truncate">{r.title}</h3>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isNewest && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 px-2.5 py-1 text-xs font-semibold ring-1 ring-rose-500/20">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
                </span>
                جديد
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                isOpen
                  ? "bg-primary/10 text-primary"
                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              }`}
            >
              {isOpen ? <Clock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              {STATUS_LABELS[r.status] ?? r.status}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={onDelete}
              title="حذف الطلب"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Phone + WhatsApp */}
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`tel:${localPhone}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 hover:bg-muted px-3 py-1.5 text-sm font-mono transition-colors"
          >
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-foreground">{localPhone}</span>
          </a>
          <a
            href={`https://wa.me/${toWhatsAppDigits(r.phone_number)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium px-3 py-1.5 transition-colors"
            title="فتح محادثة واتساب"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            واتساب
          </a>
        </div>

        {/* Details — fixed min-height so cards in the grid line up
            even when one request has a short message and another has
            four lines of car info. */}
        <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm whitespace-pre-line text-foreground/85 leading-relaxed min-h-[7.5rem]">
          {r.content}
        </div>

        {/* Footer: date + action */}
        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span>{format(new Date(r.created_at), "d MMM yyyy", { locale: ar })}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{formatDistanceToNow(new Date(r.created_at), { locale: ar, addSuffix: true })}</span>
          </div>
          {isOpen && (
            <Button
              size="sm"
              onClick={onMarkHandled}
              disabled={markHandledPending}
              className="rounded-full shadow-sm"
            >
              <CheckCircle2 className="h-4 w-4 ml-1" />
              تم التواصل
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  icon: typeof Inbox;
  tone: "primary" | "success" | "muted";
  onClick: () => void;
  active: boolean;
}

function StatCard({ label, value, icon: Icon, tone, onClick, active }: StatCardProps) {
  const toneClasses = {
    primary: { card: "bg-primary/5 border-primary/15", iconBox: "bg-primary/10", iconColor: "text-primary" },
    success: { card: "bg-emerald-500/5 border-emerald-500/15", iconBox: "bg-emerald-500/10", iconColor: "text-emerald-600 dark:text-emerald-400" },
    muted: { card: "bg-card border-border", iconBox: "bg-muted", iconColor: "text-muted-foreground" },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-right rounded-2xl border p-5 shadow-sm hover:shadow-md transition-all ${toneClasses.card} ${
        active ? "ring-2 ring-primary/40" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <p className="text-sm font-medium text-muted-foreground truncate">{label}</p>
          <p className="text-3xl font-bold ltr-nums">{value}</p>
        </div>
        <div className={`rounded-xl p-3 shrink-0 ${toneClasses.iconBox}`}>
          <Icon className={`h-5 w-5 ${toneClasses.iconColor}`} />
        </div>
      </div>
    </button>
  );
}
