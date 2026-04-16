import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
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
  Filter,
  ChevronLeft,
  ChevronRight,
  Phone,
  FileText,
  CalendarIcon,
  X,
  Wallet,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BrokerDrawer } from "@/components/brokers/BrokerDrawer";
import { BrokerDetails } from "@/components/brokers/BrokerDetails";
import { RowActionsMenu } from "@/components/shared/RowActionsMenu";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { format } from "date-fns";

interface Broker {
  id: string;
  name: string;
  phone: string | null;
  image_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface BrokerWithStats extends Broker {
  client_count: number;
  policy_count: number;
  total_collected: number;
  total_remaining: number;
}

export default function Brokers() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [brokers, setBrokers] = useState<BrokerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 25;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState<Broker | null>(null);
  const [viewingBroker, setViewingBroker] = useState<Broker | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingBroker, setDeletingBroker] = useState<Broker | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  
  // Date filter state
  const [showFilters, setShowFilters] = useState(false);
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);

  const fetchBrokers = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch brokers with pagination
      let query = supabase
        .from('brokers')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

      if (searchQuery) {
        query = query.or(`name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`);
      }

      const { data: brokersData, error, count } = await query;

      if (error) throw error;
      
      // Fetch stats for each broker
      const brokersWithStats: BrokerWithStats[] = await Promise.all(
        (brokersData || []).map(async (broker) => {
          // Get client count
          const { count: clientCount } = await supabase
            .from('clients')
            .select('*', { count: 'exact', head: true })
            .eq('broker_id', broker.id)
            .is('deleted_at', null);

          // Get policies for this broker with date filter
          let policyQuery = supabase
            .from('policies')
            .select('id, insurance_price, broker_direction, broker_buy_price')
            .eq('broker_id', broker.id)
            .is('deleted_at', null);

          if (startDate) {
            policyQuery = policyQuery.gte('start_date', format(startDate, 'yyyy-MM-dd'));
          }
          if (endDate) {
            policyQuery = policyQuery.lte('start_date', format(endDate, 'yyyy-MM-dd'));
          }

          const { data: policies } = await policyQuery;

          const policyIds = policies?.map(p => p.id) || [];
          
          // Get payments for these policies
          let totalCollected = 0;
          if (policyIds.length > 0) {
            const { data: payments } = await supabase
              .from('policy_payments')
              .select('amount, refused')
              .in('policy_id', policyIds);
            
            totalCollected = payments?.filter(p => !p.refused).reduce((sum, p) => sum + Number(p.amount), 0) || 0;
          }

          // Calculate broker balance based on direction
          // to_broker = I made for broker (he owes me the insurance_price)
          // from_broker = broker made for me (I owe him the broker_buy_price)
          const toBrokerPolicies = policies?.filter(p => p.broker_direction === 'to_broker') || [];
          const fromBrokerPolicies = policies?.filter(p => p.broker_direction === 'from_broker') || [];
          
          // For to_broker: use insurance_price (what broker owes me)
          const toBrokerTotal = toBrokerPolicies.reduce((sum, p) => sum + Number(p.insurance_price), 0);
          // For from_broker: use broker_buy_price (what I owe broker)
          const fromBrokerTotal = fromBrokerPolicies.reduce((sum, p) => sum + (Number(p.broker_buy_price) || Number(p.insurance_price)), 0);
          
          // Net balance: what broker owes me (positive) or what I owe broker (negative)
          const netBalance = toBrokerTotal - fromBrokerTotal;

          return {
            ...broker,
            client_count: clientCount || 0,
            policy_count: policies?.length || 0,
            total_collected: totalCollected,
            total_remaining: netBalance, // This is now "لي عليه" (what broker owes me)
          };
        })
      );

      setBrokers(brokersWithStats);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching brokers:', error);
      toast({ title: "خطأ", description: "فشل في تحميل الوسطاء", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, startDate, endDate, toast]);

  useEffect(() => {
    fetchBrokers();
  }, [fetchBrokers]);

  const handleDelete = async () => {
    if (!deletingBroker) return;
    setDeleteLoading(true);
    try {
      const { error } = await supabase
        .from('brokers')
        .delete()
        .eq('id', deletingBroker.id);

      if (error) throw error;
      toast({ title: "تم الحذف", description: "تم حذف الوسيط بنجاح" });
      fetchBrokers();
    } catch (error) {
      toast({ title: "خطأ", description: "فشل في حذف الوسيط", variant: "destructive" });
    } finally {
      setDeleteLoading(false);
      setDeleteDialogOpen(false);
      setDeletingBroker(null);
    }
  };

  const formatCurrency = (amount: number) => {
    return `₪${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  const clearDateFilter = () => {
    setStartDate(undefined);
    setEndDate(undefined);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  if (viewingBroker) {
    return (
      <>
        <BrokerDetails
          broker={viewingBroker}
          onBack={() => setViewingBroker(null)}
          onEdit={() => {
            setSelectedBroker(viewingBroker);
            setDrawerOpen(true);
          }}
          onRefresh={() => {
            fetchBrokers();
            supabase
              .from('brokers')
              .select('*')
              .eq('id', viewingBroker.id)
              .single()
              .then(({ data }) => {
                if (data) setViewingBroker(data);
              });
          }}
        />

        <BrokerDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          broker={selectedBroker || viewingBroker}
          onSaved={() => {
            fetchBrokers();
            setDrawerOpen(false);
            supabase
              .from('brokers')
              .select('*')
              .eq('id', viewingBroker.id)
              .single()
              .then(({ data }) => {
                if (data) setViewingBroker(data);
              });
          }}
        />
      </>
    );
  }

  return (
    <MainLayout>
      <Header
        title="الوسطاء"
        subtitle="إدارة الوسطاء والعمولات"
        action={{
          label: "إضافة وسيط",
          onClick: () => {
            setSelectedBroker(null);
            setDrawerOpen(true);
          },
        }}
      />

      <div className="p-6 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث بالاسم أو رقم الهاتف..."
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
              variant={showFilters ? "default" : "outline"} 
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="ml-2 h-4 w-4" />
              فلترة
              {(startDate || endDate) && (
                <span className="mr-1 bg-primary-foreground text-primary rounded-full px-1.5 text-xs">!</span>
              )}
            </Button>
          </div>
        </div>

        {/* Date Filter Panel */}
        {showFilters && (
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label>من تاريخ</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-[180px] justify-start text-right", !startDate && "text-muted-foreground")}>
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {startDate ? format(startDate, "yyyy/MM/dd") : "اختر التاريخ"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>إلى تاريخ</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-[180px] justify-start text-right", !endDate && "text-muted-foreground")}>
                      <CalendarIcon className="ml-2 h-4 w-4" />
                      {endDate ? format(endDate, "yyyy/MM/dd") : "اختر التاريخ"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              {(startDate || endDate) && (
                <Button variant="ghost" size="sm" onClick={clearDateFilter}>
                  <X className="h-4 w-4 ml-1" />
                  مسح الفلتر
                </Button>
              )}
            </div>
          </Card>
        )}

        {/* Table */}
        <Card className="border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="text-muted-foreground font-medium">الوسيط</TableHead>
                  <TableHead className="text-muted-foreground font-medium">الهاتف</TableHead>
                  <TableHead className="text-muted-foreground font-medium text-center">الوثائق</TableHead>
                  <TableHead className="text-muted-foreground font-medium">إجمالي المستحق</TableHead>
                  <TableHead className="text-muted-foreground font-medium w-[80px]">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-10 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : brokers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      لا توجد بيانات
                    </TableCell>
                  </TableRow>
                ) : (
                  brokers.map((broker, index) => (
                    <TableRow
                      key={broker.id}
                      className={cn(
                        "border-border/30 transition-colors cursor-pointer",
                        "hover:bg-secondary/50 animate-fade-in"
                      )}
                      style={{ animationDelay: `${index * 30}ms` }}
                      onClick={() => setViewingBroker(broker)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                            <span className="text-sm font-medium text-primary">
                              {broker.name.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{broker.name}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {broker.phone ? (
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            <bdi>{broker.phone}</bdi>
                          </div>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1 text-sm">
                          <FileText className="h-3 w-3 text-muted-foreground" />
                          <span>{broker.policy_count}</span>
                        </div>
                      </TableCell>
                      <TableCell className={cn(
                        "font-medium",
                        broker.total_remaining > 0 ? "text-success" : broker.total_remaining < 0 ? "text-destructive" : "text-muted-foreground"
                      )}>
                        {broker.total_remaining < 0 && "-"}
                        {formatCurrency(Math.abs(broker.total_remaining))}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => navigate(`/brokers/${broker.id}/wallet`)}
                            title="محفظة الوسيط"
                          >
                            <Wallet className="h-4 w-4" />
                          </Button>
                          <RowActionsMenu
                            onView={() => setViewingBroker(broker)}
                            onEdit={() => {
                              setSelectedBroker(broker);
                              setDrawerOpen(true);
                            }}
                            onDelete={() => {
                              setDeletingBroker(broker);
                              setDeleteDialogOpen(true);
                            }}
                          />
                        </div>
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
              عرض {brokers.length} من {totalCount} وسيط
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

      <BrokerDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        broker={selectedBroker}
        onSaved={() => {
          fetchBrokers();
          setDrawerOpen(false);
        }}
      />

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="حذف الوسيط"
        description={`هل أنت متأكد من حذف الوسيط "${deletingBroker?.name}"؟`}
        loading={deleteLoading}
      />
    </MainLayout>
  );
}
