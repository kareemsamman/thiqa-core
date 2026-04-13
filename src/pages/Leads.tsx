import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import {
  Search,
  RefreshCw,
  MessageSquare,
  Phone,
  Car,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  MoreHorizontal,
  Eye,
  Trash2,
  Download,
  Loader2,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { LeadDetailsDrawer } from "@/components/leads/LeadDetailsDrawer";
import { LeadNotesPopover } from "@/components/leads/LeadNotesPopover";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { toast } from "@/hooks/use-toast";

interface Lead {
  id: string;
  phone: string;
  customer_name: string | null;
  car_number: string | null;
  car_manufacturer: string | null;
  car_model: string | null;
  car_year: string | null;
  car_color: string | null;
  insurance_types: string[] | null;
  driver_over_24: boolean | null;
  has_accidents: boolean | null;
  total_price: number | null;
  status: string;
  notes: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

const statusOptions = [
  { value: "all", label: "الكل", icon: Users },
  { value: "new", label: "جديد", icon: Clock, color: "bg-blue-500" },
  { value: "contacted", label: "تم التواصل", icon: Phone, color: "bg-yellow-500" },
  { value: "converted", label: "تم التحويل", icon: CheckCircle2, color: "bg-green-500" },
  { value: "rejected", label: "مرفوض", icon: XCircle, color: "bg-red-500" },
];

export default function Leads() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);

  // Fetch leads
  const { data: leads, isLoading, refetch } = useQuery({
    queryKey: ["leads", statusFilter, search],
    queryFn: async () => {
      let query = supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (search) {
        query = query.or(
          `customer_name.ilike.%${search}%,phone.ilike.%${search}%,car_number.ilike.%${search}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Lead[];
    },
  });

  // Discover leads from Redis
  const discoverMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("discover-redis-leads");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      if (data.created > 0) {
        toast({
          title: `تم اكتشاف ${data.created} عميل جديد`,
          description: `تم مزامنة ${data.discovered} محادثة من WhatsApp`,
        });
      } else if (data.discovered > 0) {
        toast({
          title: "لا يوجد عملاء جدد",
          description: `جميع المحادثات (${data.existing}) موجودة مسبقاً`,
        });
      } else {
        toast({
          title: "لا توجد محادثات",
          description: "لم يتم العثور على محادثات في Redis",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "فشل الاكتشاف",
        description: error instanceof Error ? error.message : "خطأ غير معروف",
        variant: "destructive",
      });
    },
  });

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ leadId, status }: { leadId: string; status: string }) => {
      const { error } = await supabase
        .from("leads")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "تم تحديث الحالة" });
    },
    onError: () => {
      toast({ title: "حدث خطأ", variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const { error } = await supabase.from("leads").delete().eq("id", leadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "تم حذف العميل المحتمل" });
      setDeleteDialogOpen(false);
      setLeadToDelete(null);
    },
    onError: () => {
      toast({ title: "حدث خطأ أثناء الحذف", variant: "destructive" });
    },
  });

  // Stats
  const stats = {
    new: leads?.filter((l) => l.status === "new").length || 0,
    contacted: leads?.filter((l) => l.status === "contacted").length || 0,
    converted: leads?.filter((l) => l.status === "converted").length || 0,
    rejected: leads?.filter((l) => l.status === "rejected").length || 0,
  };

  const getStatusConfig = (status: string) => {
    return statusOptions.find((s) => s.value === status);
  };

  const handleRowClick = (lead: Lead) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
  };

  const handleStatusChange = (leadId: string, newStatus: string) => {
    updateStatusMutation.mutate({ leadId, status: newStatus });
  };

  const handleDeleteClick = (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    setLeadToDelete(lead);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (leadToDelete) {
      deleteMutation.mutate(leadToDelete.id);
    }
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-primary" />
            العملاء المحتملون (Leads)
          </h1>
          <p className="text-muted-foreground">
            طلبات التأمين الواردة من WhatsApp Bot
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">جديد</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.new}</p>
                </div>
                <Clock className="h-8 w-8 text-blue-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">تم التواصل</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {stats.contacted}
                  </p>
                </div>
                <Phone className="h-8 w-8 text-yellow-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">تم التحويل</p>
                  <p className="text-2xl font-bold text-green-600">
                    {stats.converted}
                  </p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-green-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50 dark:bg-red-950/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">مرفوض</p>
                  <p className="text-2xl font-bold text-red-600">
                    {stats.rejected}
                  </p>
                </div>
                <XCircle className="h-8 w-8 text-red-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="بحث بالاسم أو الهاتف أو رقم السيارة..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="الحالة" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            title="تحديث"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            onClick={() => discoverMutation.mutate()}
            disabled={discoverMutation.isPending}
            title="اكتشاف المحادثات من WhatsApp"
          >
            {discoverMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin ml-2" />
            ) : (
              <Download className="h-4 w-4 ml-2" />
            )}
            اكتشاف من Redis
          </Button>
        </div>

        {/* Table */}
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>الهاتف</TableHead>
                <TableHead>السيارة</TableHead>
                <TableHead>أنواع التأمين</TableHead>
                <TableHead>السعر</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead className="w-24">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  </TableRow>
                ))
              ) : leads && leads.length > 0 ? (
                leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(lead)}
                  >
                    <TableCell className="font-medium">
                      {lead.customer_name || "-"}
                    </TableCell>
                    <TableCell dir="ltr" className="text-right">
                      {lead.phone}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Car className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {lead.car_manufacturer} {lead.car_model}{" "}
                          {lead.car_year && `(${lead.car_year})`}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {lead.insurance_types?.slice(0, 2).map((type, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {type}
                          </Badge>
                        ))}
                        {lead.insurance_types && lead.insurance_types.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{lead.insurance_types.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      {lead.total_price
                        ? `₪${lead.total_price.toLocaleString()}`
                        : "-"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={lead.status}
                        onValueChange={(value) => handleStatusChange(lead.id, value)}
                      >
                        <SelectTrigger className="w-28 h-8">
                          <div className="flex items-center gap-1">
                            <div className={`w-2 h-2 rounded-full ${getStatusConfig(lead.status)?.color || 'bg-gray-500'}`} />
                            <span className="text-xs">{getStatusConfig(lead.status)?.label || lead.status}</span>
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {statusOptions.filter(s => s.value !== 'all').map((status) => (
                            <SelectItem key={status.value} value={status.value}>
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${status.color}`} />
                                {status.label}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(lead.created_at), "dd/MM/yyyy", {
                        locale: ar,
                      })}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <LeadNotesPopover leadId={lead.id} currentNotes={lead.notes} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleRowClick(lead)}>
                              <Eye className="h-4 w-4 ml-2" />
                              عرض التفاصيل
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={(e) => handleDeleteClick(lead, e)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 ml-2" />
                              حذف
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <MessageSquare className="h-12 w-12 opacity-20" />
                      <p>لا يوجد عملاء محتملون</p>
                      <p className="text-sm">
                        ستظهر الطلبات هنا عند استلامها من WhatsApp Bot
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Details Drawer */}
      <LeadDetailsDrawer
        lead={selectedLead}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        title="حذف العميل المحتمل"
        description={`هل أنت متأكد من حذف "${leadToDelete?.customer_name || leadToDelete?.phone}"؟ لا يمكن التراجع عن هذا الإجراء.`}
        loading={deleteMutation.isPending}
      />
    </MainLayout>
  );
}
