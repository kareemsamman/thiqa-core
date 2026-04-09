import { useState } from "react";
import {
  Phone,
  Car,
  DollarSign,
  Shield,
  ChevronDown,
  ChevronUp,
  User,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  PhoneCall,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ClickablePhone } from "@/components/shared/ClickablePhone";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

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
  requires_callback?: boolean | null;
  created_at: string;
  updated_at: string;
}

interface LeadInfoBannerProps {
  lead: Lead;
  onStatusChange: (status: string) => void;
  isUpdating: boolean;
}

const statusOptions = [
  { value: "new", label: "جديد", color: "bg-blue-500" },
  { value: "contacted", label: "تم التواصل", color: "bg-yellow-500" },
  { value: "converted", label: "تم التحويل", color: "bg-green-500" },
  { value: "rejected", label: "مرفوض", color: "bg-red-500" },
];

export function LeadInfoBanner({
  lead,
  onStatusChange,
  isUpdating,
}: LeadInfoBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const infoCards = [
    {
      icon: Phone,
      label: "الهاتف",
      value: lead.phone,
      color: "text-blue-600 bg-blue-50 dark:bg-blue-950",
    },
    {
      icon: Car,
      label: "السيارة",
      value:
        lead.car_manufacturer && lead.car_model
          ? `${lead.car_manufacturer} ${lead.car_model}`
          : lead.car_number || "-",
      color: "text-purple-600 bg-purple-50 dark:bg-purple-950",
    },
    {
      icon: DollarSign,
      label: "السعر",
      value: lead.total_price ? `₪${lead.total_price.toLocaleString()}` : "-",
      color: "text-green-600 bg-green-50 dark:bg-green-950",
    },
    {
      icon: Shield,
      label: "التأمين",
      value: lead.insurance_types?.join("، ") || "-",
      color: "text-orange-600 bg-orange-50 dark:bg-orange-950",
    },
  ];

  return (
    <div className="border-b bg-muted/30">
      {/* Callback Alert */}
      {lead.requires_callback && (
        <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive border-b border-destructive/20">
          <PhoneCall className="h-4 w-4 animate-pulse" />
          <span className="text-sm font-medium">العميل طلب اتصال!</span>
        </div>
      )}

      {/* Quick Info Cards */}
      <div className="p-3">
        <div className="grid grid-cols-4 gap-2">
          {infoCards.map((card, index) => (
            <div
              key={index}
              className={`flex flex-col items-center justify-center p-2 rounded-lg ${card.color} transition-all hover:scale-105`}
            >
              <card.icon className="h-4 w-4 mb-1" />
              <span className="text-[10px] opacity-70">{card.label}</span>
              <span className="text-xs font-medium text-center truncate w-full">
                {card.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Expandable Details */}
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground hover:text-foreground gap-1 py-1 h-7 rounded-none border-t"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                إخفاء التفاصيل
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                عرض المزيد
              </>
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t">
          <div className="p-4 space-y-4">
            {/* Status Selector */}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">الحالة:</span>
              <Select
                value={lead.status}
                onValueChange={onStatusChange}
                disabled={isUpdating}
              >
                <SelectTrigger className="w-32 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${status.color}`}
                        />
                        {status.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isUpdating && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>

            {/* Customer Details */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">الاسم:</span>
                <span className="font-medium">
                  {lead.customer_name || "-"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">الهاتف:</span>
                <ClickablePhone phone={lead.phone} />
              </div>
            </div>

            {/* Car Details */}
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">
                  رقم السيارة
                </span>
                <p className="font-medium">{lead.car_number || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">الموديل</span>
                <p className="font-medium">
                  {lead.car_manufacturer} {lead.car_model}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">السنة</span>
                <p className="font-medium">{lead.car_year || "-"}</p>
              </div>
            </div>

            {/* Insurance Details */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">التأمين:</span>
              {lead.insurance_types && lead.insurance_types.length > 0 ? (
                lead.insurance_types.map((type, idx) => (
                  <Badge key={idx} variant="secondary">
                    {type}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">-</span>
              )}
            </div>

            {/* Driver & Accidents */}
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">السائق فوق 24:</span>
                {lead.driver_over_24 === true ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : lead.driver_over_24 === false ? (
                  <XCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">حوادث:</span>
                {lead.has_accidents === true ? (
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                ) : lead.has_accidents === false ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </div>
            </div>

            {/* Notes */}
            {lead.notes && (
              <div className="text-sm">
                <span className="text-muted-foreground">ملاحظات:</span>
                <p className="mt-1 text-foreground">{lead.notes}</p>
              </div>
            )}

            {/* Timestamps */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                تم الإنشاء:{" "}
                {format(new Date(lead.created_at), "Pp", { locale: ar })}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
