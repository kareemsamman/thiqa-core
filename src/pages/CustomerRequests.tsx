import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { Loader2, RefreshCw, CheckCircle2, Phone } from "lucide-react";
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

export default function CustomerRequests() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("open");

  const { data: requests, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["customer_requests", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("customer_requests")
        .select("id, title, content, request_type, phone_number, status, handled_at, created_at")
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CustomerRequest[];
    },
  });

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
    onError: (e: any) => toast({ title: "خطأ", description: e?.message ?? "فشل التحديث", variant: "destructive" }),
  });

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">طلبات الذكاء الاصطناعي</h1>
            <p className="text-sm text-muted-foreground">
              طلبات عروض الأسعار القادمة من محادثات واتساب الآلية
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">مفتوح</SelectItem>
                <SelectItem value="handled">تم التواصل</SelectItem>
                <SelectItem value="closed">مغلق</SelectItem>
                <SelectItem value="all">الكل</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !requests || requests.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">لا توجد طلبات</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">الطلب</TableHead>
                    <TableHead className="text-right">رقم العميل</TableHead>
                    <TableHead className="text-right">التفاصيل</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">التاريخ</TableHead>
                    <TableHead className="text-right">إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.title}</TableCell>
                      <TableCell>
                        <a
                          href={`tel:${r.phone_number}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          {r.phone_number}
                        </a>
                      </TableCell>
                      <TableCell className="max-w-md whitespace-pre-line text-sm text-muted-foreground">
                        {r.content}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === "open" ? "default" : "secondary"}>
                          {STATUS_LABELS[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(r.created_at), "d MMM yyyy HH:mm", { locale: ar })}
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
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
