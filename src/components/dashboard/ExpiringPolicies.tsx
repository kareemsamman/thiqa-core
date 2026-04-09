import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { ExpiryBadge } from "@/components/shared/ExpiryBadge";
import { getInsuranceTypeLabel } from "@/lib/insuranceTypes";

interface ExpiringPolicy {
  id: string;
  end_date: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  insurance_price: number;
  client: { full_name: string } | null;
  car: { car_number: string } | null;
  company: { name: string; name_ar: string | null } | null;
  renewal_tracking: { renewal_status: string | null }[] | null;
}

const renewalStatusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: "قيد الانتظار", color: "bg-muted text-muted-foreground" },
  sms_sent: { label: "تم إرسال SMS", color: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  called: { label: "تم الاتصال", color: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  renewed: { label: "تم التجديد", color: "bg-success/10 text-success border-success/30" },
  not_interested: { label: "غير مهتم", color: "bg-destructive/10 text-destructive border-destructive/30" },
};


export function ExpiringPolicies() {
  const navigate = useNavigate();
  const [policies, setPolicies] = useState<ExpiringPolicy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchExpiringPolicies();
  }, []);

  const fetchExpiringPolicies = async () => {
    try {
      const today = new Date();
      const thirtyDaysLater = new Date();
      thirtyDaysLater.setDate(today.getDate() + 30);

      const { data, error } = await supabase
        .from("policies")
        .select(`
          id, end_date, policy_type_parent, policy_type_child, insurance_price,
          client:clients(full_name),
          car:cars(car_number),
          company:insurance_companies(name, name_ar),
          renewal_tracking:policy_renewal_tracking(renewal_status)
        `)
        .is("deleted_at", null)
        .eq("cancelled", false)
        .gte("end_date", today.toISOString().split("T")[0])
        .lte("end_date", thirtyDaysLater.toISOString().split("T")[0])
        .order("end_date", { ascending: true })
        .limit(6);

      if (error) throw error;

      // Filter out renewed policies - they shouldn't appear in expiring list
      const filteredPolicies = (data || []).filter(policy => {
        const renewalStatus = policy.renewal_tracking?.[0]?.renewal_status;
        return renewalStatus !== 'renewed';
      });

      setPolicies(filteredPolicies);
    } catch (error) {
      console.error("Error fetching expiring policies:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <CardTitle className="text-base">وثائق تنتهي قريباً</CardTitle>
          {!loading && policies.length > 0 && (
            <Badge variant="destructive" className="mr-2">{policies.length}</Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" className="text-primary" onClick={() => navigate("/reports/policies?tab=renewals")}>
          عرض الكل <ChevronLeft className="mr-1 h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-secondary/50 p-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div>
                  <Skeleton className="h-4 w-24 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <div className="text-left">
                <Skeleton className="h-5 w-16 mb-1" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          ))
        ) : policies.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>لا توجد وثائق تنتهي خلال 30 يوم</p>
          </div>
        ) : (
          policies.map((policy) => {
            const renewalStatus = policy.renewal_tracking?.[0]?.renewal_status;
            const statusInfo = renewalStatus ? renewalStatusLabels[renewalStatus] : null;
            
            return (
              <div 
                key={policy.id} 
                className="flex items-center justify-between rounded-lg bg-secondary/50 p-3 transition-colors hover:bg-secondary cursor-pointer"
                onClick={() => navigate("/reports/policies?tab=renewals")}
              >
                <div className="flex items-center gap-3">
                  <ExpiryBadge endDate={policy.end_date} showDays={true} />
                  <div>
                    <p className="font-medium text-foreground">{policy.client?.full_name || "غير معروف"}</p>
                    <p className="text-sm text-muted-foreground"><bdi>{policy.car?.car_number || "-"}</bdi></p>
                  </div>
                </div>
                <div className="text-left flex flex-col items-end gap-1">
                  <Badge variant="outline" className="text-xs">
                    {getInsuranceTypeLabel(policy.policy_type_parent as any, policy.policy_type_child as any)}
                  </Badge>
                  {statusInfo && (
                    <Badge variant="outline" className={`text-xs ${statusInfo.color}`}>
                      {statusInfo.label}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
