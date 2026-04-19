import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { normalizeArabic } from "@/lib/arabicNormalize";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Search,
  FileText,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Eye,
  Trash2,
  Plus,
} from "lucide-react";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { AccidentReportWizard } from "@/components/accident-reports/AccidentReportWizard";

interface AccidentReport {
  id: string;
  accident_date: string;
  accident_location: string | null;
  status: string;
  created_at: string;
  clients: {
    id: string;
    full_name: string;
    file_number: string | null;
  };
  cars: {
    id: string;
    car_number: string;
  } | null;
  policies: {
    id: string;
    policy_number: string | null;
    policy_type_child: string | null;
  };
  insurance_companies: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  branches: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
}

// New status vocabulary: only investigating/closed are selectable.
// draft/submitted stay as legacy labels so old rows still render.
const statusLabels: Record<string, string> = {
  investigating: "قيد التحقيق",
  closed: "مغلق",
  draft: "مسودة",
  submitted: "مُقدَّم",
};

const statusColors: Record<string, string> = {
  investigating: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  closed: "bg-green-500/10 text-green-700 border-green-500/20",
  draft: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  submitted: "bg-blue-500/10 text-blue-700 border-blue-500/20",
};

const selectableStatuses: string[] = ["investigating", "closed"];

const PAGE_SIZE = 25;

export default function AccidentReports() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [reports, setReports] = useState<AccidentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const fetchCompanies = useCallback(async () => {
    const { data } = await supabase
      .from("insurance_companies")
      .select("id, name")
      .eq("active", true)
      .order("name");
    if (data) setCompanies(data);
  }, []);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("accident_reports")
        .select(`
          id,
          accident_date,
          accident_location,
          status,
          created_at,
          clients!inner(id, full_name, file_number),
          cars(id, car_number),
          policies!inner(id, policy_number, policy_type_child),
          insurance_companies(id, name, name_ar),
          branches(id, name, name_ar),
          profiles:created_by_admin_id(full_name, email)
        `, { count: "exact" });

      // Search
      if (search.trim()) {
        query = query.or(`clients.full_name_normalized.ilike.%${normalizeArabic(search)}%,cars.car_number.ilike.%${search}%,policies.policy_number.ilike.%${search}%`);
      }

      // Status filter
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      // Company filter
      if (companyFilter !== "all") {
        query = query.eq("company_id", companyFilter);
      }

      // Pagination
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;

      setReports(data as AccidentReport[]);
      setTotalCount(count || 0);
    } catch (error: any) {
      console.error("Error fetching accident reports:", error);
      toast({ title: "خطأ", description: "فشل في تحميل بلاغات الحوادث", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, search, statusFilter, companyFilter, page, toast]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-GB");
  };

  const handleDeleteReport = async () => {
    if (!deletingReportId) return;
    setDeleting(true);
    try {
      // Delete third parties first
      await supabase
        .from("accident_third_parties")
        .delete()
        .eq("accident_report_id", deletingReportId);

      // Delete the report
      const { error } = await supabase
        .from("accident_reports")
        .delete()
        .eq("id", deletingReportId);

      if (error) throw error;

      toast({ title: "تم الحذف", description: "تم حذف بلاغ الحادث بنجاح" });
      setDeleteDialogOpen(false);
      setDeletingReportId(null);
      fetchReports();
    } catch (error: any) {
      console.error("Error deleting report:", error);
      toast({ title: "خطأ", description: "فشل في حذف البلاغ", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <MainLayout>
      <Header
        title="بلاغات الحوادث"
        subtitle="إدارة ومتابعة بلاغات الحوادث المرتبطة بالمعاملات"
      />

      <div className="p-6 space-y-6" dir="rtl">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => setWizardOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            بلاغ جديد
          </Button>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="بحث بالعميل، رقم السيارة، رقم المعاملة..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pr-10"
            />
          </div>

          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="الحالة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع الحالات</SelectItem>
              {selectableStatuses.map((value) => (
                <SelectItem key={value} value={value}>
                  {statusLabels[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={companyFilter} onValueChange={(v) => { setCompanyFilter(v); setPage(1); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="شركة التأمين" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع الشركات</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">تاريخ الحادث</TableHead>
                <TableHead className="text-right">العميل</TableHead>
                <TableHead className="text-right">رقم السيارة</TableHead>
                <TableHead className="text-right">رقم المعاملة</TableHead>
                <TableHead className="text-right">الشركة</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">أنشئ بواسطة</TableHead>
                <TableHead className="text-right w-[80px]">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : reports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    لا توجد بلاغات حوادث
                  </TableCell>
                </TableRow>
              ) : (
                reports.map((report) => (
                  <TableRow
                    key={report.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/policies/${report.policies.id}/accident/${report.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        {formatDate(report.accident_date)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{report.clients.full_name}</p>
                        {report.clients.file_number && (
                          <p className="text-xs text-muted-foreground">#{report.clients.file_number}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">
                      {report.cars?.car_number || "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {report.policies.policy_number || "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {report.insurance_companies ? (
                        <div className="flex items-center gap-1">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {report.insurance_companies.name_ar || report.insurance_companies.name}
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[report.status]}>
                        {statusLabels[report.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {report.profiles?.full_name || report.profiles?.email?.split("@")[0] || "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/policies/${report.policies.id}/accident/${report.id}`);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingReportId(report.id);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              عرض {(page - 1) * PAGE_SIZE + 1} - {Math.min(page * PAGE_SIZE, totalCount)} من {totalCount}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronRight className="h-4 w-4" />
                السابق
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                التالي
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <DeleteConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleDeleteReport}
          title="حذف بلاغ الحادث"
          description="هل أنت متأكد من حذف هذا البلاغ؟ سيتم حذف جميع البيانات المرتبطة به."
          loading={deleting}
        />

        <AccidentReportWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
        />
      </div>
    </MainLayout>
  );
}
