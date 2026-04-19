import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Plus, Search, Wrench, Building2, FileText, Calendar, Car, 
  Clock, MessageSquare, Eye, MoreVertical, Trash2, Pencil 
} from "lucide-react";
import { format } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { RepairClaimDrawer } from "@/components/claims/RepairClaimDrawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type ClaimStatus = "open" | "in_progress" | "completed";

interface RepairClaim {
  id: string;
  claim_number: string;
  garage_name: string;
  insurance_company_id: string | null;
  insurance_file_number: string | null;
  accident_date: string | null;
  car_type: string;
  external_car_number: string | null;
  external_car_model: string | null;
  client_id: string | null;
  policy_id: string | null;
  status: ClaimStatus;
  total_amount: number | null;
  notes: string | null;
  created_at: string;
  insurance_company?: { name: string; name_ar: string | null } | null;
  client?: { full_name: string } | null;
  policy?: { policy_type_parent: string; policy_type_child: string | null } | null;
  notes_count?: number;
  reminders_count?: number;
}

const STATUS_CONFIG: Record<ClaimStatus, { label: string; color: string }> = {
  open: { label: "مفتوح", color: "bg-primary/10 text-primary" },
  in_progress: { label: "قيد التنفيذ", color: "bg-accent text-accent-foreground" },
  completed: { label: "مكتمل", color: "bg-muted text-muted-foreground" },
};

export default function RepairClaims() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | "all">("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<RepairClaim | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [claimToDelete, setClaimToDelete] = useState<RepairClaim | null>(null);

  // Fetch claims with relations
  const { data: claims, isLoading } = useQuery({
    queryKey: ["repair-claims", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("repair_claims")
        .select(`
          *,
          insurance_company:insurance_companies(name, name_ar),
          client:clients(full_name),
          policy:policies(policy_type_parent, policy_type_child)
        `)
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch notes and reminders count for each claim
      const claimIds = data?.map(c => c.id) || [];
      
      const [notesResult, remindersResult] = await Promise.all([
        supabase
          .from("repair_claim_notes")
          .select("claim_id")
          .in("claim_id", claimIds),
        supabase
          .from("repair_claim_reminders")
          .select("claim_id")
          .in("claim_id", claimIds)
          .eq("is_done", false),
      ]);

      const notesCounts = (notesResult.data || []).reduce((acc, n) => {
        acc[n.claim_id] = (acc[n.claim_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const remindersCounts = (remindersResult.data || []).reduce((acc, r) => {
        acc[r.claim_id] = (acc[r.claim_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return data?.map(claim => ({
        ...claim,
        notes_count: notesCounts[claim.id] || 0,
        reminders_count: remindersCounts[claim.id] || 0,
      })) as RepairClaim[];
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (claimId: string) => {
      const { error } = await supabase
        .from("repair_claims")
        .delete()
        .eq("id", claimId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repair-claims"] });
      toast.success("تم حذف المطالبة بنجاح");
      setDeleteDialogOpen(false);
      setClaimToDelete(null);
    },
    onError: () => {
      toast.error("حدث خطأ أثناء حذف المطالبة");
    },
  });

  // Filter claims by search
  const filteredClaims = useMemo(() => {
    if (!claims) return [];
    if (!searchQuery) return claims;
    
    const query = searchQuery.toLowerCase();
    return claims.filter(claim => 
      claim.claim_number?.toLowerCase().includes(query) ||
      claim.garage_name?.toLowerCase().includes(query) ||
      claim.insurance_file_number?.toLowerCase().includes(query) ||
      claim.client?.full_name?.toLowerCase().includes(query)
    );
  }, [claims, searchQuery]);

  const handleOpenDrawer = (claim?: RepairClaim) => {
    setSelectedClaim(claim || null);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedClaim(null);
  };

  const handleDeleteClick = (claim: RepairClaim) => {
    setClaimToDelete(claim);
    setDeleteDialogOpen(true);
  };

  const getCarDisplay = (claim: RepairClaim) => {
    if (claim.car_type === "external") {
      return claim.external_car_number 
        ? `${claim.external_car_number} ${claim.external_car_model || ""}`
        : "سيارة خارجية";
    }
    if (claim.client) {
      const policyType = claim.policy?.policy_type_parent === "THIRD_PARTY" 
        ? "ثالث" 
        : claim.policy?.policy_type_parent === "ROAD_SERVICE"
        ? "خدمات طريق"
        : "";
      return `${claim.client.full_name}${policyType ? ` (${policyType})` : ""}`;
    }
    return "مؤمن";
  };

  return (
    <MainLayout>
      <Header
        title="المطالبات"
        subtitle="تتبع تصليحات السيارات والملفات"
      />

      <div className="p-6 space-y-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="بحث بالاسم أو رقم الملف..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
              dir="rtl"
            />
          </div>
          
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => handleOpenDrawer()}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              إضافة مطالبة
            </Button>
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("all")}
            >
              الكل
            </Button>
            {(Object.keys(STATUS_CONFIG) as ClaimStatus[]).map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(status)}
              >
                {STATUS_CONFIG[status].label}
              </Button>
            ))}
          </div>
        </div>

        {/* Claims Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : filteredClaims.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            لا توجد مطالبات
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredClaims.map((claim) => (
              <Card 
                key={claim.id} 
                className="hover:shadow-lg transition-shadow cursor-pointer group"
              >
                <CardContent className="p-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-medium text-primary">
                      {claim.claim_number}
                    </span>
                    <Badge className={STATUS_CONFIG[claim.status].color}>
                      {STATUS_CONFIG[claim.status].label}
                    </Badge>
                  </div>

                  <div className="border-t border-border pt-3 space-y-2 text-sm">
                    {/* Garage */}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Wrench className="h-4 w-4" />
                      <span>كراج: {claim.garage_name}</span>
                    </div>

                    {/* Insurance Company */}
                    {claim.insurance_company && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Building2 className="h-4 w-4" />
                        <span>شركة: {claim.insurance_company.name_ar || claim.insurance_company.name}</span>
                      </div>
                    )}

                    {/* File Number */}
                    {claim.insurance_file_number && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        <span>ملف: {claim.insurance_file_number}</span>
                      </div>
                    )}

                    {/* Accident Date */}
                    {claim.accident_date && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span>
                          تاريخ الحادث: {format(new Date(claim.accident_date), "dd/MM/yyyy", { locale: ar })}
                        </span>
                      </div>
                    )}

                    {/* Car */}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Car className="h-4 w-4" />
                      <span>{getCarDisplay(claim)}</span>
                    </div>

                    {/* Amount if completed */}
                    {claim.status === "completed" && claim.total_amount && (
                      <div className="text-primary font-medium">
                        المبلغ: ₪{claim.total_amount.toLocaleString()}
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-3">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{claim.reminders_count} تذكيرات</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>{claim.notes_count} ملاحظات</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2">
                    <Button 
                      size="sm" 
                      onClick={() => navigate(`/admin/claims/${claim.id}`)}
                      className="flex-1"
                    >
                      <Eye className="h-4 w-4 ml-1" />
                      فتح
                    </Button>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleOpenDrawer(claim)}>
                          <Pencil className="h-4 w-4 ml-2" />
                          تعديل
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleDeleteClick(claim)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 ml-2" />
                          حذف
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Drawer */}
      <RepairClaimDrawer
        open={drawerOpen}
        onOpenChange={handleCloseDrawer}
        claim={selectedClaim}
      />

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المطالبة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف المطالبة {claimToDelete?.claim_number}؟ 
              سيتم حذف جميع الملاحظات والتذكيرات المرتبطة بها.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => claimToDelete && deleteMutation.mutate(claimToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
