import { useEffect, useState, memo } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Route, Shield, FileCheck, Loader2, Check, AlertCircle, Car, Calendar, ExternalLink, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { SelectEmptyHint } from "./SelectEmptyHint";
import type { PackageAddon, Company, RoadService, AccidentFeeService } from "./types";

// Addon Card Component - extracted outside to prevent re-creation on parent re-render
interface AddonCardProps {
  type: 'elzami' | 'third_full' | 'road_service' | 'accident_fee_exemption';
  title: string;
  icon: typeof FileCheck;
  iconColor: string;
  bgColor: string;
  borderColor: string;
  /** Tailwind gradient classes applied when the card is enabled. Falls back to bgColor if not provided. */
  gradientClass?: string;
  addon: PackageAddon;
  isCost?: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const AddonCard = memo(function AddonCard({
  type,
  title,
  icon: Icon,
  iconColor,
  bgColor,
  borderColor,
  gradientClass,
  addon,
  isCost = false,
  disabled,
  onToggle,
  children
}: AddonCardProps) {
  return (
    <Card
      className={cn(
        "relative p-4 cursor-pointer transition-all duration-200 border-2 min-h-[180px] overflow-hidden",
        addon.enabled
          ? cn(gradientClass || bgColor, borderColor, "shadow-lg")
          : "bg-muted/20 border-dashed border-muted-foreground/25 hover:border-muted-foreground/40 hover:bg-muted/30"
      )}
      onClick={() => !disabled && onToggle()}
    >
      {/* Decorative corner glow when enabled */}
      {addon.enabled && (
        <div
          className={cn(
            "pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full blur-2xl opacity-40",
            isCost ? "bg-destructive/30" : "bg-primary/30"
          )}
        />
      )}

      {/* Selection Indicator */}
      <div className={cn(
        "absolute top-3 left-3 w-6 h-6 rounded-full flex items-center justify-center transition-all shadow-sm",
        addon.enabled
          ? `${isCost ? 'bg-destructive' : 'bg-primary'} text-white`
          : "bg-background border-2 border-muted-foreground/30"
      )}>
        {addon.enabled && <Check className="h-3.5 w-3.5" />}
      </div>

      {/* Header */}
      <div className="relative flex items-center gap-2 mb-3 pr-2">
        <div className={cn("p-1.5 rounded-md shadow-sm", addon.enabled ? "bg-white/70 dark:bg-white/10" : "bg-muted/50")}>
          <Icon className={cn("h-4 w-4", addon.enabled ? iconColor : "text-muted-foreground")} />
        </div>
        <span className={cn("font-semibold text-sm", addon.enabled ? "text-foreground" : "text-muted-foreground")}>{title}</span>
      </div>

      {/* Content */}
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        {addon.enabled ? children : (
          <p className="text-xs text-muted-foreground text-center py-6">اضغط لإضافة</p>
        )}
      </div>
    </Card>
  );
});

// Company X ID - default for road service and accident fee
const COMPANY_X_ID = "0014273c-78fc-4945-920c-6c8ce653f64a";

interface PackageBuilderSectionProps {
  addons: PackageAddon[];
  onAddonsChange: (addons: PackageAddon[]) => void;
  mainPolicyType: string;
  mainStartDate: string;
  mainEndDate: string;
  roadServices: RoadService[];
  accidentFeeServices: AccidentFeeService[];
  roadServiceCompanies: Company[];
  accidentFeeCompanies: Company[];
  elzamiCompanies: Company[];
  thirdFullCompanies: Company[];
  carType?: string;
  disabled?: boolean;
  errors?: Record<string, string>;
  ageBand?: 'UNDER_24' | 'UP_24' | 'ANY';
  /** Minimize the wizard and optionally navigate away — used by the
   *  "manage companies" links on the addon company selectors. */
  onMinimizeAndNavigate?: (path?: string) => void;
}

export function PackageBuilderSection({
  addons,
  onAddonsChange,
  mainPolicyType,
  mainStartDate,
  mainEndDate,
  roadServices,
  accidentFeeServices,
  roadServiceCompanies,
  accidentFeeCompanies,
  elzamiCompanies,
  thirdFullCompanies,
  carType,
  disabled,
  errors = {},
  ageBand = 'ANY',
  onMinimizeAndNavigate,
}: PackageBuilderSectionProps) {
  const [loadingRoadPrice, setLoadingRoadPrice] = useState(false);
  const [loadingAccidentPrice, setLoadingAccidentPrice] = useState(false);
  const [loadingElzamiCommission, setLoadingElzamiCommission] = useState(false);

  // Find addons by type
  const elzamiAddon = addons.find(a => a.type === 'elzami') || { type: 'elzami' as const, enabled: false, company_id: '', insurance_price: '', elzami_commission: 0 };
  const thirdFullAddon = addons.find(a => a.type === 'third_full') || { type: 'third_full' as const, enabled: false, company_id: '', insurance_price: '', policy_type_child: '' as '' | 'THIRD' | 'FULL', broker_buy_price: '' };
  const roadServiceAddon = addons.find(a => a.type === 'road_service') || { type: 'road_service' as const, enabled: false, road_service_id: '', company_id: '', insurance_price: '' };
  const accidentFeeAddon = addons.find(a => a.type === 'accident_fee_exemption') || { type: 'accident_fee_exemption' as const, enabled: false, accident_fee_service_id: '', company_id: '', insurance_price: '' };

  const updateAddon = (type: 'elzami' | 'third_full' | 'road_service' | 'accident_fee_exemption', updates: Partial<PackageAddon>) => {
    // When enabling an addon, auto-fill dates
    if (updates.enabled === true) {
      const thirdFullAddon = addons.find(a => a.type === 'third_full');
      let defaultStart = mainStartDate;
      let defaultEnd = mainEndDate;
      
      // For road_service and accident_fee, prefer third_full dates if available
      if ((type === 'road_service' || type === 'accident_fee_exemption') && 
          thirdFullAddon?.enabled && thirdFullAddon.start_date) {
        defaultStart = thirdFullAddon.start_date;
        defaultEnd = thirdFullAddon.end_date || calculateEndDate(thirdFullAddon.start_date);
      }
      
      // Add dates to the update
      if (defaultStart) {
        updates = {
          ...updates,
          start_date: defaultStart,
          end_date: defaultEnd || calculateEndDate(defaultStart)
        };
      }
    }
    
    const newAddons = addons.map(addon => 
      addon.type === type ? { ...addon, ...updates } : addon
    );
    onAddonsChange(newAddons);
  };

  // Helper to calculate end date (1 year - 1 day from start)
  const calculateEndDate = (startDate: string): string => {
    if (!startDate) return "";
    const start = new Date(startDate);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    end.setDate(end.getDate() - 1);
    return end.toISOString().split("T")[0];
  };

  // Handle start date change for an addon - auto-calculate end date
  const handleAddonStartDateChange = (type: PackageAddon['type'], newStartDate: string) => {
    const endDate = calculateEndDate(newStartDate);
    updateAddon(type, { start_date: newStartDate, end_date: endDate });
    
    // If this is third_full, sync road_service and accident_fee to same dates
    if (type === 'third_full') {
      const roadAddon = addons.find(a => a.type === 'road_service');
      const accidentAddon = addons.find(a => a.type === 'accident_fee_exemption');
      
      if (roadAddon?.enabled && !roadAddon.start_date) {
        updateAddon('road_service', { start_date: newStartDate, end_date: endDate });
      }
      if (accidentAddon?.enabled && !accidentAddon.start_date) {
        updateAddon('accident_fee_exemption', { start_date: newStartDate, end_date: endDate });
      }
    }
  };

  // Filter road services by car type
  const baseFilteredRoadServices = carType
    ? roadServices.filter(rs => rs.allowed_car_types?.includes(carType))
    : roadServices;
  
  // State for company-filtered road services
  const [availableRoadServices, setAvailableRoadServices] = useState<RoadService[]>(baseFilteredRoadServices);
  
  // Filter road services by company pricing - only show services the company sells
  useEffect(() => {
    const fetchAvailableServices = async () => {
      if (!roadServiceAddon.company_id) {
        setAvailableRoadServices(baseFilteredRoadServices);
        return;
      }
      
      // Fetch services that have pricing for this company
      const { data } = await supabase
        .from('company_road_service_prices')
        .select('road_service_id')
        .eq('company_id', roadServiceAddon.company_id);
      
      const serviceIds = data?.map(d => d.road_service_id) || [];
      
      // Filter by both car type AND company pricing
      const available = baseFilteredRoadServices.filter(rs => serviceIds.includes(rs.id));
      setAvailableRoadServices(available);
      
      // If current selection is not in the available list, clear it
      if (roadServiceAddon.road_service_id && !serviceIds.includes(roadServiceAddon.road_service_id)) {
        updateAddon('road_service', { road_service_id: '', insurance_price: '' });
      }
    };
    
    fetchAvailableServices();
  }, [roadServiceAddon.company_id, carType, roadServices]);

  // Determine which addons can be shown based on main policy type
  const showElzamiAddon = mainPolicyType === 'THIRD_FULL';
  const showThirdFullAddon = mainPolicyType === 'ELZAMI';
  const showRoadServiceAddon = true;
  const showAccidentFeeAddon = true;

  // Auto-initialize addon dates from main policy or third_full when enabled
  useEffect(() => {
    const thirdFullAddon = addons.find(a => a.type === 'third_full');
    
    addons.forEach(addon => {
      if (addon.enabled && !addon.start_date) {
        let defaultStart = mainStartDate;
        let defaultEnd = mainEndDate;
        
        // For road_service and accident_fee, prefer third_full dates if available
        if ((addon.type === 'road_service' || addon.type === 'accident_fee_exemption') && 
            thirdFullAddon?.enabled && thirdFullAddon.start_date) {
          defaultStart = thirdFullAddon.start_date;
          defaultEnd = thirdFullAddon.end_date || calculateEndDate(thirdFullAddon.start_date);
        }
        
        if (defaultStart) {
          updateAddon(addon.type, { 
            start_date: defaultStart, 
            end_date: defaultEnd || calculateEndDate(defaultStart) 
          });
        }
      }
    });
  }, [addons.map(a => `${a.type}:${a.enabled}`).join(','), mainStartDate, mainEndDate]);

  // Auto-fetch ELZAMI commission when company is selected
  useEffect(() => {
    if (!elzamiAddon.enabled || !elzamiAddon.company_id) return;

    const fetchElzamiCommission = async () => {
      setLoadingElzamiCommission(true);
      try {
        const { data } = await supabase
          .from('insurance_companies')
          .select('elzami_commission')
          .eq('id', elzamiAddon.company_id)
          .single();

        if (data?.elzami_commission) {
          updateAddon('elzami', { 
            elzami_commission: data.elzami_commission,
            insurance_price: data.elzami_commission.toString()
          });
        }
      } catch (error) {
        console.error('Error fetching ELZAMI commission:', error);
      } finally {
        setLoadingElzamiCommission(false);
      }
    };

    fetchElzamiCommission();
  }, [elzamiAddon.enabled, elzamiAddon.company_id]);

  // Auto-fetch road service price
  useEffect(() => {
    const fetchRoadServicePrice = async () => {
      if (!roadServiceAddon.enabled || !roadServiceAddon.company_id || !roadServiceAddon.road_service_id) {
        return;
      }

      setLoadingRoadPrice(true);
      try {
        let query = supabase
          .from('company_road_service_prices')
          .select('selling_price, company_cost')
          .eq('company_id', roadServiceAddon.company_id)
          .eq('road_service_id', roadServiceAddon.road_service_id);

        // Try specific age band first, then fallback to ANY
        const { data: specificData } = await query.eq('age_band', ageBand).limit(1);
        
        if (specificData && specificData.length > 0) {
          updateAddon('road_service', { insurance_price: specificData[0].selling_price.toString() });
        } else {
          const { data: anyData } = await supabase
            .from('company_road_service_prices')
            .select('selling_price, company_cost')
            .eq('company_id', roadServiceAddon.company_id)
            .eq('road_service_id', roadServiceAddon.road_service_id)
            .eq('age_band', 'ANY')
            .limit(1);

          if (anyData && anyData.length > 0) {
            updateAddon('road_service', { insurance_price: anyData[0].selling_price.toString() });
          }
        }
      } catch (error) {
        console.error('Error fetching road service price:', error);
      } finally {
        setLoadingRoadPrice(false);
      }
    };

    fetchRoadServicePrice();
  }, [roadServiceAddon.enabled, roadServiceAddon.company_id, roadServiceAddon.road_service_id, ageBand]);

  // Auto-fetch accident fee price
  useEffect(() => {
    const fetchAccidentFeePrice = async () => {
      if (!accidentFeeAddon.enabled || !accidentFeeAddon.company_id || !accidentFeeAddon.accident_fee_service_id) {
        return;
      }

      setLoadingAccidentPrice(true);
      try {
        const { data } = await supabase
          .from('company_accident_fee_prices')
          .select('selling_price, company_cost')
          .eq('company_id', accidentFeeAddon.company_id)
          .eq('accident_fee_service_id', accidentFeeAddon.accident_fee_service_id)
          .limit(1);

        if (data && data.length > 0) {
          updateAddon('accident_fee_exemption', { insurance_price: data[0].selling_price.toString() });
        }
      } catch (error) {
        console.error('Error fetching accident fee price:', error);
      } finally {
        setLoadingAccidentPrice(false);
      }
    };

    fetchAccidentFeePrice();
  }, [accidentFeeAddon.enabled, accidentFeeAddon.company_id, accidentFeeAddon.accident_fee_service_id]);

  // Auto-select company only if there's exactly one option
  useEffect(() => {
    if (roadServiceAddon.enabled && !roadServiceAddon.company_id && roadServiceCompanies.length === 1) {
      updateAddon('road_service', { company_id: roadServiceCompanies[0].id });
    }
  }, [roadServiceCompanies, roadServiceAddon.enabled]);

  useEffect(() => {
    if (accidentFeeAddon.enabled && !accidentFeeAddon.company_id && accidentFeeCompanies.length === 1) {
      updateAddon('accident_fee_exemption', { company_id: accidentFeeCompanies[0].id });
    }
  }, [accidentFeeCompanies, accidentFeeAddon.enabled]);

  // Count enabled addons to show which ones to display
  const activeAddonCount = addons.filter(a => a.enabled).length;
  // Always use equal columns: 3 cols when main is THIRD_FULL, 4 cols when main is ELZAMI
  const totalCards = showThirdFullAddon ? 4 : 3;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Package className="h-5 w-5 text-primary" />
        <h4 className="font-semibold">إضافات الباقة</h4>
        {activeAddonCount > 0 && (
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            {activeAddonCount} مفعّلة
          </span>
        )}
      </div>

      <div className={cn(
        "grid gap-3 w-full",
        "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      )}>
        {/* ELZAMI Addon - Only show when main policy is THIRD_FULL */}
        {showElzamiAddon && (
          <AddonCard
            type="elzami"
            title="إلزامي"
            icon={FileCheck}
            iconColor="text-destructive"
            bgColor="bg-destructive/5"
            borderColor="border-destructive/40"
            gradientClass="bg-gradient-to-br from-destructive/10 via-destructive/5 to-transparent"
            addon={elzamiAddon}
            isCost={true}
            disabled={disabled}
            onToggle={() => updateAddon('elzami', { enabled: !elzamiAddon.enabled })}
          >
            <div className="space-y-2.5">
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <Label className="text-xs mb-0">الشركة</Label>
                  {onMinimizeAndNavigate && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onMinimizeAndNavigate("/companies"); }}
                      className="flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 hover:underline font-medium"
                      title="إدارة الشركات"
                    >
                      <Settings className="h-2.5 w-2.5" />
                      إدارة
                      <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
                <Select
                  value={elzamiAddon.company_id || ""}
                  onValueChange={(v) => updateAddon('elzami', { company_id: v })}
                  disabled={disabled}
                >
                  <SelectTrigger className={cn("h-9 text-sm", errors.addon_elzami_company && "border-destructive")}>
                    <SelectValue placeholder="اختر الشركة" />
                  </SelectTrigger>
                  <SelectContent>
                    {elzamiCompanies.length === 0 ? (
                      <SelectEmptyHint
                        label="شركات إلزامي"
                        adminPath="/companies"
                        onNavigate={onMinimizeAndNavigate}
                      />
                    ) : (
                      elzamiCompanies.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name_ar || c.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {errors.addon_elzami_company && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.addon_elzami_company}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs mb-1 block">السعر (₪)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={elzamiAddon.insurance_price}
                    onChange={(e) => updateAddon('elzami', { insurance_price: e.target.value })}
                    placeholder="0"
                    className={cn("h-9 text-sm text-destructive font-bold", errors.addon_elzami_price && "border-destructive")}
                    disabled={disabled || loadingElzamiCommission}
                  />
                  {loadingElzamiCommission && (
                    <Loader2 className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>
              {/* Office Commission for ELZAMI addon */}
              <div>
                <Label className="text-xs mb-1 block text-amber-600">عمولة للمكتب (₪)</Label>
                <Input
                  type="number"
                  value={elzamiAddon.office_commission || '0'}
                  onChange={(e) => updateAddon('elzami', { office_commission: e.target.value })}
                  placeholder="0"
                  className="h-9 text-sm text-amber-600 font-medium"
                  disabled={disabled}
                />
              </div>
              {/* Date Fields */}
              <div className="space-y-2 pt-2 border-t border-dashed">
                <div>
                  <Label className="text-xs mb-1 block flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    تاريخ البداية
                  </Label>
                  <ArabicDatePicker
                    value={elzamiAddon.start_date}
                    onChange={(d) => handleAddonStartDateChange('elzami', d)}
                    disabled={disabled}
                    compact
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    تاريخ النهاية
                  </Label>
                  <ArabicDatePicker
                    value={elzamiAddon.end_date}
                    onChange={(d) => updateAddon('elzami', { end_date: d })}
                    disabled={disabled}
                    compact
                  />
                </div>
              </div>
            </div>
          </AddonCard>
        )}

        {/* THIRD_FULL Addon - Only show when main policy is ELZAMI */}
        {showThirdFullAddon && (
          <AddonCard
            type="third_full"
            title="ثالث/شامل"
            icon={Car}
            iconColor="text-blue-600"
            bgColor="bg-blue-50 dark:bg-blue-950/30"
            borderColor="border-blue-300 dark:border-blue-800"
            gradientClass="bg-gradient-to-br from-blue-100/70 via-blue-50/60 to-transparent dark:from-blue-950/40 dark:via-blue-950/20 dark:to-transparent"
            addon={thirdFullAddon}
            disabled={disabled}
            onToggle={() => updateAddon('third_full', { enabled: !thirdFullAddon.enabled })}
          >
            <div className="space-y-2.5">
              <div>
                <Label className="text-xs mb-1 block">النوع</Label>
                <Select
                  value={thirdFullAddon.policy_type_child || ""}
                  onValueChange={(v) => updateAddon('third_full', { policy_type_child: v as 'THIRD' | 'FULL' })}
                  disabled={disabled}
                >
                  <SelectTrigger className={cn("h-9 text-sm", errors.addon_thirdfull_child && "border-destructive")}>
                    <SelectValue placeholder="اختر النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="THIRD">ثالث</SelectItem>
                    <SelectItem value="FULL">شامل</SelectItem>
                  </SelectContent>
                </Select>
                {errors.addon_thirdfull_child && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.addon_thirdfull_child}
                  </p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <Label className="text-xs mb-0">الشركة</Label>
                  {onMinimizeAndNavigate && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onMinimizeAndNavigate("/companies"); }}
                      className="flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 hover:underline font-medium"
                      title="إدارة الشركات"
                    >
                      <Settings className="h-2.5 w-2.5" />
                      إدارة
                      <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
                <Select
                  value={thirdFullAddon.company_id || ""}
                  onValueChange={(v) => updateAddon('third_full', { company_id: v })}
                  disabled={disabled}
                >
                  <SelectTrigger className={cn("h-9 text-sm", errors.addon_thirdfull_company && "border-destructive")}>
                    <SelectValue placeholder="اختر الشركة" />
                  </SelectTrigger>
                  <SelectContent>
                    {thirdFullCompanies.length === 0 ? (
                      <SelectEmptyHint
                        label="شركات ثالث/شامل"
                        adminPath="/companies"
                        onNavigate={onMinimizeAndNavigate}
                      />
                    ) : (
                      thirdFullCompanies.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name_ar || c.name}
                          {c.broker_id && <span className="text-muted-foreground text-xs mr-1">(وسيط)</span>}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {errors.addon_thirdfull_company && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.addon_thirdfull_company}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs mb-1 block">السعر (₪)</Label>
                <Input
                  type="number"
                  value={thirdFullAddon.insurance_price}
                  onChange={(e) => updateAddon('third_full', { insurance_price: e.target.value })}
                  placeholder="0"
                  className={cn("h-9 text-sm font-bold", errors.addon_thirdfull_price && "border-destructive")}
                  disabled={disabled}
                />
                {errors.addon_thirdfull_price && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.addon_thirdfull_price}
                  </p>
                )}
              </div>
              {/* Date Fields */}
              <div className="space-y-2 pt-2 border-t border-dashed">
                <div>
                  <Label className="text-xs mb-1 block flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    تاريخ البداية
                  </Label>
                  <ArabicDatePicker
                    value={thirdFullAddon.start_date}
                    onChange={(d) => handleAddonStartDateChange('third_full', d)}
                    disabled={disabled}
                    compact
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    تاريخ النهاية
                  </Label>
                  <ArabicDatePicker
                    value={thirdFullAddon.end_date}
                    onChange={(d) => updateAddon('third_full', { end_date: d })}
                    disabled={disabled}
                    compact
                  />
                </div>
              </div>
            </div>
          </AddonCard>
        )}

        {/* Road Service Addon */}
        {showRoadServiceAddon && (
          <AddonCard
            type="road_service"
            title="خدمات الطريق"
            icon={Route}
            iconColor="text-orange-600"
            bgColor="bg-orange-50 dark:bg-orange-950/30"
            borderColor="border-orange-300 dark:border-orange-800"
            gradientClass="bg-gradient-to-br from-orange-100/70 via-orange-50/60 to-transparent dark:from-orange-950/40 dark:via-orange-950/20 dark:to-transparent"
            addon={roadServiceAddon}
            disabled={disabled}
            onToggle={() => updateAddon('road_service', { enabled: !roadServiceAddon.enabled })}
          >
            <div className="space-y-2.5">
              <div>
                <Label className="text-xs mb-1 block">نوع الخدمة</Label>
                <Select
                  value={roadServiceAddon.road_service_id || ""}
                  onValueChange={(v) => updateAddon('road_service', { road_service_id: v })}
                  disabled={disabled}
                >
                  <SelectTrigger className={cn("h-9 text-sm", errors.addon_road_service && "border-destructive")}>
                    <SelectValue placeholder="اختر الخدمة" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoadServices.length === 0 ? (
                      <SelectEmptyHint
                        label="خدمات طريق"
                        adminPath="/admin/road-services"
                        onNavigate={onMinimizeAndNavigate}
                      />
                    ) : (
                      availableRoadServices.map(rs => (
                        <SelectItem key={rs.id} value={rs.id}>
                          {rs.name_ar || rs.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {errors.addon_road_service && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.addon_road_service}
                  </p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <Label className="text-xs mb-0">الشركة</Label>
                  {onMinimizeAndNavigate && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onMinimizeAndNavigate("/companies"); }}
                      className="flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 hover:underline font-medium"
                      title="إدارة الشركات"
                    >
                      <Settings className="h-2.5 w-2.5" />
                      إدارة
                      <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
                <Select
                  value={roadServiceAddon.company_id || ""}
                  onValueChange={(v) => updateAddon('road_service', { company_id: v })}
                  disabled={disabled}
                >
                  <SelectTrigger className={cn("h-9 text-sm", errors.addon_road_company && "border-destructive")}>
                    <SelectValue placeholder="اختر الشركة" />
                  </SelectTrigger>
                  <SelectContent>
                    {roadServiceCompanies.length === 0 ? (
                      <SelectEmptyHint
                        label="شركات خدمات الطريق"
                        adminPath="/companies"
                        onNavigate={onMinimizeAndNavigate}
                      />
                    ) : (
                      roadServiceCompanies.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name_ar || c.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {errors.addon_road_company && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.addon_road_company}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs mb-1 block">السعر (₪)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={roadServiceAddon.insurance_price}
                    onChange={(e) => updateAddon('road_service', { insurance_price: e.target.value })}
                    placeholder="0"
                    className={cn("h-9 text-sm font-bold", errors.addon_road_price && "border-destructive")}
                    disabled={disabled || loadingRoadPrice}
                  />
                  {loadingRoadPrice && (
                    <Loader2 className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
                {errors.addon_road_price && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.addon_road_price}
                  </p>
                )}
              </div>
              {/* Date Fields */}
              <div className="space-y-2 pt-2 border-t border-dashed">
                <div>
                  <Label className="text-xs mb-1 block flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    تاريخ البداية
                  </Label>
                  <ArabicDatePicker
                    value={roadServiceAddon.start_date}
                    onChange={(d) => handleAddonStartDateChange('road_service', d)}
                    disabled={disabled}
                    compact
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    تاريخ النهاية
                  </Label>
                  <ArabicDatePicker
                    value={roadServiceAddon.end_date}
                    onChange={(d) => updateAddon('road_service', { end_date: d })}
                    disabled={disabled}
                    compact
                  />
                </div>
              </div>
            </div>
          </AddonCard>
        )}

        {/* Accident Fee Addon */}
        {showAccidentFeeAddon && (
          <AddonCard
            type="accident_fee_exemption"
            title="إعفاء رسوم حادث"
            icon={Shield}
            iconColor="text-emerald-600"
            bgColor="bg-emerald-50 dark:bg-emerald-950/30"
            borderColor="border-emerald-300 dark:border-emerald-800"
            gradientClass="bg-gradient-to-br from-emerald-100/70 via-emerald-50/60 to-transparent dark:from-emerald-950/40 dark:via-emerald-950/20 dark:to-transparent"
            addon={accidentFeeAddon}
            disabled={disabled}
            onToggle={() => updateAddon('accident_fee_exemption', { enabled: !accidentFeeAddon.enabled })}
          >
            <div className="space-y-2.5">
              <div>
                <Label className="text-xs mb-1 block">نوع الخدمة</Label>
                <Select
                  value={accidentFeeAddon.accident_fee_service_id || ""}
                  onValueChange={(v) => updateAddon('accident_fee_exemption', { accident_fee_service_id: v })}
                  disabled={disabled}
                >
                  <SelectTrigger className={cn("h-9 text-sm", errors.addon_accident_service && "border-destructive")}>
                    <SelectValue placeholder="اختر الخدمة" />
                  </SelectTrigger>
                  <SelectContent>
                    {accidentFeeServices.length === 0 ? (
                      <SelectEmptyHint
                        label="إعفاءات رسوم حادث"
                        adminPath="/admin/accident-fee-services"
                        onNavigate={onMinimizeAndNavigate}
                      />
                    ) : (
                      accidentFeeServices.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name_ar || s.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {errors.addon_accident_service && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.addon_accident_service}
                  </p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <Label className="text-xs mb-0">الشركة</Label>
                  {onMinimizeAndNavigate && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onMinimizeAndNavigate("/companies"); }}
                      className="flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 hover:underline font-medium"
                      title="إدارة الشركات"
                    >
                      <Settings className="h-2.5 w-2.5" />
                      إدارة
                      <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
                <Select
                  value={accidentFeeAddon.company_id || ""}
                  onValueChange={(v) => updateAddon('accident_fee_exemption', { company_id: v })}
                  disabled={disabled}
                >
                  <SelectTrigger className={cn("h-9 text-sm", errors.addon_accident_company && "border-destructive")}>
                    <SelectValue placeholder="اختر الشركة" />
                  </SelectTrigger>
                  <SelectContent>
                    {accidentFeeCompanies.length === 0 ? (
                      <SelectEmptyHint
                        label="شركات إعفاء حادث"
                        adminPath="/companies"
                        onNavigate={onMinimizeAndNavigate}
                      />
                    ) : (
                      accidentFeeCompanies.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name_ar || c.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {errors.addon_accident_company && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.addon_accident_company}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs mb-1 block">السعر (₪)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={accidentFeeAddon.insurance_price}
                    onChange={(e) => updateAddon('accident_fee_exemption', { insurance_price: e.target.value })}
                    placeholder="0"
                    className={cn("h-9 text-sm font-bold", errors.addon_accident_price && "border-destructive")}
                    disabled={disabled || loadingAccidentPrice}
                  />
                  {loadingAccidentPrice && (
                    <Loader2 className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
                {errors.addon_accident_price && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3" />
                    {errors.addon_accident_price}
                  </p>
                )}
              </div>
              {/* Date Fields */}
              <div className="space-y-2 pt-2 border-t border-dashed">
                <div>
                  <Label className="text-xs mb-1 block flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    تاريخ البداية
                  </Label>
                  <ArabicDatePicker
                    value={accidentFeeAddon.start_date}
                    onChange={(d) => handleAddonStartDateChange('accident_fee_exemption', d)}
                    disabled={disabled}
                    compact
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    تاريخ النهاية
                  </Label>
                  <ArabicDatePicker
                    value={accidentFeeAddon.end_date}
                    onChange={(d) => updateAddon('accident_fee_exemption', { end_date: d })}
                    disabled={disabled}
                    compact
                  />
                </div>
              </div>
            </div>
          </AddonCard>
        )}
      </div>
    </div>
  );
}