import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useLocation, useNavigate, useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  Search,
  ChevronLeft,
  ChevronRight,
  Phone,
  Users,
  Building2,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeArabic } from "@/lib/arabicNormalize";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ClientDrawer } from "@/components/clients/ClientDrawer";
import { ClientDetails } from "@/components/clients/ClientDetails";
import { ClientFilters, ClientFilterValues } from "@/components/clients/ClientFilters";
import { RowActionsMenu } from "@/components/shared/RowActionsMenu";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";

interface Client {
  id: string;
  full_name: string;
  id_number: string;
  file_number: string | null;
  phone_number: string | null;
  phone_number_2: string | null;
  birth_date: string | null;
  date_joined: string | null;
  less_than_24: boolean | null;
  under24_type: 'none' | 'client' | 'additional_driver' | null;
  under24_driver_name: string | null;
  under24_driver_id: string | null;
  notes: string | null;
  accident_notes: string | null;
  image_url: string | null;
  signature_url: string | null;
  created_at: string;
  broker_id: string | null;
  branch_id: string | null;
  created_by_admin_id: string | null;
  broker?: { id: string; name: string } | null;
  branch?: { id: string; name: string; name_ar: string | null } | null;
  created_by?: { full_name: string | null; email: string } | null;
  accident_count?: number;
}

export default function Clients() {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { clientId: urlClientId } = useParams<{ clientId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState<ClientFilterValues>({
    brokerId: 'all',
    ageGroup: 'all',
    branchId: 'all',
  });
  const pageSize = 25;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  const [initialCarFilter, setInitialCarFilter] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Handle URL param to open client directly (supports both /clients/:id and
  // ?open=id). When the URL drops back to /clients with no client id (e.g.
  // the sidebar "العملاء" link is clicked while a single client is open),
  // clear viewingClient so the list re-renders.
  useEffect(() => {
    const openClientId = urlClientId || searchParams.get('open');
    const carId = searchParams.get('car');

    if (!openClientId) {
      if (viewingClient) {
        setViewingClient(null);
        setInitialCarFilter(null);
      }
      return;
    }

    if (openClientId !== viewingClient?.id) {
      supabase
        .from('clients')
        .select('*, broker:brokers(id, name), branch:branches(id, name, name_ar), created_by:profiles!clients_created_by_admin_id_fkey(full_name, email)')
        .eq('id', openClientId)
        .is('deleted_at', null)
        .single()
        .then(({ data, error }) => {
          if (data && !error) {
            setViewingClient(data);
            setInitialCarFilter(carId || null);
            // Clear legacy query params if present
            if (searchParams.get('open')) {
              setSearchParams({});
            }
          }
        });
    }
  }, [urlClientId, searchParams, setSearchParams, viewingClient]);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('clients')
        .select('*, broker:brokers(id, name), branch:branches(id, name, name_ar), created_by:profiles!clients_created_by_admin_id_fkey(full_name, email), accident_reports(count)', { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

      if (searchQuery) {
        const normalized = normalizeArabic(searchQuery);
        query = query.or(
          `full_name_normalized.ilike.%${normalized}%,id_number.ilike.%${searchQuery}%,file_number.ilike.%${searchQuery}%,phone_number.ilike.%${searchQuery}%`
        );
      }

      // Apply filters
      if (filters.brokerId !== 'all') {
        query = query.eq('broker_id', filters.brokerId);
      }
      if (filters.ageGroup !== 'all') {
        if (filters.ageGroup === 'under24') {
          query = query.or('under24_type.eq.client,under24_type.eq.additional_driver');
        } else if (filters.ageGroup === 'over24') {
          query = query.or('under24_type.eq.none,under24_type.is.null');
        }
      }
      if (filters.branchId !== 'all') {
        query = query.eq('branch_id', filters.branchId);
      }

      const { data, error, count } = await query;

      if (error) throw error;
      // Map accident count from the nested structure
      const clientsWithAccidentCount = (data || []).map((client: any) => ({
        ...client,
        accident_count: client.accident_reports?.[0]?.count || 0,
      }));
      setClients(clientsWithAccidentCount);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching clients:', error);
      toast({ title: "خطأ", description: "فشل في تحميل العملاء", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, filters, toast]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const handleDelete = async () => {
    if (!deletingClient) return;
    setDeleteLoading(true);
    try {
      // Check if client has active policies
      const { count } = await supabase
        .from('policies')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', deletingClient.id)
        .is('deleted_at', null);

      if (count && count > 0) {
        toast({ 
          title: "لا يمكن الحذف", 
          description: `العميل لديه ${count} معاملة مرتبطة`,
          variant: "destructive" 
        });
        setDeleteLoading(false);
        setDeleteDialogOpen(false);
        setDeletingClient(null);
        return;
      }

      // No policies - archive the client
      const { error } = await supabase
        .from('clients')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deletingClient.id);

      if (error) throw error;
      toast({ title: "تم الحذف", description: "تم حذف العميل بنجاح" });
      fetchClients();
    } catch (error) {
      toast({ title: "خطأ", description: "فشل في حذف العميل", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
      setDeleteDialogOpen(false);
      setDeletingClient(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString('en-GB');
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  if (viewingClient) {
    // Check if we came from a report page - handle proper back navigation
    const fromReportPath = location.state?.from;
    const fromReportTab = location.state?.tab;
    
    return (
      <ClientDetails
        key={viewingClient.id}
        client={viewingClient}
        initialCarFilter={initialCarFilter}
        returnPath={fromReportPath}
        returnTab={fromReportTab}
        onBack={() => {
          // If came from a report, navigate back to it
          if (fromReportPath) {
            navigate(fromReportPath, { state: { tab: fromReportTab } });
          } else {
            setViewingClient(null);
            setInitialCarFilter(null);
            navigate('/clients');
          }
        }}
        onRefresh={() => {
          fetchClients();
          // Refresh the viewing client data
          supabase
            .from('clients')
            .select('*, broker:brokers(id, name), branch:branches(id, name, name_ar), created_by:profiles!clients_created_by_admin_id_fkey(full_name, email)')
            .eq('id', viewingClient.id)
            .single()
            .then(({ data }) => {
              if (data) setViewingClient(data);
            });
        }}
      />
    );
  }

  return (
    <MainLayout>
      <Header
        title="العملاء"
        subtitle="إدارة قاعدة بيانات العملاء"
      />

      <div className="p-6 pb-32 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث بالاسم، رقم الهوية، رقم الملف، الهاتف..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="pr-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                setSelectedClient(null);
                setDrawerOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              إضافة عميل
            </Button>
            <ClientFilters
              filters={filters}
              onFiltersChange={(f) => { setFilters(f); setCurrentPage(1); }}
            />
          </div>
        </div>

        {/* Table */}
        <Card className="border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium">العميل</TableHead>
                  <TableHead className="text-muted-foreground font-medium">رقم الهوية</TableHead>
                  <TableHead className="text-muted-foreground font-medium">رقم الملف</TableHead>
                  <TableHead className="text-muted-foreground font-medium">الهاتف</TableHead>
                  <TableHead className="text-muted-foreground font-medium">هاتف 2</TableHead>
                  <TableHead className="text-muted-foreground font-medium">تاريخ الميلاد</TableHead>
                  <TableHead className="text-muted-foreground font-medium">التوقيع</TableHead>
                  <TableHead className="text-muted-foreground font-medium">الوسيط</TableHead>
                  <TableHead className="text-muted-foreground font-medium">الفرع</TableHead>
                  <TableHead className="text-muted-foreground font-medium">العمر</TableHead>
                  <TableHead className="text-muted-foreground font-medium w-[80px]">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-10 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : clients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      لا توجد بيانات
                    </TableCell>
                  </TableRow>
                ) : (
                  clients.map((client, index) => (
                    <TableRow
                      key={client.id}
                      className={cn(
                        "border-border/30 transition-colors cursor-pointer",
                        "hover:bg-secondary/50 animate-fade-in"
                      )}
                      style={{ animationDelay: `${index * 30}ms` }}
                      onClick={() => navigate(`/clients/${client.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                            <span className="text-sm font-medium text-primary">
                              {client.full_name.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-foreground">{client.full_name}</p>
                              {(client.accident_count || 0) > 0 && (
                                <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" title={`${client.accident_count} بلاغ حادث`} />
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground ltr-nums">
                        {client.id_number}
                      </TableCell>
                      <TableCell>
                        {client.file_number ? (
                          <Badge variant="outline" className="font-mono">
                            {client.file_number}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {client.phone_number ? (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground ltr-nums">
                            <Phone className="h-3 w-3" />
                            {client.phone_number}
                          </div>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {client.phone_number_2 ? (
                          <span className="text-sm text-muted-foreground ltr-nums">
                            {client.phone_number_2}
                          </span>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {client.birth_date ? formatDate(client.birth_date) : "-"}
                      </TableCell>
                      <TableCell>
                        {client.signature_url ? (
                          <Badge variant="success">موقّع</Badge>
                        ) : (
                          <Badge variant="warning">غير موقّع</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {client.broker ? (
                          <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-700 border-amber-500/20">
                            <Users className="h-3 w-3" />
                            {client.broker.name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {client.branch ? (
                          <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-700 border-blue-500/20">
                            <Building2 className="h-3 w-3" />
                            {client.branch.name_ar || client.branch.name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {client.under24_type === 'additional_driver' ? (
                          <Badge variant="warning">سائق إضافي</Badge>
                        ) : client.under24_type === 'client' || client.less_than_24 ? (
                          <Badge variant="warning">أقل من 24</Badge>
                        ) : (
                          <Badge variant="secondary">24+</Badge>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <RowActionsMenu
                          onView={() => navigate(`/clients/${client.id}`)}
                          onEdit={() => {
                            setSelectedClient(client);
                            setDrawerOpen(true);
                          }}
                          onDelete={() => {
                            setDeletingClient(client);
                            setDeleteDialogOpen(true);
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-border/30 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              عرض {clients.length} من {totalCount} عميل
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                صفحة {currentPage} من {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <ClientDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        client={selectedClient}
        onSaved={() => {
          fetchClients();
          setDrawerOpen(false);
        }}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="حذف العميل"
        description={`هل أنت متأكد من حذف العميل "${deletingClient?.full_name}"؟`}
        loading={deleteLoading}
      />
    </MainLayout>
  );
}