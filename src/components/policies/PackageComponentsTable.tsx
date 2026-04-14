import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Shield, Car, Truck, FileCheck, Pencil, XCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

interface PackagePolicy {
  id: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  profit: number | null;
  office_commission?: number | null;
  cancelled?: boolean | null;
  cancellation_date?: string | null;
  is_under_24?: boolean | null;
  group_id?: string | null;
  insurance_companies?: {
    id: string;
    name: string;
    name_ar: string | null;
  } | null;
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
  cars?: {
    car_type: string | null;
    car_value: number | null;
    year: number | null;
  } | null;
}

interface PackageComponentsTableProps {
  policies: PackagePolicy[];
  isAdmin: boolean;
  onEditPolicy?: (policy: PackagePolicy) => void;
  syncStatuses?: Record<string, 'success' | 'failed' | 'pending' | null>;
}

const policyTypeLabels: Record<string, string> = {
  ELZAMI: "إلزامي",
  THIRD_FULL: "ثالث/شامل",
  ROAD_SERVICE: "خدمات الطريق",
  ACCIDENT_FEE_EXEMPTION: "إعفاء رسوم حادث",
  HEALTH: "تأمين صحي",
  LIFE: "تأمين حياة",
  PROPERTY: "تأمين ممتلكات",
  TRAVEL: "تأمين سفر",
  BUSINESS: "تأمين أعمال",
  OTHER: "أخرى",
};

const policyChildLabels: Record<string, string> = {
  THIRD: "طرف ثالث",
  FULL: "شامل",
};

const policyTypeConfig: Record<string, { icon: React.ElementType; bg: string; text: string }> = {
  ELZAMI: { icon: Shield, bg: "bg-teal-50", text: "text-teal-700" },
  THIRD_FULL: { icon: Car, bg: "bg-cyan-50", text: "text-cyan-700" },
  ROAD_SERVICE: { icon: Truck, bg: "bg-emerald-50", text: "text-emerald-700" },
  ACCIDENT_FEE_EXEMPTION: { icon: FileCheck, bg: "bg-emerald-50", text: "text-emerald-700" },
};

const syncableTypes = ['ROAD_SERVICE', 'ACCIDENT_FEE_EXEMPTION'];

const SyncDot = ({ status }: { status: 'success' | 'failed' | 'pending' | null }) => {
  if (!status) return null;
  const config = {
    success: { color: 'bg-emerald-500', tooltip: 'تمت المزامنة مع X-Service' },
    failed: { color: 'bg-red-500', tooltip: 'فشلت المزامنة مع X-Service' },
    pending: { color: 'bg-amber-500', tooltip: 'في انتظار المزامنة مع X-Service' },
  };
  const { color, tooltip } = config[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", color)} />
      </TooltipTrigger>
      <TooltipContent side="top"><p>{tooltip}</p></TooltipContent>
    </Tooltip>
  );
};

export function PackageComponentsTable({ policies, isAdmin, onEditPolicy, syncStatuses }: PackageComponentsTableProps) {
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-GB");
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return "₪0";
    return `₪${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  };

const getTypeName = (p: PackagePolicy) => {
    // For THIRD_FULL with a child type, show only the child type (ثالث or شامل)
    if (p.policy_type_parent === 'THIRD_FULL' && p.policy_type_child) {
      return policyChildLabels[p.policy_type_child] || p.policy_type_child;
    }
    // For other types, use the parent label
    return policyTypeLabels[p.policy_type_parent] || p.policy_type_parent;
  };

  const getServiceName = (p: PackagePolicy) => {
    if (p.policy_type_parent === 'ROAD_SERVICE' && p.road_services) {
      return p.road_services.name_ar || p.road_services.name;
    }
    if (p.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION' && p.accident_fee_services) {
      return p.accident_fee_services.name_ar || p.accident_fee_services.name;
    }
    return null;
  };

  const getCompanyName = (p: PackagePolicy) => {
    if (p.policy_type_parent === 'ROAD_SERVICE' && p.road_services) {
      return p.road_services.name_ar || p.road_services.name;
    }
    if (p.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION' && p.accident_fee_services) {
      return p.accident_fee_services.name_ar || p.accident_fee_services.name;
    }
    if (p.insurance_companies) {
      return p.insurance_companies.name_ar || p.insurance_companies.name;
    }
    return '-';
  };

  // Cancelled siblings are excluded from every total — the office stopped
  // earning on them, and including their prices in the "المجموع" row makes
  // the numbers disagree with the payments section.
  const activePolicies = policies.filter((p) => !p.cancelled);
  const totalPrice = activePolicies.reduce((sum, p) => sum + p.insurance_price + ((p as any).office_commission || 0), 0);
  // Profit total excludes ELZAMI — compulsory policies have no markup. The
  // office's earning on ELZAMI lives in office_commission and is shown in
  // its own column / card, not folded into "ربح".
  const totalProfit = activePolicies
    .filter((p) => p.policy_type_parent !== 'ELZAMI')
    .reduce((sum, p) => sum + (p.profit || 0), 0);
  const totalCommission = activePolicies.reduce(
    (sum, p) => sum + ((p as any).office_commission || 0),
    0,
  );

  return (
    <TooltipProvider>
    <div className="border rounded-xl overflow-hidden bg-card">
      <div className="bg-gradient-to-l from-primary/5 to-primary/10 px-4 py-3 border-b">
        <h3 className="font-bold text-foreground flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          مكونات الباقة
        </h3>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="font-bold">نوع التأمين</TableHead>
            <TableHead className="font-bold">الشركة</TableHead>
            <TableHead className="font-bold">الفترة</TableHead>
            <TableHead className="font-bold text-left">السعر</TableHead>
            {isAdmin && <TableHead className="font-bold text-left">الربح</TableHead>}
            {onEditPolicy && <TableHead className="font-bold w-16">تعديل</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {policies.map((policy) => {
            const config = policyTypeConfig[policy.policy_type_parent] || policyTypeConfig.ELZAMI;
            const Icon = config.icon;
            const serviceName = getServiceName(policy);
            const isElzami = policy.policy_type_parent === 'ELZAMI';
            const isCancelled = !!policy.cancelled;

            return (
              <TableRow
                key={policy.id}
                className={cn(
                  "hover:bg-muted/20",
                  isCancelled && "bg-red-50/40 hover:bg-red-50/60",
                )}
              >
                <TableCell>
                    <div className="flex items-center gap-2">
                    <div className="relative">
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", config.bg, isCancelled && "opacity-50 grayscale")}>
                        <Icon className={cn("h-4 w-4", config.text)} />
                      </div>
                      {syncStatuses && syncableTypes.includes(policy.policy_type_parent) && (
                        <span className="absolute -top-0.5 -right-0.5">
                          <SyncDot status={syncStatuses[policy.id] ?? null} />
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={cn("font-semibold", isCancelled && "text-muted-foreground line-through")}>
                          {getTypeName(policy)}
                        </p>
                        {isCancelled && (
                          <Badge variant="destructive" className="gap-1 text-[10px] h-5 px-1.5">
                            <XCircle className="h-3 w-3" />
                            ملغاة
                          </Badge>
                        )}
                      </div>
                      {serviceName && (
                        <p className={cn("text-xs text-muted-foreground", isCancelled && "line-through")}>{serviceName}</p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className={cn("text-sm font-medium", isCancelled && "text-muted-foreground line-through")}>
                    {getCompanyName(policy)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className={cn("text-sm", isCancelled && "text-muted-foreground line-through")}>
                    <span>{formatDate(policy.start_date)}</span>
                    <span className="mx-2 text-muted-foreground">←</span>
                    <span>{formatDate(policy.end_date)}</span>
                  </div>
                </TableCell>
                <TableCell className="text-left">
                  <div className={cn("flex flex-col items-end", isCancelled && "text-muted-foreground line-through")}>
                    <span className="font-bold text-lg ltr-nums">{formatCurrency(policy.insurance_price)}</span>
                    {((policy as any).office_commission || 0) > 0 && (
                      <span className="text-[11px] text-amber-700 font-semibold ltr-nums mt-0.5">
                        + {formatCurrency((policy as any).office_commission)} عمولة مكتب
                      </span>
                    )}
                  </div>
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-left">
                    {isElzami ? (
                      ((policy as any).office_commission || 0) > 0 ? (
                        <div className="text-left">
                          <span className="font-semibold ltr-nums text-emerald-600">
                            {formatCurrency((policy as any).office_commission)}
                          </span>
                          <div className="text-[10px] text-muted-foreground mt-0.5">عمولة مكتب</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )
                    ) : (
                      <span className={cn(
                        "font-semibold ltr-nums",
                        (policy.profit || 0) < 0 ? "text-red-600" : "text-emerald-600"
                      )}>
                        {formatCurrency(policy.profit)}
                      </span>
                    )}
                  </TableCell>
                )}
                {onEditPolicy && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onEditPolicy(policy)}
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow className="bg-gradient-to-l from-primary/5 to-primary/10 font-bold">
            <TableCell colSpan={3} className="text-left">
              <span className="text-lg">المجموع</span>
            </TableCell>
            <TableCell className="text-left">
              <div className="flex flex-col items-end">
                <span className="text-xl font-bold text-primary ltr-nums">{formatCurrency(totalPrice)}</span>
                {totalCommission > 0 && (
                  <span className="text-[11px] text-amber-700 font-semibold ltr-nums mt-0.5">
                    منها {formatCurrency(totalCommission)} عمولة مكتب
                  </span>
                )}
              </div>
            </TableCell>
            {isAdmin && (
              <TableCell className="text-left">
                <div className="flex flex-col items-end gap-0.5">
                  <span className={cn(
                    "text-lg font-bold ltr-nums",
                    totalProfit < 0 ? "text-red-600" : "text-emerald-600"
                  )}>
                    {formatCurrency(totalProfit)}
                  </span>
                  {totalCommission > 0 && (
                    <span className="text-[10px] text-muted-foreground ltr-nums">
                      + عمولة {formatCurrency(totalCommission)}
                    </span>
                  )}
                </div>
              </TableCell>
            )}
            {onEditPolicy && <TableCell />}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
    </TooltipProvider>
  );
}
