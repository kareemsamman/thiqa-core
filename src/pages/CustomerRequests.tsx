import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { Loader2, RefreshCw, CheckCircle2, Phone, Inbox, Clock, FileText, HelpCircle, Sparkles } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

export default function CustomerRequests() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");

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

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Inbox className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">لا توجد طلبات لعرضها</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">النوع</TableHead>
                      <TableHead className="text-right">الطلب</TableHead>
                      <TableHead className="text-right">رقم العميل</TableHead>
                      <TableHead className="text-right">التفاصيل</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">إجراء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => {
                      const meta = REQUEST_TYPE_META[r.request_type] ?? {
                        label: r.request_type,
                        icon: FileText,
                      };
                      const Icon = meta.icon;
                      const localPhone = formatLocalPhone(r.phone_number);
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <Badge variant="outline" className="gap-1 font-normal">
                              <Icon className="h-3 w-3" />
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-medium max-w-xs">{r.title}</TableCell>
                          <TableCell>
                            <a
                              href={`tel:${localPhone}`}
                              className="inline-flex items-center gap-1.5 text-primary hover:underline whitespace-nowrap font-mono text-sm"
                            >
                              <Phone className="h-3.5 w-3.5" />
                              {localPhone}
                            </a>
                          </TableCell>
                          <TableCell className="max-w-md whitespace-pre-line text-sm text-muted-foreground">
                            {r.content}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={r.status === "open" ? "default" : "secondary"}
                              className="gap-1"
                            >
                              {r.status === "open" ? (
                                <Clock className="h-3 w-3" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              {STATUS_LABELS[r.status] ?? r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            <div>{format(new Date(r.created_at), "d MMM yyyy", { locale: ar })}</div>
                            <div className="text-xs">
                              {formatDistanceToNow(new Date(r.created_at), { locale: ar, addSuffix: true })}
                            </div>
                          </TableCell>
                          <TableCell>
                            {r.status === "open" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => markHandled.mutate(r.id)}
                                disabled={markHandled.isPending}
                              >
                                <CheckCircle2 className="h-4 w-4 ml-1" />
                                تم التواصل
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
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
