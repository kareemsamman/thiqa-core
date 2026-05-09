import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { Loader2, RefreshCw, CheckCircle2, Phone, Inbox, Clock, FileText, HelpCircle, Sparkles, MessageCircle, UserCog, Trash2, Calendar } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

// Map request_type → friendly Arabic label + icon. Falls back to the raw
// string for any future request kind we haven't categorised yet.
const REQUEST_TYPE_META: Record<string, { label: string; icon: typeof FileText }> = {
  quote: { label: "عرض سعر", icon: FileText },
  help: { label: "طلب مساعدة", icon: HelpCircle },
  support: { label: "طلب مساعدة", icon: HelpCircle },
  manager: { label: "طلب التواصل مع الإدارة", icon: UserCog },
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

export default function CustomerRequests() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
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
    if (statusFilter === "all") return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const stats = useMemo(() => {
    const all = requests ?? [];
    return {
      total: all.length,
      open: all.filter((r) => r.status === "open").length,
      handled: all.filter((r) => r.status === "handled").length,
    };
  }, [requests]);

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
      <div className="p-4 md:p-6 space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">طلبات الذكاء الاصطناعي</h1>
              <p className="text-sm text-muted-foreground">
                طلبات العملاء القادمة من بوت واتساب — عروض الأسعار، طلبات المساعدة، وغيرها
              </p>
            </div>
          </div>
        </div>

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
        <div className="flex items-center justify-between gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الطلبات</SelectItem>
              <SelectItem value="open">مفتوح</SelectItem>
              <SelectItem value="handled">تم التواصل</SelectItem>
              <SelectItem value="closed">مغلق</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
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
            {filtered.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
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
  onMarkHandled: () => void;
  onDelete: () => void;
  markHandledPending: boolean;
}

function RequestCard({ request: r, onMarkHandled, onDelete, markHandledPending }: RequestCardProps) {
  const meta = REQUEST_TYPE_META[r.request_type] ?? {
    label: r.request_type,
    icon: FileText,
  };
  const Icon = meta.icon;
  const localPhone = formatLocalPhone(r.phone_number);
  const isOpen = r.status === "open";

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <div className={`h-1 w-full ${isOpen ? "bg-primary" : "bg-emerald-500"}`} />
      <CardContent className="p-4 space-y-4">
        {/* Header: type + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1 font-normal">
              <Icon className="h-3 w-3" />
              {meta.label}
            </Badge>
            <Badge
              variant={isOpen ? "default" : "secondary"}
              className={`gap-1 ${!isOpen ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15" : ""}`}
            >
              {isOpen ? <Clock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              {STATUS_LABELS[r.status] ?? r.status}
            </Badge>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mt-1 -ml-1"
            onClick={onDelete}
            title="حذف الطلب"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-base leading-snug">{r.title}</h3>

        {/* Phone row */}
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`tel:${localPhone}`}
            className="inline-flex items-center gap-1.5 text-primary hover:underline font-mono text-sm"
          >
            <Phone className="h-3.5 w-3.5" />
            {localPhone}
          </a>
          <a
            href={`https://wa.me/${toWhatsAppDigits(r.phone_number)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium px-2.5 py-1 transition-colors"
            title="فتح محادثة واتساب"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            واتساب
          </a>
        </div>

        {/* Details */}
        <div className="rounded-md bg-muted/40 border border-border/50 p-3 text-sm whitespace-pre-line text-foreground/80">
          {r.content}
        </div>

        {/* Footer: date + actions */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            <span>{format(new Date(r.created_at), "d MMM yyyy", { locale: ar })}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{formatDistanceToNow(new Date(r.created_at), { locale: ar, addSuffix: true })}</span>
          </div>
          {isOpen && (
            <Button size="sm" onClick={onMarkHandled} disabled={markHandledPending}>
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
    primary: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-600",
    muted: "bg-muted text-muted-foreground",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-right rounded-lg border bg-card p-4 transition-all hover:shadow-sm ${
        active ? "ring-2 ring-primary/40 border-primary/30" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <div className={`rounded-md p-2 ${toneClasses}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </button>
  );
}
