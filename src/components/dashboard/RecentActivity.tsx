import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { FileText, Users, Car, CreditCard, Loader2, Search, Filter, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow, startOfDay, endOfDay, isWithinInterval, parseISO, subHours, startOfMonth, endOfMonth } from "date-fns";
import { arDZ as ar } from "date-fns/locale";

interface Activity {
  id: string;
  type: "policy" | "payment" | "client" | "car";
  action: string;
  created_at: string;
  createdBy?: string;
  details: {
    amount?: number;
    payment_type?: string;
    cheque_number?: string;
    policy_type?: string;
    company_name?: string;
    car_number?: string;
    client_id?: string;
    client_name?: string;
    client_file_number?: string;
    insurance_price?: number;
    policy_id?: string;
  };
}

interface GroupedClientActivity {
  clientId: string;
  clientName: string;
  clientFileNumber: string;
  policies: {
    id: string;
    type: string;
    companyName: string;
    carNumber: string;
    price: number;
    createdBy: string;
    createdAt: string;
  }[];
  payments: {
    total: number;
    count: number;
    byType: Record<string, number>;
    items: {
      id: string;
      amount: number;
      paymentType: string;
      policyType: string;
      companyName: string;
      chequeNumber?: string;
      createdBy: string;
      createdAt: string;
    }[];
  };
  cars: {
    id: string;
    carNumber: string;
    action: string;
    createdBy: string;
    createdAt: string;
  }[];
  latestActivityAt: string;
  latestCreatedBy?: string;
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: "نقدًا",
  cheque: "شيك",
  visa: "فيزا",
  transfer: "حوالة",
  credit_card: "بطاقة",
};

const PAYMENT_TYPE_COLORS: Record<string, string> = {
  cash: "bg-green-500/10 text-green-600",
  cheque: "bg-amber-500/10 text-amber-600",
  visa: "bg-blue-500/10 text-blue-600",
  transfer: "bg-purple-500/10 text-purple-600",
  credit_card: "bg-indigo-500/10 text-indigo-600",
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: "إلزامي",
  THIRD_FULL: "شامل",
  ROAD_SERVICE: "خدمة طريق",
  ACCIDENT_FEE_EXEMPTION: "إعفاء حوادث",
  HEALTH: "صحي",
  LIFE: "حياة",
  TRAVEL: "سفر",
  PROPERTY: "ممتلكات",
  BUSINESS: "أعمال",
  OTHER: "أخرى",
};

const typeColors = {
  policy: "text-primary bg-primary/10",
  payment: "text-success bg-success/10",
  client: "text-accent bg-accent/10",
  car: "text-warning bg-warning/10",
};

const typeIcons = {
  policy: FileText,
  payment: CreditCard,
  client: Users,
  car: Car,
};

// Helper function to format date and time
const formatDateTime = (dateStr: string) => {
  const date = new Date(dateStr);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

// Group activities by client
function groupActivitiesByClient(activities: Activity[]): GroupedClientActivity[] {
  const groups = new Map<string, GroupedClientActivity>();

  for (const activity of activities) {
    const clientKey = activity.details.client_id || activity.details.client_name || "unknown";

    if (!groups.has(clientKey)) {
      groups.set(clientKey, {
        clientId: activity.details.client_id || "",
        clientName: activity.details.client_name || "عميل",
        clientFileNumber: activity.details.client_file_number || "",
        policies: [],
        payments: {
          total: 0,
          count: 0,
          byType: {},
          items: [],
        },
        cars: [],
        latestActivityAt: activity.created_at,
        latestCreatedBy: activity.createdBy,
      });
    }

    const group = groups.get(clientKey)!;

    if (activity.type === "payment") {
      const paymentType = activity.details.payment_type || "cash";
      group.payments.total += activity.details.amount || 0;
      group.payments.count += 1;
      group.payments.byType[paymentType] = (group.payments.byType[paymentType] || 0) + (activity.details.amount || 0);
      group.payments.items.push({
        id: activity.id,
        amount: activity.details.amount || 0,
        paymentType,
        policyType: activity.details.policy_type || "",
        companyName: activity.details.company_name || "",
        chequeNumber: activity.details.cheque_number,
        createdBy: activity.createdBy || "",
        createdAt: activity.created_at,
      });
    }

    if (activity.type === "policy") {
      group.policies.push({
        id: activity.id,
        type: activity.details.policy_type || "",
        companyName: activity.details.company_name || "",
        carNumber: activity.details.car_number || "",
        price: activity.details.insurance_price || 0,
        createdBy: activity.createdBy || "",
        createdAt: activity.created_at,
      });
    }

    if (activity.type === "car") {
      group.cars.push({
        id: activity.id,
        carNumber: activity.details.car_number || "",
        action: activity.action,
        createdBy: activity.createdBy || "",
        createdAt: activity.created_at,
      });
    }

    // Update latest activity timestamp
    if (new Date(activity.created_at) > new Date(group.latestActivityAt)) {
      group.latestActivityAt = activity.created_at;
      group.latestCreatedBy = activity.createdBy;
    }
  }

  return Array.from(groups.values())
    .filter((g) => g.payments.count > 0 || g.policies.length > 0 || g.cars.length > 0)
    .sort((a, b) => new Date(b.latestActivityAt).getTime() - new Date(a.latestActivityAt).getTime());
}

// Fetch activities helper function
async function fetchActivities(branchId: string | null, startDate: string, endDate?: string): Promise<Activity[]> {
  const results: Activity[] = [];
  const branchFilter = branchId ? { branch_id: branchId } : {};

  // Fetch policies
  let policiesQuery = supabase
    .from("policies")
    .select(`
      id, created_at, policy_type_parent, policy_type_child, cancelled, insurance_price,
      clients(id, full_name, file_number, deleted_at),
      cars(car_number),
      insurance_companies(name, name_ar),
      created_by_profile:profiles!policies_created_by_admin_id_fkey(full_name)
    `)
    .gte("created_at", startDate)
    .order("created_at", { ascending: false })
    .match(branchFilter)
    .eq("cancelled", false)
    .limit(500);

  if (endDate) {
    policiesQuery = policiesQuery.lte("created_at", endDate);
  }

  const { data: policies } = await policiesQuery;

  if (policies) {
    for (const p of policies) {
      if ((p.clients as any)?.deleted_at) continue;
      const clientName = (p.clients as any)?.full_name || "عميل";
      const fileNumber = (p.clients as any)?.file_number || "";
      const policyLabel = POLICY_TYPE_LABELS[p.policy_type_parent] || p.policy_type_parent || "معاملة";
      const companyName = (p.insurance_companies as any)?.name_ar || (p.insurance_companies as any)?.name || "";
      const carNumber = (p.cars as any)?.car_number || "";

      results.push({
        id: `policy-${p.id}`,
        type: "policy",
        action: "معاملة جديدة",
        created_at: p.created_at,
        createdBy: (p.created_by_profile as any)?.full_name || undefined,
        details: {
          policy_type: policyLabel,
          company_name: companyName,
          car_number: carNumber,
          client_id: (p.clients as any)?.id,
          client_name: clientName,
          client_file_number: fileNumber,
          insurance_price: p.insurance_price || undefined,
          policy_id: p.id,
        },
      });
    }
  }

  // Fetch payments
  let paymentsQuery = supabase
    .from("policy_payments")
    .select(`
      id, created_at, amount, payment_type, cheque_number,
      policies(
        id, cancelled, 
        policy_type_parent,
        insurance_companies(name, name_ar),
        cars(car_number),
        clients(id, full_name, file_number, deleted_at)
      ),
      created_by_profile:profiles!policy_payments_created_by_admin_id_fkey(full_name)
    `)
    .gte("created_at", startDate)
    .order("created_at", { ascending: false })
    .match(branchFilter)
    .limit(500);

  if (endDate) {
    paymentsQuery = paymentsQuery.lte("created_at", endDate);
  }

  const { data: payments } = await paymentsQuery;

  if (payments) {
    for (const pay of payments) {
      if ((pay.policies as any)?.cancelled) continue;
      if ((pay.policies as any)?.clients?.deleted_at) continue;
      if ((pay.policies as any)?.policy_type_parent === "ELZAMI") continue;

      const clientName = (pay.policies as any)?.clients?.full_name || "عميل";
      const fileNumber = (pay.policies as any)?.clients?.file_number || "";
      const policyType = POLICY_TYPE_LABELS[(pay.policies as any)?.policy_type_parent] || "";
      const companyName =
        (pay.policies as any)?.insurance_companies?.name_ar ||
        (pay.policies as any)?.insurance_companies?.name ||
        "";
      const carNumber = (pay.policies as any)?.cars?.car_number || "";

      results.push({
        id: `payment-${pay.id}`,
        type: "payment",
        action: "دفعة مستلمة",
        created_at: pay.created_at,
        createdBy: (pay.created_by_profile as any)?.full_name || undefined,
        details: {
          amount: pay.amount,
          payment_type: pay.payment_type || "cash",
          cheque_number: pay.cheque_number || undefined,
          policy_type: policyType,
          company_name: companyName,
          car_number: carNumber,
          client_id: (pay.policies as any)?.clients?.id,
          client_name: clientName,
          client_file_number: fileNumber,
          policy_id: (pay.policies as any)?.id,
        },
      });
    }
  }

  // Fetch clients
  let clientsQuery = supabase
    .from("clients")
    .select(`
      id, created_at, full_name, file_number,
      created_by_profile:profiles!clients_created_by_admin_id_fkey(full_name)
    `)
    .gte("created_at", startDate)
    .order("created_at", { ascending: false })
    .match(branchFilter)
    .is("deleted_at", null)
    .limit(100);

  if (endDate) {
    clientsQuery = clientsQuery.lte("created_at", endDate);
  }

  const { data: clients } = await clientsQuery;

  if (clients) {
    for (const c of clients) {
      results.push({
        id: `client-${c.id}`,
        type: "client",
        action: "عميل جديد",
        created_at: c.created_at,
        createdBy: (c.created_by_profile as any)?.full_name || undefined,
        details: {
          client_id: c.id,
          client_name: c.full_name,
          client_file_number: c.file_number || "",
        },
      });
    }
  }

  // Fetch cars
  let carsQuery = supabase
    .from("cars")
    .select(`
      id, created_at, updated_at, car_number,
      clients(id, full_name, file_number),
      created_by_profile:profiles!cars_created_by_admin_id_fkey(full_name)
    `)
    .gte("updated_at", startDate)
    .order("updated_at", { ascending: false })
    .match(branchFilter)
    .is("deleted_at", null)
    .limit(100);

  if (endDate) {
    carsQuery = carsQuery.lte("updated_at", endDate);
  }

  const { data: cars } = await carsQuery;

  if (cars) {
    for (const car of cars) {
      const isNew = car.created_at === car.updated_at;
      results.push({
        id: `car-${car.id}`,
        type: "car",
        action: isNew ? "سيارة جديدة" : "تحديث سيارة",
        created_at: car.updated_at,
        createdBy: (car.created_by_profile as any)?.full_name || undefined,
        details: {
          car_number: car.car_number,
          client_id: (car.clients as any)?.id,
          client_name: (car.clients as any)?.full_name || "",
          client_file_number: (car.clients as any)?.file_number || "",
        },
      });
    }
  }

  // Sort all by created_at descending
  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return results;
}

export function RecentActivity() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const branchId = profile?.branch_id;

  const [showDialog, setShowDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [dialogSearch, setDialogSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  // Dashboard query - last 24 hours only
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["recent-activity-24h", branchId],
    queryFn: async () => {
      const twentyFourHoursAgo = subHours(new Date(), 24).toISOString();
      return fetchActivities(branchId || null, twentyFourHoursAgo);
    },
    staleTime: 60 * 1000,
  });

  // Dialog query - current month (fetches when dialog opens)
  const { data: dialogActivities = [], isLoading: isDialogLoading } = useQuery({
    queryKey: ["recent-activity-month", branchId, dateFrom, dateTo],
    queryFn: async () => {
      // If custom date range is set, use that; otherwise use current month
      let start: string;
      let end: string | undefined;

      if (dateFrom) {
        start = startOfDay(parseISO(dateFrom)).toISOString();
        end = dateTo ? endOfDay(parseISO(dateTo)).toISOString() : undefined;
      } else {
        start = startOfMonth(new Date()).toISOString();
        end = endOfMonth(new Date()).toISOString();
      }

      return fetchActivities(branchId || null, start, end);
    },
    enabled: showDialog,
    staleTime: 60 * 1000,
  });

  // Filter for dashboard search
  const filteredActivities = useMemo(() => {
    if (!search.trim()) return activities;
    const searchLower = search.toLowerCase();
    return activities.filter((a) => {
      const text = [
        a.details.client_name,
        a.details.client_file_number,
        a.details.car_number,
        a.details.policy_type,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(searchLower);
    });
  }, [activities, search]);

  // Group for dashboard
  const groupedActivities = useMemo(() => {
    return groupActivitiesByClient(filteredActivities);
  }, [filteredActivities]);

  // Dialog filtered activities
  const dialogFilteredActivities = useMemo(() => {
    let filtered = [...dialogActivities];

    // Type filter
    if (typeFilter !== "all") {
      filtered = filtered.filter((a) => a.type === typeFilter);
    }

    // Search
    if (dialogSearch.trim()) {
      const searchLower = dialogSearch.toLowerCase();
      filtered = filtered.filter((a) => {
        const text = [
          a.details.client_name,
          a.details.client_file_number,
          a.details.car_number,
          a.details.policy_type,
          a.details.company_name,
          a.createdBy,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return text.includes(searchLower);
      });
    }

    return filtered;
  }, [dialogActivities, typeFilter, dialogSearch]);

  const dialogGroupedActivities = useMemo(() => {
    return groupActivitiesByClient(dialogFilteredActivities);
  }, [dialogFilteredActivities]);

  const dialogPaymentTotal = useMemo(() => {
    return dialogFilteredActivities
      .filter((a) => a.type === "payment")
      .reduce((sum, a) => sum + (a.details.amount || 0), 0);
  }, [dialogFilteredActivities]);

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setTypeFilter("all");
    setDialogSearch("");
  };

  const hasActiveFilters = dateFrom || dateTo || typeFilter !== "all" || dialogSearch;

  if (isLoading) {
    return (
      <Card className="border shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">النشاط الأخير</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border shadow-sm">
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-base">النشاط الأخير (24 ساعة)</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDialog(true)}
            className="text-xs text-muted-foreground hover:text-primary gap-1"
          >
            عرض الكل
            <ChevronDown className="h-3 w-3" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث بالاسم، رقم السيارة، نوع التأمين..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-10 h-9 text-sm"
            />
          </div>

          {/* Scrollable Activities */}
          <ScrollArea className="h-[320px] pr-2">
            <div className="space-y-3">
              {groupedActivities.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  لا يوجد نشاط حديث
                </div>
              ) : (
                groupedActivities.map((group) => (
                  <GroupedActivityCard 
                    key={group.clientId || group.clientName} 
                    group={group} 
                    compact 
                    onClientClick={() => group.clientId && navigate(`/clients/${group.clientId}`)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Full Activity Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-xl">سجل النشاط - الشهر الحالي</DialogTitle>
          </DialogHeader>

          {/* Filters */}
          <div className="shrink-0 flex flex-wrap gap-3 pb-4 border-b">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم، رقم الملف، رقم السيارة..."
                value={dialogSearch}
                onChange={(e) => setDialogSearch(e.target.value)}
                className="pr-10"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground whitespace-nowrap">من:</span>
              <ArabicDatePicker value={dateFrom} onChange={setDateFrom} placeholder="تاريخ البداية" compact />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground whitespace-nowrap">إلى:</span>
              <ArabicDatePicker value={dateTo} onChange={setDateTo} placeholder="تاريخ النهاية" compact />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[130px]">
                <Filter className="h-4 w-4 ml-2" />
                <SelectValue placeholder="النوع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="policy">المعاملات</SelectItem>
                <SelectItem value="payment">الدفعات</SelectItem>
                <SelectItem value="client">العملاء</SelectItem>
                <SelectItem value="car">السيارات</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                مسح الفلاتر
              </Button>
            )}
          </div>

          {/* Summary */}
          <div className="shrink-0 flex flex-wrap items-center gap-4 text-sm text-muted-foreground py-2">
            {isDialogLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري التحميل...
              </span>
            ) : (
              <>
                <span>عرض {dialogGroupedActivities.length} عميل ({dialogFilteredActivities.length} نشاط)</span>
                {dialogPaymentTotal > 0 && (
                  <Badge variant="secondary" className="bg-success/10 text-success">
                    مجموع الدفعات: ₪{dialogPaymentTotal.toLocaleString()}
                  </Badge>
                )}
              </>
            )}
          </div>

          {/* Scrollable Content */}
          <ScrollArea className="flex-1 min-h-0 pr-3">
            <div className="space-y-4 pb-4">
              {isDialogLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : dialogGroupedActivities.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">لا توجد نتائج مطابقة</div>
              ) : (
                dialogGroupedActivities.map((group) => (
                  <GroupedActivityCard 
                    key={group.clientId || group.clientName} 
                    group={group}
                    onClientClick={() => group.clientId && navigate(`/clients/${group.clientId}`)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Grouped Activity Card Component
function GroupedActivityCard({ 
  group, 
  compact = false, 
  onClientClick 
}: { 
  group: GroupedClientActivity; 
  compact?: boolean;
  onClientClick?: () => void;
}) {
  const hasPayments = group.payments.count > 0;
  const hasPolicies = group.policies.length > 0;
  const hasCars = group.cars.length > 0;

  const mainType = hasPayments ? "payment" : hasPolicies ? "policy" : hasCars ? "car" : "client";
  const Icon = typeIcons[mainType];

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 transition-all hover:shadow-sm",
        compact ? "space-y-2" : "space-y-3"
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={cn("rounded-lg p-2", typeColors[mainType])}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                onClick={onClientClick}
                className="font-semibold text-foreground truncate hover:text-primary hover:underline transition-colors text-right"
              >
                {group.clientName}
              </button>
              {group.clientFileNumber && (
                <Badge variant="outline" className="text-[10px] px-1.5">
                  {group.clientFileNumber}
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDistanceToNow(new Date(group.latestActivityAt), { addSuffix: true, locale: ar })}
            </span>
          </div>

          {group.latestCreatedBy && (
            <span className="text-xs text-muted-foreground">بواسطة {group.latestCreatedBy}</span>
          )}
        </div>
      </div>

      {/* Payments Summary */}
      {hasPayments && (
        <div className={cn("bg-muted/50 rounded-lg p-2", compact ? "space-y-1" : "space-y-2")}>
          <div className="flex items-center justify-end">
            <span className="font-bold text-success ltr-nums">₪{group.payments.total.toLocaleString()}</span>
          </div>

          {/* Payment Type Breakdown */}
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(group.payments.byType).map(([type, amount]) => (
              <Badge
                key={type}
                variant="outline"
                className={cn("text-[10px] px-1.5 py-0", PAYMENT_TYPE_COLORS[type])}
              >
                {PAYMENT_TYPE_LABELS[type] || type}: ₪{amount.toLocaleString()}
              </Badge>
            ))}
          </div>

          {/* Policy info from first payment - changed → to + */}
          {group.payments.items[0] && (group.payments.items[0].policyType || group.payments.items[0].companyName) && (
            <div className="text-xs text-muted-foreground">
              {group.payments.items[0].policyType}
              {group.payments.items[0].companyName && ` + ${group.payments.items[0].companyName}`}
            </div>
          )}

          {/* Detailed payment items in dialog view - with creator name and datetime */}
          {!compact && group.payments.items.length > 0 && (
            <div className="border-t pt-2 mt-2 space-y-2">
              <span className="text-xs text-muted-foreground font-medium">تفاصيل الدفعات:</span>
              {group.payments.items.map((item) => (
                <div key={item.id} className="flex flex-col gap-0.5 text-xs border-b last:border-0 pb-1.5 last:pb-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] px-1", PAYMENT_TYPE_COLORS[item.paymentType])}
                      >
                        {PAYMENT_TYPE_LABELS[item.paymentType] || item.paymentType}
                      </Badge>
                      {item.chequeNumber && <span className="text-muted-foreground">#{item.chequeNumber}</span>}
                      <span className="text-muted-foreground">
                        {item.policyType}
                        {item.companyName && ` + ${item.companyName}`}
                      </span>
                    </div>
                    <span className="font-medium ltr-nums">₪{item.amount.toLocaleString()}</span>
                  </div>
                  {/* Creator name + datetime */}
                  <div className="text-[10px] text-muted-foreground">
                    {item.createdBy && <span>{item.createdBy}</span>}
                    {item.createdBy && item.createdAt && <span> • </span>}
                    {item.createdAt && <span>{formatDateTime(item.createdAt)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Policies - changed → to + */}
      {hasPolicies && !compact && (
        <div className="bg-primary/5 rounded-lg p-2 space-y-1">
          <span className="text-xs font-medium text-primary">المعاملات ({group.policies.length})</span>
          {group.policies.map((policy) => (
            <div key={policy.id} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span>{policy.type}</span>
                  {policy.companyName && <span className="text-muted-foreground">+ {policy.companyName}</span>}
                  {policy.carNumber && (
                    <Badge variant="outline" className="text-[10px] px-1">
                      {policy.carNumber}
                    </Badge>
                  )}
                </div>
                {policy.price > 0 && <span className="font-medium ltr-nums">₪{policy.price.toLocaleString()}</span>}
              </div>
              {/* Creator + datetime for policies */}
              <div className="text-[10px] text-muted-foreground">
                {policy.createdBy && <span>{policy.createdBy}</span>}
                {policy.createdBy && policy.createdAt && <span> • </span>}
                {policy.createdAt && <span>{formatDateTime(policy.createdAt)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cars */}
      {hasCars && !compact && (
        <div className="bg-warning/5 rounded-lg p-2 space-y-1">
          <span className="text-xs font-medium text-warning">السيارات ({group.cars.length})</span>
          {group.cars.map((car) => (
            <div key={car.id} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between text-xs">
                <span>{car.action}</span>
                <Badge variant="outline" className="text-[10px] px-1">
                  {car.carNumber}
                </Badge>
              </div>
              {/* Creator + datetime for cars */}
              <div className="text-[10px] text-muted-foreground">
                {car.createdBy && <span>{car.createdBy}</span>}
                {car.createdBy && car.createdAt && <span> • </span>}
                {car.createdAt && <span>{formatDateTime(car.createdAt)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Compact: Single line summary for policies/cars - changed → to + */}
      {compact && (hasPolicies || hasCars) && !hasPayments && (
        <div className="text-xs text-muted-foreground">
          {hasPolicies && (
            <span>
              {group.policies[0].type}
              {group.policies[0].companyName && ` + ${group.policies[0].companyName}`}
              {group.policies[0].price > 0 && ` | ₪${group.policies[0].price.toLocaleString()}`}
            </span>
          )}
          {hasCars && !hasPolicies && (
            <span>
              {group.cars[0].action}: {group.cars[0].carNumber}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
