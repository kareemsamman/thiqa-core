import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Trash2, ChevronDown, User, Car, Building2 } from "lucide-react";
import { useState } from "react";

interface ThirdParty {
  id: string;
  full_name: string;
  id_number: string | null;
  phone: string | null;
  address: string | null;
  vehicle_number: string | null;
  vehicle_type: string | null;
  vehicle_manufacturer: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  insurance_company: string | null;
  insurance_policy_number: string | null;
  damage_description: string | null;
  sort_order: number;
}

interface AccidentThirdPartyFormProps {
  thirdParty: ThirdParty;
  index: number;
  onChange: (updates: Partial<ThirdParty>) => void;
  onRemove: () => void;
}

export function AccidentThirdPartyForm({
  thirdParty,
  index,
  onChange,
  onRemove,
}: AccidentThirdPartyFormProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger className="flex items-center gap-2 hover:text-primary transition-colors">
              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
              <CardTitle className="text-base">
                طرف ثالث #{index + 1}
                {thirdParty.full_name && ` - ${thirdParty.full_name}`}
              </CardTitle>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="h-8 w-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-6 pt-0">
            {/* Person Details */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <User className="h-4 w-4" />
                بيانات الشخص
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>الاسم الكامل *</Label>
                  <Input
                    value={thirdParty.full_name}
                    onChange={(e) => onChange({ full_name: e.target.value })}
                    placeholder="اسم الطرف الثالث"
                  />
                </div>
                <div className="space-y-2">
                  <Label>رقم الهوية</Label>
                  <Input
                    value={thirdParty.id_number || ""}
                    onChange={(e) => onChange({ id_number: e.target.value || null })}
                    placeholder="رقم الهوية"
                  />
                </div>
                <div className="space-y-2">
                  <Label>رقم الهاتف</Label>
                  <Input
                    value={thirdParty.phone || ""}
                    onChange={(e) => onChange({ phone: e.target.value || null })}
                    placeholder="رقم الهاتف"
                  />
                </div>
                <div className="space-y-2">
                  <Label>العنوان</Label>
                  <Input
                    value={thirdParty.address || ""}
                    onChange={(e) => onChange({ address: e.target.value || null })}
                    placeholder="العنوان"
                  />
                </div>
              </div>
            </div>

            {/* Vehicle Details */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Car className="h-4 w-4" />
                بيانات المركبة
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>رقم السيارة</Label>
                  <Input
                    value={thirdParty.vehicle_number || ""}
                    onChange={(e) => onChange({ vehicle_number: e.target.value || null })}
                    placeholder="رقم السيارة"
                  />
                </div>
                <div className="space-y-2">
                  <Label>نوع المركبة</Label>
                  <Input
                    value={thirdParty.vehicle_type || ""}
                    onChange={(e) => onChange({ vehicle_type: e.target.value || null })}
                    placeholder="خصوصي، تاكسي..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>الشركة المصنعة</Label>
                  <Input
                    value={thirdParty.vehicle_manufacturer || ""}
                    onChange={(e) => onChange({ vehicle_manufacturer: e.target.value || null })}
                    placeholder="تويوتا، هونداي..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>الموديل</Label>
                  <Input
                    value={thirdParty.vehicle_model || ""}
                    onChange={(e) => onChange({ vehicle_model: e.target.value || null })}
                    placeholder="كامري، النترا..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>سنة الصنع</Label>
                  <Input
                    type="number"
                    value={thirdParty.vehicle_year || ""}
                    onChange={(e) => onChange({ vehicle_year: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="2024"
                  />
                </div>
                <div className="space-y-2">
                  <Label>اللون</Label>
                  <Input
                    value={thirdParty.vehicle_color || ""}
                    onChange={(e) => onChange({ vehicle_color: e.target.value || null })}
                    placeholder="أبيض، أسود..."
                  />
                </div>
              </div>
            </div>

            {/* Insurance Details */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                بيانات التأمين
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>شركة التأمين</Label>
                  <Input
                    value={thirdParty.insurance_company || ""}
                    onChange={(e) => onChange({ insurance_company: e.target.value || null })}
                    placeholder="اسم شركة التأمين"
                  />
                </div>
                <div className="space-y-2">
                  <Label>رقم معاملة التأمين</Label>
                  <Input
                    value={thirdParty.insurance_policy_number || ""}
                    onChange={(e) => onChange({ insurance_policy_number: e.target.value || null })}
                    placeholder="رقم المعاملة"
                  />
                </div>
              </div>
            </div>

            {/* Damage Description */}
            <div className="space-y-2">
              <Label>وصف الأضرار</Label>
              <Textarea
                value={thirdParty.damage_description || ""}
                onChange={(e) => onChange({ damage_description: e.target.value || null })}
                placeholder="وصف تفصيلي للأضرار التي لحقت بالمركبة..."
                rows={3}
              />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
