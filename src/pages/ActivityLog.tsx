import { useState, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { 
  Search,
  FileText,
  CreditCard,
  Users,
  Car,
  Filter,
  ChevronDown,
  Trash2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow, startOfDay, endOfDay, isWithinInterval, parseISO } from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ActivityItem {
  id: string;
  type: "policy" | "payment" | "client" | "car" | "delete";
  action: string;
  created_at: string;
  createdBy?: string;
  details: {
    amount?: number;
    payment_type?: string;
    cheque_number?: string;
    policy_type?: string;
    policy_type_child?: string;
    company_name?: string;
    car_number?: string;
    client_id?: string;
    client_name?: string;
    client_file_number?: string;
    insurance_price?: number;
  };
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: "نقدًا",
  cheque: "شيك",
  visa: "فيزا",
  transfer: "حوالة",
  credit_card: "بطاقة ائتمان",
};

const PAYMENT_TYPE_COLORS: Record<string, string> = {
  cash: "bg-green-500/10 text-green-600 border-green-200",
  cheque: "bg-amber-500/10 text-amber-600 border-amber-200",
  visa: "bg-blue-500/10 text-blue-600 border-blue-200",
  transfer: "bg-purple-500/10 text-purple-600 border-purple-200",
  credit_card: "bg-indigo-500/10 text-indigo-600 border-indigo-200",
};

const TYPE_LABELS: Record<string, string> = {
  policy: "وثيقة",
  payment: "دفعة",
  client: "عميل",
  car: "سيارة",
  delete: "حذف",
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: "إلزامي",
  THIRD_FULL: "شامل طرف ثالث",
  ROAD_SERVICE: "خدمة طريق",
  ACCIDENT_FEE_EXEMPTION: "إعفاء رسوم حادث",
  HEALTH: "صحي",
  LIFE: "حياة",
  TRAVEL: "سفر",
  PROPERTY: "ممتلكات",
  BUSINESS: "أعمال",
  OTHER: "أخرى",
};

const typeIcons: Record<string, any> = {
  policy: FileText,
  payment: CreditCard,
  client: Users,
  car: Car,
  delete: Trash2,
};

const typeColors: Record<string, string> = {
  policy: "text-primary bg-primary/10",
  payment: "text-success bg-success/10",
  client: "text-accent bg-accent/10",
  car: "text-warning bg-warning/10",
  delete: "text-destructive bg-destructive/10",
};

export default function ActivityLog() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id;

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [displayLimit, setDisplayLimit] = useState(20);

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["activity-log", branchId],
    queryFn: async () => {
      const results: ActivityItem[] = [];
      const branchFilter = branchId ? { branch_id: branchId } : {};

      // Fetch policies with more details
      const { data: policies } = await supabase
        .from("policies")
        .select(`
          id, created_at, policy_type_parent, policy_type_child, cancelled, insurance_price,
          clients(id, full_name, file_number, deleted_at),
          cars(car_number),
          insurance_companies(name, name_ar),
          created_by_profile:profiles!policies_created_by_admin_id_fkey(full_name)
        `)
        .order("created_at", { ascending: false })
        .match(branchFilter)
        .eq("cancelled", false)
        .limit(100);

      if (policies) {
        for (const p of policies) {
          if ((p.clients as any)?.deleted_at) continue;
          const clientName = (p.clients as any)?.full_name || "عميل";
          const fileNumber = (p.clients as any)?.file_number || "";
          const policyLabel = POLICY_TYPE_LABELS[p.policy_type_parent] || p.policy_type_parent || "وثيقة";
          const companyName = (p.insurance_companies as any)?.name_ar || (p.insurance_companies as any)?.name || "";
          const carNumber = (p.cars as any)?.car_number || "";

          results.push({
            id: `policy-${p.id}`,
            type: "policy",
            action: "وثيقة جديدة",
            created_at: p.created_at,
            createdBy: (p.created_by_profile as any)?.full_name || undefined,
            details: {
              policy_type: policyLabel,
              policy_type_child: p.policy_type_child || undefined,
              company_name: companyName,
              car_number: carNumber,
              client_id: (p.clients as any)?.id,
              client_name: clientName,
              client_file_number: fileNumber,
              insurance_price: p.insurance_price || undefined,
            },
          });
        }
      }

      // Fetch payments with full details
      const { data: payments } = await supabase
        .from("policy_payments")
        .select(`
          id, created_at, amount, payment_type, cheque_number,
          policies(
            cancelled, 
            policy_type_parent, 
            policy_type_child,
            insurance_companies(name, name_ar),
            cars(car_number),
            clients(id, full_name, file_number, deleted_at)
          ),
          created_by_profile:profiles!policy_payments_created_by_admin_id_fkey(full_name)
        `)
        .order("created_at", { ascending: false })
        .match(branchFilter)
        .limit(100);

      if (payments) {
        for (const pay of payments) {
          if ((pay.policies as any)?.cancelled) continue;
          if ((pay.policies as any)?.clients?.deleted_at) continue;
          if ((pay.policies as any)?.policy_type_parent === "ELZAMI") continue;

          const clientName = (pay.policies as any)?.clients?.full_name || "عميل";
          const fileNumber = (pay.policies as any)?.clients?.file_number || "";
          const policyType = POLICY_TYPE_LABELS[(pay.policies as any)?.policy_type_parent] || "";
          const companyName = (pay.policies as any)?.insurance_companies?.name_ar || 
                             (pay.policies as any)?.insurance_companies?.name || "";
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
            },
          });
        }
      }

      // Fetch clients
      const { data: clients } = await supabase
        .from("clients")
        .select(`
          id, created_at, full_name, file_number,
          created_by_profile:profiles!clients_created_by_admin_id_fkey(full_name)
        `)
        .order("created_at", { ascending: false })
        .match(branchFilter)
        .is("deleted_at", null)
        .limit(50);

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
      const { data: cars } = await supabase
        .from("cars")
        .select(`
          id, created_at, updated_at, car_number,
          clients(full_name, file_number),
          created_by_profile:profiles!cars_created_by_admin_id_fkey(full_name)
        `)
        .order("updated_at", { ascending: false })
        .match(branchFilter)
        .is("deleted_at", null)
        .limit(50);

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
              client_name: (car.clients as any)?.full_name || "",
              client_file_number: (car.clients as any)?.file_number || "",
            },
          });
        }
      }

      // Fetch delete events from notifications
      const { data: deleteNotifs } = await supabase
        .from("notifications")
        .select("id, created_at, title, message, metadata")
        .eq("type", "policy_deleted")
        .order("created_at", { ascending: false })
        .limit(50);

      if (deleteNotifs) {
        for (const n of deleteNotifs) {
          const meta = (n.metadata || {}) as any;
          results.push({
            id: `delete-${n.id}`,
            type: "delete",
            action: n.title || "حذف وثيقة",
            created_at: n.created_at,
            createdBy: meta.deleted_by || undefined,
            details: {
              client_name: meta.client_name || "",
              policy_type: meta.policy_type || "",
              company_name: meta.company_name || "",
              insurance_price: meta.insurance_price || 0,
            },
          });
        }
      }

      // Sort all by created_at descending
      results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return results;
    },
    staleTime: 60 * 1000,
  });

  // Filter and search
  const filteredActivities = useMemo(() => {
    let filtered = [...activities];

    // Type filter
    if (typeFilter !== "all") {
      filtered = filtered.filter((a) => a.type === typeFilter);
    }

    // Date filter
    if (dateFrom || dateTo) {
      filtered = filtered.filter((a) => {
        const activityDate = parseISO(a.created_at);
        const from = dateFrom ? startOfDay(parseISO(dateFrom)) : new Date(0);
        const to = dateTo ? endOfDay(parseISO(dateTo)) : new Date(2100, 0, 1);
        return isWithinInterval(activityDate, { start: from, end: to });
      });
    }

    // Search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((a) => {
        const searchableText = [
          a.details.client_name,
          a.details.client_file_number,
          a.details.car_number,
          a.details.company_name,
          a.details.policy_type,
          a.createdBy,
          a.action,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return searchableText.includes(searchLower);
      });
    }

    return filtered;
  }, [activities, typeFilter, dateFrom, dateTo, search]);

  // Calculate totals
  const paymentTotal = useMemo(() => {
    return filteredActivities
      .filter((a) => a.type === "payment")
      .reduce((sum, a) => sum + (a.details.amount || 0), 0);
  }, [filteredActivities]);

  const displayedActivities = filteredActivities.slice(0, displayLimit);
  const hasMore = filteredActivities.length > displayLimit;

  const clearFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setTypeFilter("all");
    setDisplayLimit(20);
  };

  const hasActiveFilters = search || dateFrom || dateTo || typeFilter !== "all";

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">سجل النشاط</h1>
            <p className="text-sm text-muted-foreground">
              تتبع جميع النشاطات والعمليات في النظام
            </p>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="بحث بالاسم، رقم الملف، رقم السيارة..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-10"
                />
              </div>

              {/* Date From */}
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground whitespace-nowrap">من:</span>
                <ArabicDatePicker
                  value={dateFrom}
                  onChange={setDateFrom}
                  placeholder="تاريخ البداية"
                  compact
                />
              </div>

              {/* Date To */}
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground whitespace-nowrap">إلى:</span>
                <ArabicDatePicker
                  value={dateTo}
                  onChange={setDateTo}
                  placeholder="تاريخ النهاية"
                  compact
                />
              </div>

              {/* Type Filter */}
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[150px]">
                  <Filter className="h-4 w-4 ml-2" />
                  <SelectValue placeholder="النوع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="policy">الوثائق</SelectItem>
                  <SelectItem value="payment">الدفعات</SelectItem>
                  <SelectItem value="client">العملاء</SelectItem>
                  <SelectItem value="car">السيارات</SelectItem>
                </SelectContent>
              </Select>

              {/* Clear Filters */}
              {hasActiveFilters && (
                <Button variant="ghost" onClick={clearFilters} className="text-muted-foreground">
                  مسح الفلاتر
                </Button>
              )}
            </div>

            {/* Results Summary */}
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span>
                عرض {displayedActivities.length} من {filteredActivities.length} نتيجة
              </span>
              {(typeFilter === "payment" || typeFilter === "all") && paymentTotal > 0 && (
                <Badge variant="secondary" className="bg-success/10 text-success">
                  مجموع الدفعات: ₪{paymentTotal.toLocaleString()}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Activity List */}
        <div className="space-y-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="py-4">
                  <div className="flex items-start gap-4">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : displayedActivities.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                لا توجد نتائج مطابقة للبحث
              </CardContent>
            </Card>
          ) : (
            displayedActivities.map((activity) => {
              const Icon = typeIcons[activity.type];
              return (
                <Card key={activity.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="py-4">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className={cn("rounded-lg p-2.5", typeColors[activity.type])}>
                        <Icon className="h-5 w-5" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* Header Row */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground">{activity.action}</span>
                            {activity.createdBy && (
                              <Badge variant="outline" className="text-xs">
                                بواسطة {activity.createdBy}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDistanceToNow(new Date(activity.created_at), {
                              addSuffix: true,
                              locale: ar,
                            })}
                          </span>
                        </div>

                        {/* Details */}
                        <div className="text-sm space-y-1">
                          {/* Client Info */}
                          {activity.details.client_name && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Users className="h-3.5 w-3.5" />
                              <span>
                                {activity.details.client_name}
                                {activity.details.client_file_number && (
                                  <span className="text-xs mr-1">
                                    ({activity.details.client_file_number})
                                  </span>
                                )}
                              </span>
                            </div>
                          )}

                          {/* Payment specific */}
                          {activity.type === "payment" && (
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="font-semibold text-success">
                                ₪{(activity.details.amount || 0).toLocaleString()}
                              </span>
                              {activity.details.payment_type && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-xs",
                                    PAYMENT_TYPE_COLORS[activity.details.payment_type] ||
                                      PAYMENT_TYPE_COLORS.cash
                                  )}
                                >
                                  {PAYMENT_TYPE_LABELS[activity.details.payment_type] ||
                                    activity.details.payment_type}
                                </Badge>
                              )}
                              {activity.details.cheque_number && (
                                <span className="text-xs text-muted-foreground">
                                  شيك #{activity.details.cheque_number}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Policy/Insurance Info */}
                          {(activity.details.policy_type || activity.details.company_name) && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <FileText className="h-3.5 w-3.5" />
                              <span>
                                {activity.details.policy_type}
                                {activity.details.company_name && (
                                  <span className="mr-1">→ {activity.details.company_name}</span>
                                )}
                              </span>
                              {activity.details.insurance_price && activity.type === "policy" && (
                                <Badge variant="secondary" className="text-xs">
                                  ₪{activity.details.insurance_price.toLocaleString()}
                                </Badge>
                              )}
                            </div>
                          )}

                          {/* Car Info */}
                          {activity.details.car_number && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Car className="h-3.5 w-3.5" />
                              <span>{activity.details.car_number}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}

          {/* Load More */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => setDisplayLimit((prev) => prev + 20)}
                className="gap-2"
              >
                <ChevronDown className="h-4 w-4" />
                تحميل المزيد ({filteredActivities.length - displayLimit} متبقي)
              </Button>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
