import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { PolicyDetailsDrawer } from "@/components/policies/PolicyDetailsDrawer";
import { PolicyEditDrawer } from "@/components/policies/PolicyEditDrawer";
import { PolicyFilters, PolicyFilterValues } from "@/components/policies/PolicyFilters";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { PolicyTableView } from "@/components/policies/PolicyTableView";
import { recalculatePolicyProfit } from "@/lib/pricingCalculator";
import { usePolicyWizardController } from "@/hooks/usePolicyWizardController";

interface PolicyRecord {
  id: string;
  client_id: string;
  car_id: string;
  company_id: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  office_commission: number | null;
  profit: number | null;
  payed_for_company: number | null;
  elzami_cost: number | null;
  cancelled: boolean | null;
  transferred: boolean | null;
  transferred_car_number: string | null;
  is_under_24: boolean | null;
  notes: string | null;
  broker_id: string | null;
  created_by_admin_id: string | null;
  group_id: string | null;
  branch_id: string | null;
  created_at?: string;
  road_service_id?: string | null;
  accident_fee_service_id?: string | null;
  clients?: {
    id: string;
    full_name: string;
    less_than_24: boolean | null;
    under24_type?: 'none' | 'client' | 'additional_driver' | null;
    under24_driver_name?: string | null;
    under24_driver_id?: string | null;
    phone_number?: string | null;
    file_number?: string | null;
  };
  cars?: {
    id: string;
    car_number: string;
    car_type: string | null;
    car_value: number | null;
    year: number | null;
  };
  insurance_companies?: {
    id: string;
    name: string;
    name_ar: string | null;
  };
  road_services?: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  accident_fee_services?: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
  created_by?: {
    full_name: string | null;
    email: string;
  };
  branch?: {
    id: string;
    name: string;
    name_ar: string | null;
  };
}


export default function Policies() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { openWizard } = usePolicyWizardController();
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState<PolicyFilterValues>({
    policyType: 'all',
    companyId: 'all',
    status: 'all',
    brokerId: 'all',
    creatorId: 'all',
    branchId: 'all',
    datePreset: 'all',
    dateFrom: '',
    dateTo: '',
    year: 'all',
  });
  const pageSize = 25;

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [selectedPolicyForEdit, setSelectedPolicyForEdit] = useState<PolicyRecord | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingPolicy, setDeletingPolicy] = useState<PolicyRecord | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcProgress, setRecalcProgress] = useState({ done: 0, total: 0, startTime: 0, avgTime: 0 });
  const cancelRecalcRef = useRef(false);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('policies')
        .select(`
          *,
          clients(id, full_name, phone_number, file_number, less_than_24, under24_type, under24_driver_name, under24_driver_id),
          cars(id, car_number, car_type, car_value, year),
          insurance_companies(id, name, name_ar),
          road_services(id, name, name_ar),
          accident_fee_services(id, name, name_ar),
          created_by:profiles!policies_created_by_admin_id_fkey(full_name, email),
          branch:branches(id, name, name_ar),
          group_id
        `, { count: 'exact' })
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

      // Apply filters
      if (filters.policyType !== 'all') {
        query = query.eq('policy_type_parent', filters.policyType as any);
      }
      if (filters.companyId !== 'all') {
        query = query.eq('company_id', filters.companyId);
      }
      if (filters.brokerId !== 'all') {
        query = query.eq('broker_id', filters.brokerId);
      }
      if (filters.creatorId !== 'all') {
        query = query.eq('created_by_admin_id', filters.creatorId);
      }
      if (filters.status !== 'all') {
        const today = new Date().toISOString().split('T')[0];
        if (filters.status === 'cancelled') {
          query = query.eq('cancelled', true);
        } else if (filters.status === 'transferred') {
          query = query.eq('transferred', true);
        } else if (filters.status === 'expired') {
          query = query.lt('end_date', today).eq('cancelled', false);
        } else if (filters.status === 'active') {
          query = query.gte('end_date', today).eq('cancelled', false).eq('transferred', false);
        }
      }
      if (filters.branchId !== 'all') {
        query = query.eq('branch_id', filters.branchId);
      }
      
      // Date filters
      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo + 'T23:59:59');
      }

      const { data, error, count } = await query;

      if (error) throw error;
      setPolicies(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error fetching policies:', error);
      toast({ title: "خطأ", description: "فشل في تحميل الوثائق", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentPage, searchQuery, filters, toast]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  useEffect(() => {
    const handler = () => fetchPolicies();
    window.addEventListener("thiqa:policy-created", handler);
    return () => window.removeEventListener("thiqa:policy-created", handler);
  }, [fetchPolicies]);

  // Optimistic delete - remove from UI immediately
  const handleDelete = async () => {
    if (!deletingPolicy) return;
    
    // Optimistic: Remove from local state immediately
    const deletedId = deletingPolicy.id;
    setPolicies(prev => prev.filter(p => p.id !== deletedId));
    setTotalCount(prev => prev - 1);
    setDeleteDialogOpen(false);
    setDeletingPolicy(null);
    toast({ title: "تم الحذف", description: "تم حذف الوثيقة بنجاح" });
    
    // Background: Do the actual delete
    try {
      const { error } = await supabase
        .from('policies')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deletedId);

      if (error) {
        // Rollback on error - refetch
        console.error('Delete failed, refetching:', error);
        fetchPolicies();
      }
    } catch (error) {
      console.error('Delete error:', error);
      fetchPolicies();
    }
  };

  const handleCancelRecalculation = () => {
    cancelRecalcRef.current = true;
    toast({ title: "جاري الإلغاء", description: "سيتم إيقاف إعادة الحساب بعد الوثيقة الحالية" });
  };

  const handleRecalculateAll = async () => {
    setRecalculating(true);
    cancelRecalcRef.current = false;
    const startTime = Date.now();
    try {
      // First, get the total count
      const { count: totalCount, error: countError } = await supabase
        .from('policies')
        .select('*', { count: 'exact', head: true })
        .is('deleted_at', null);

      if (countError) throw countError;
      if (!totalCount || totalCount === 0) {
        toast({ title: "لا توجد وثائق", description: "لا توجد وثائق لإعادة حسابها" });
        return;
      }

      setRecalcProgress({ done: 0, total: totalCount, startTime, avgTime: 0 });

      // Fetch all policy IDs in batches to avoid the 1000 limit
      const batchSize = 1000;
      let allPolicyIds: string[] = [];
      
      for (let offset = 0; offset < totalCount; offset += batchSize) {
        const { data: batchPolicies, error: batchError } = await supabase
          .from('policies')
          .select('id')
          .is('deleted_at', null)
          .range(offset, offset + batchSize - 1);
        
        if (batchError) throw batchError;
        if (batchPolicies) {
          allPolicyIds = [...allPolicyIds, ...batchPolicies.map(p => p.id)];
        }
      }

      let successCount = 0;
      let errorCount = 0;

      // Process policies one by one
      for (let i = 0; i < allPolicyIds.length; i++) {
        // Check for cancellation
        if (cancelRecalcRef.current) {
          toast({ 
            title: "تم الإلغاء", 
            description: `تم تحديث ${successCount} وثيقة قبل الإلغاء` 
          });
          break;
        }

        const result = await recalculatePolicyProfit(allPolicyIds[i]);
        if (result) {
          successCount++;
        } else {
          errorCount++;
        }
        
        // Calculate average time and update progress
        const elapsed = Date.now() - startTime;
        const avgTime = elapsed / (i + 1);
        setRecalcProgress({ 
          done: i + 1, 
          total: allPolicyIds.length, 
          startTime, 
          avgTime 
        });
      }

      if (!cancelRecalcRef.current) {
        toast({
          title: "تم إعادة الحساب",
          description: `تم تحديث ${successCount} وثيقة${errorCount > 0 ? `، فشل ${errorCount}` : ''}`,
        });
      }

      fetchPolicies();
    } catch (error) {
      console.error('Error recalculating:', error);
      toast({ title: "خطأ", description: "فشل في إعادة حساب الأرباح", variant: "destructive" });
    } finally {
      setRecalculating(false);
      setRecalcProgress({ done: 0, total: 0, startTime: 0, avgTime: 0 });
      cancelRecalcRef.current = false;
    }
  };

  const handleViewDetails = (policyId: string) => {
    setSelectedPolicyId(policyId);
    setDetailsOpen(true);
  };

  const handleEditPolicy = (policy: PolicyRecord) => {
    setSelectedPolicyForEdit(policy);
    setEditOpen(true);
  };

  // Format time remaining for recalculation
  const formatTimeRemaining = () => {
    if (!recalcProgress.avgTime || recalcProgress.done === 0) return '';
    const remaining = recalcProgress.total - recalcProgress.done;
    const msRemaining = remaining * recalcProgress.avgTime;
    const seconds = Math.ceil(msRemaining / 1000);
    if (seconds < 60) return `${seconds} ث`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')} د`;
  };

  const percentComplete = recalcProgress.total > 0 
    ? Math.round((recalcProgress.done / recalcProgress.total) * 100) 
    : 0;

  const totalPages = Math.ceil(totalCount / pageSize);

  // Prepare policy for edit drawer
  const prepareForEdit = (policy: PolicyRecord) => {
    return {
      id: policy.id,
      policy_type_parent: policy.policy_type_parent,
      policy_type_child: policy.policy_type_child,
      start_date: policy.start_date,
      end_date: policy.end_date,
      insurance_price: policy.insurance_price,
      cancelled: policy.cancelled,
      transferred: policy.transferred,
      transferred_car_number: policy.transferred_car_number,
      is_under_24: policy.is_under_24,
      notes: policy.notes,
      broker_id: policy.broker_id,
      clients: {
        id: policy.clients?.id || '',
        full_name: policy.clients?.full_name || '',
        less_than_24: policy.clients?.less_than_24 || false,
      },
      cars: {
        id: policy.cars?.id || '',
        car_number: policy.cars?.car_number || '',
        car_type: policy.cars?.car_type || null,
        car_value: policy.cars?.car_value || null,
        year: policy.cars?.year || null,
      },
      insurance_companies: {
        id: policy.insurance_companies?.id || '',
        name: policy.insurance_companies?.name || '',
        name_ar: policy.insurance_companies?.name_ar || null,
      },
    };
  };

  return (
    <MainLayout>
      <Header
        title="الوثائق"
        subtitle="إدارة وثائق التأمين"
        action={{
          label: "وثيقة جديدة",
          onClick: () => openWizard(),
        }}
      />

      <div className="p-6 space-y-4">

        {/* Toolbar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث في الوثائق..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="pr-9"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <PolicyFilters 
              filters={filters} 
              onFiltersChange={(f) => { setFilters(f); setCurrentPage(1); }} 
            />
            {/* Recalculate button - Admin only */}
            {isAdmin && (
              recalculating ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg border">
                  <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                  <div className="flex flex-col text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{percentComplete}%</span>
                      <span className="text-muted-foreground">({recalcProgress.done}/{recalcProgress.total})</span>
                    </div>
                    {formatTimeRemaining() && (
                      <span className="text-muted-foreground">متبقي: {formatTimeRemaining()}</span>
                    )}
                  </div>
                  <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300" 
                      style={{ width: `${percentComplete}%` }} 
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleCancelRecalculation}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleRecalculateAll}
                >
                  <RefreshCw className="ml-1 md:ml-2 h-4 w-4" />
                  <span className="hidden sm:inline">إعادة حساب الأرباح</span>
                  <span className="sm:hidden">حساب</span>
                </Button>
              )
            )}
          </div>
        </div>

        {/* Table View - with frontend search filter */}
        <PolicyTableView
          policies={policies}
          loading={loading}
          onPolicyClick={handleViewDetails}
          searchQuery={searchQuery}
        />

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 bg-card rounded-lg border">
          <p className="text-sm text-muted-foreground">
            عرض {policies.length} من {totalCount} وثيقة
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
      </div>

      <PolicyDetailsDrawer
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        policyId={selectedPolicyId}
        onUpdated={() => {
          // Immediate refresh without delay
          fetchPolicies();
        }}
        onViewRelatedPolicy={(policyId) => {
          setSelectedPolicyId(policyId);
          setDetailsOpen(true);
        }}
      />

      {selectedPolicyForEdit && (
        <PolicyEditDrawer
          open={editOpen}
          onOpenChange={(open) => {
            setEditOpen(open);
            if (!open) setSelectedPolicyForEdit(null);
          }}
          policy={prepareForEdit(selectedPolicyForEdit)}
          onSaved={() => {
            // Optimistic: Update local state immediately
            setEditOpen(false);
            setSelectedPolicyForEdit(null);
            // Silent background refresh
            setTimeout(() => fetchPolicies(), 500);
          }}
        />
      )}

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="حذف الوثيقة"
        description="هل أنت متأكد من حذف هذه الوثيقة؟ سيتم حذف كل الدفعات والملفات التابعة لها."
      />
    </MainLayout>
  );
}
