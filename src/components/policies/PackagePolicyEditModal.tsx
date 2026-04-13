import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Save, X, Shield, Car, Truck, FileCheck, Package, Calculator, User, Plus, Check, Phone, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { calculatePolicyProfit } from "@/lib/pricingCalculator";
import { formatCurrency } from "@/lib/utils";
import { digitsOnly, isValidIsraeliId } from "@/lib/validation";
import { ClientChild, NewChildForm, RELATION_OPTIONS, createEmptyChildForm } from "@/types/clientChildren";
import type { Enums } from "@/integrations/supabase/types";

// Helper to calculate end date (1 year - 1 day from start)
const calculateEndDate = (startDate: string): string => {
  if (!startDate) return "";
  const start = new Date(startDate);
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  return end.toISOString().split("T")[0];
};

// Helper to check if age is under 24
const isUnder24 = (birthDate: string | null): boolean | null => {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  const age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    return age - 1 < 24;
  }
  return age < 24;
};

// Format date for display
const formatBirthDate = (dateStr: string | null): string => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-GB");
};

interface PolicyData {
  id: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  is_under_24?: boolean | null;
  group_id: string | null;
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
    car_number: string | null;
  } | null;
  clients?: {
    full_name: string | null;
  } | null;
}

interface PackagePolicyEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string | null;
  initialPolicyId?: string | null;
  onSaved?: () => void;
}

interface EditState {
  startDate: string;
  endDate: string;
  issueDate: string;
  insurancePrice: string;
  companyId: string;
}

interface LookupOption {
  id: string;
  label: string;
}

const policyTypeLabels: Record<string, string> = {
  ELZAMI: "إلزامي",
  THIRD_FULL: "ثالث/شامل",
  ROAD_SERVICE: "خدمات الطريق",
  ACCIDENT_FEE_EXEMPTION: "إعفاء رسوم حادث",
};

const policyChildLabels: Record<string, string> = {
  THIRD: "طرف ثالث",
  FULL: "شامل",
};

const policyTypeConfig: Record<string, { icon: React.ElementType; bg: string; text: string; border: string }> = {
  ELZAMI: { icon: Shield, bg: "bg-blue-500/10", text: "text-blue-700", border: "border-blue-500/30" },
  THIRD_FULL: { icon: Car, bg: "bg-purple-500/10", text: "text-purple-700", border: "border-purple-500/30" },
  ROAD_SERVICE: { icon: Truck, bg: "bg-orange-500/10", text: "text-orange-700", border: "border-orange-500/30" },
  ACCIDENT_FEE_EXEMPTION: { icon: FileCheck, bg: "bg-green-500/10", text: "text-green-700", border: "border-green-500/30" },
};

// Sort order for policy types
const policyTypeSortOrder: Record<string, number> = {
  THIRD_FULL: 1,
  ELZAMI: 2,
  ROAD_SERVICE: 3,
  ACCIDENT_FEE_EXEMPTION: 4,
};

export function PackagePolicyEditModal({
  open,
  onOpenChange,
  groupId,
  initialPolicyId,
  onSaved,
}: PackagePolicyEditModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policies, setPolicies] = useState<PolicyData[]>([]);
  const [editStates, setEditStates] = useState<Record<string, EditState>>({});
  const [clientName, setClientName] = useState<string>("");
  const [carNumber, setCarNumber] = useState<string>("");
  
  // Extra drivers state
  const [clientId, setClientId] = useState<string | null>(null);
  const [existingChildren, setExistingChildren] = useState<ClientChild[]>([]);
  const [linkedChildIds, setLinkedChildIds] = useState<string[]>([]);
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [newChildren, setNewChildren] = useState<NewChildForm[]>([]);
  const [childErrors, setChildErrors] = useState<Record<string, Record<string, string>>>({});

  // Company / provider lookup lists keyed by policy type so the select for
  // each row shows only the right pool.
  const [elzamiCompanies, setElzamiCompanies] = useState<LookupOption[]>([]);
  const [thirdFullCompanies, setThirdFullCompanies] = useState<LookupOption[]>([]);
  const [roadServices, setRoadServices] = useState<LookupOption[]>([]);
  const [accidentFeeServices, setAccidentFeeServices] = useState<LookupOption[]>([]);

  const getCompanyOptions = useCallback(
    (policyType: string): LookupOption[] => {
      if (policyType === 'ELZAMI') return elzamiCompanies;
      if (policyType === 'THIRD_FULL') return thirdFullCompanies;
      if (policyType === 'ROAD_SERVICE') return roadServices;
      if (policyType === 'ACCIDENT_FEE_EXEMPTION') return accidentFeeServices;
      return [];
    },
    [elzamiCompanies, thirdFullCompanies, roadServices, accidentFeeServices],
  );

  // Fetch all policies in the package
  const fetchPolicies = useCallback(async () => {
    if (!groupId || !open) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("policies")
        .select(`
          id,
          policy_type_parent,
          policy_type_child,
          start_date,
          end_date,
          issue_date,
          insurance_price,
          is_under_24,
          group_id,
          client_id,
          insurance_companies (id, name, name_ar),
          road_services (id, name, name_ar),
          accident_fee_services (id, name, name_ar),
          cars (car_type, car_value, year, car_number),
          clients (full_name)
        `)
        .eq("group_id", groupId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      // Sort by policy type
      const sortedData = (data || []).sort((a, b) => {
        const orderA = policyTypeSortOrder[a.policy_type_parent] || 99;
        const orderB = policyTypeSortOrder[b.policy_type_parent] || 99;
        return orderA - orderB;
      });

      setPolicies(sortedData);

      // Initialize edit states
      const states: Record<string, EditState> = {};
      sortedData.forEach((p) => {
        let currentCompanyId = '';
        if (p.policy_type_parent === 'ROAD_SERVICE') currentCompanyId = p.road_services?.id || '';
        else if (p.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION') currentCompanyId = p.accident_fee_services?.id || '';
        else currentCompanyId = p.insurance_companies?.id || '';
        states[p.id] = {
          startDate: p.start_date || "",
          endDate: p.end_date || "",
          issueDate: (p as any).issue_date || p.start_date || "",
          insurancePrice: p.insurance_price?.toString() || "0",
          companyId: currentCompanyId,
        };
      });
      setEditStates(states);

      // Fetch the lookup tables in parallel so the selects populate before
      // the user starts editing.
      const [icRes, rsRes, afRes] = await Promise.all([
        supabase
          .from('insurance_companies')
          .select('id, name, name_ar, category_parent')
          .order('name_ar', { ascending: true }),
        supabase
          .from('road_services')
          .select('id, name, name_ar')
          .order('name_ar', { ascending: true }),
        supabase
          .from('accident_fee_services')
          .select('id, name, name_ar')
          .order('name_ar', { ascending: true }),
      ]);

      const toOption = (row: any): LookupOption => ({
        id: row.id,
        label: row.name_ar || row.name,
      });

      const icRows = (icRes.data || []) as any[];
      setElzamiCompanies(
        icRows.filter((r) => r.category_parent === 'ELZAMI').map(toOption),
      );
      setThirdFullCompanies(
        icRows.filter((r) => r.category_parent === 'THIRD_FULL' || r.category_parent === null).map(toOption),
      );
      setRoadServices((rsRes.data || []).map(toOption));
      setAccidentFeeServices((afRes.data || []).map(toOption));

      // Get client name, car number, and client_id from first policy
      if (sortedData.length > 0) {
        setClientName(sortedData[0].clients?.full_name || "");
        setCarNumber(sortedData[0].cars?.car_number || "");
        const cId = (sortedData[0] as any).client_id;
        setClientId(cId || null);
        
        // Fetch existing children for this client
        if (cId) {
          const { data: childrenData } = await supabase
            .from("client_children")
            .select("*")
            .eq("client_id", cId)
            .order("created_at", { ascending: true });
          setExistingChildren(childrenData || []);
          
          // Find the main policy (THIRD_FULL) to get linked children
          const mainPolicy = sortedData.find(p => p.policy_type_parent === "THIRD_FULL");
          if (mainPolicy) {
            const { data: linkedData } = await supabase
              .from("policy_children")
              .select("child_id")
              .eq("policy_id", mainPolicy.id);
            const ids = (linkedData || []).map(l => l.child_id);
            setLinkedChildIds(ids);
            setSelectedChildIds(ids);
          }
        }
      }
    } catch (error) {
      console.error("Error fetching package policies:", error);
      toast({
        title: "خطأ",
        description: "فشل في تحميل الوثائق",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [groupId, open, toast]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setPolicies([]);
      setEditStates({});
      setClientName("");
      setCarNumber("");
      setClientId(null);
      setExistingChildren([]);
      setLinkedChildIds([]);
      setSelectedChildIds([]);
      setNewChildren([]);
      setChildErrors({});
    }
  }, [open]);

  const getTypeName = (policy: PolicyData) => {
    if (policy.policy_type_parent === "THIRD_FULL" && policy.policy_type_child) {
      return policyChildLabels[policy.policy_type_child] || policy.policy_type_child;
    }
    return policyTypeLabels[policy.policy_type_parent] || policy.policy_type_parent;
  };

  const getCompanyName = (policy: PolicyData) => {
    if (policy.policy_type_parent === "ROAD_SERVICE" && policy.road_services) {
      return policy.road_services.name_ar || policy.road_services.name;
    }
    if (policy.policy_type_parent === "ACCIDENT_FEE_EXEMPTION" && policy.accident_fee_services) {
      return policy.accident_fee_services.name_ar || policy.accident_fee_services.name;
    }
    if (policy.insurance_companies) {
      return policy.insurance_companies.name_ar || policy.insurance_companies.name;
    }
    return "-";
  };

  const updateEditState = (policyId: string, field: keyof EditState, value: string) => {
    setEditStates((prev) => {
      const newState = { ...prev[policyId], [field]: value };
      
      // Auto-calculate end date when start date changes
      if (field === "startDate" && value) {
        newState.endDate = calculateEndDate(value);
      }
      
      return { ...prev, [policyId]: newState };
    });
  };

  // Toggle child selection
  const toggleChild = (childId: string) => {
    if (selectedChildIds.includes(childId)) {
      setSelectedChildIds(selectedChildIds.filter(id => id !== childId));
    } else {
      setSelectedChildIds([...selectedChildIds, childId]);
    }
  };

  // Validate new child form
  const validateNewChild = (child: NewChildForm, allNewChildren: NewChildForm[]): Record<string, string> => {
    const errors: Record<string, string> = {};
    
    if (!child.full_name.trim()) {
      errors.full_name = "الاسم مطلوب";
    }
    
    if (!child.id_number.trim()) {
      errors.id_number = "رقم الهوية مطلوب";
    } else if (!isValidIsraeliId(child.id_number)) {
      errors.id_number = "رقم هوية غير صالح";
    } else {
      const normalized = digitsOnly(child.id_number).trim();
      const duplicateInNew = allNewChildren.some(
        c => c.id !== child.id && digitsOnly(c.id_number).trim() === normalized
      );
      const duplicateInExisting = existingChildren.some(
        c => digitsOnly(c.id_number).trim() === normalized
      );
      
      if (duplicateInNew) {
        errors.id_number = "رقم الهوية مكرر في القائمة";
      } else if (duplicateInExisting) {
        errors.id_number = "رقم الهوية موجود مسبقاً للعميل";
      }
    }
    
    return errors;
  };

  // Add new child form
  const handleAddNewChild = () => {
    setNewChildren((prev) => [...prev, createEmptyChildForm()]);
  };
  
  // Ref for auto-scroll to new child
  const newChildBottomRef = useRef<HTMLDivElement>(null);
  const prevNewChildrenLengthRef = useRef(newChildren.length);
  
  // Auto-scroll when new child is added
  useEffect(() => {
    if (newChildren.length > prevNewChildrenLengthRef.current) {
      setTimeout(() => {
        newChildBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 100);
    }
    prevNewChildrenLengthRef.current = newChildren.length;
  }, [newChildren.length]);

  // Update new child field
  const handleUpdateNewChild = (index: number, field: keyof NewChildForm, value: string) => {
    const updated = [...newChildren];
    updated[index] = { ...updated[index], [field]: value };
    setNewChildren(updated);

    // Recompute errors
    const nextErrors: Record<string, Record<string, string>> = {};
    for (const c of updated) {
      nextErrors[c.id] = validateNewChild(c, updated);
    }
    setChildErrors(nextErrors);
  };

  // Remove new child form
  const handleRemoveNewChild = (index: number) => {
    const updated = newChildren.filter((_, i) => i !== index);
    setNewChildren(updated);

    const nextErrors: Record<string, Record<string, string>> = {};
    for (const c of updated) {
      nextErrors[c.id] = validateNewChild(c, updated);
    }
    setChildErrors(nextErrors);
  };

  const calculateTotal = () => {
    return Object.values(editStates).reduce((sum, state) => {
      return sum + (parseFloat(state.insurancePrice) || 0);
    }, 0);
  };

  const handleSaveAll = async () => {
    if (policies.length === 0) return;

    // Validate new children before saving
    const hasErrors = newChildren.some(child => {
      const errors = validateNewChild(child, newChildren);
      return Object.keys(errors).length > 0;
    });

    if (hasErrors) {
      toast({
        title: "خطأ في البيانات",
        description: "يرجى تصحيح أخطاء السائقين الإضافيين",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // 1. Create new children if any
      const newChildIds: string[] = [];
      if (clientId && newChildren.length > 0) {
        for (const child of newChildren) {
          const { data: inserted, error: insertError } = await supabase
            .from("client_children")
            .insert({
              client_id: clientId,
              full_name: child.full_name,
              id_number: digitsOnly(child.id_number),
              birth_date: child.birth_date || null,
              phone: child.phone || null,
              relation: child.relation || null,
              notes: child.notes || null,
            })
            .select("id")
            .single();
          
          if (insertError) throw insertError;
          if (inserted) newChildIds.push(inserted.id);
        }
      }

      // 2. Update policy_children for main policy (THIRD_FULL)
      const mainPolicy = policies.find(p => p.policy_type_parent === "THIRD_FULL");
      if (mainPolicy) {
        const allSelectedIds = [...selectedChildIds, ...newChildIds];
        
        // Remove old links that are no longer selected
        const toRemove = linkedChildIds.filter(id => !allSelectedIds.includes(id));
        if (toRemove.length > 0) {
          await supabase
            .from("policy_children")
            .delete()
            .eq("policy_id", mainPolicy.id)
            .in("child_id", toRemove);
        }
        
        // Add new links
        const toAdd = allSelectedIds.filter(id => !linkedChildIds.includes(id));
        if (toAdd.length > 0) {
          await supabase
            .from("policy_children")
            .insert(toAdd.map(childId => ({
              policy_id: mainPolicy.id,
              child_id: childId,
            })));
        }
      }

      // 3. Process each policy
      for (const policy of policies) {
        const state = editStates[policy.id];
        if (!state) continue;

        const price = parseFloat(state.insurancePrice) || 0;
        let companyPayment = price;
        let profit = 0;

        // Resolve the selected company/provider id for this policy type.
        const selectedId = state.companyId || '';

        // Recalculate profit based on policy type using the edited company.
        if (policy.policy_type_parent === "ELZAMI") {
          const { data: companyData } = await supabase
            .from("insurance_companies")
            .select("elzami_commission")
            .eq("id", selectedId)
            .single();
          profit = companyData?.elzami_commission || 0;
          companyPayment = price;
        } else if (policy.policy_type_parent === "ROAD_SERVICE") {
          if (selectedId) {
            const { data: priceData } = await supabase
              .from("company_road_service_prices")
              .select("company_cost")
              .eq("road_service_id", selectedId)
              .limit(1)
              .maybeSingle();
            companyPayment = priceData?.company_cost || price;
          }
          profit = price - companyPayment;
        } else if (policy.policy_type_parent === "ACCIDENT_FEE_EXEMPTION") {
          if (selectedId) {
            const { data: priceData } = await supabase
              .from("company_accident_fee_prices")
              .select("company_cost")
              .eq("accident_fee_service_id", selectedId)
              .limit(1)
              .maybeSingle();
            companyPayment = priceData?.company_cost || price;
          }
          profit = price - companyPayment;
        } else if (policy.policy_type_parent === "THIRD_FULL" && selectedId) {
          const ageBand: Enums<"age_band"> = policy.is_under_24 ? "UNDER_24" : "UP_24";
          const result = await calculatePolicyProfit({
            policyTypeParent: policy.policy_type_parent as Enums<"policy_type_parent">,
            policyTypeChild: (policy.policy_type_child || null) as Enums<"policy_type_child"> | null,
            companyId: selectedId,
            carType: (policy.cars?.car_type || "car") as Enums<"car_type">,
            ageBand,
            carValue: policy.cars?.car_value || null,
            carYear: policy.cars?.year || null,
            insurancePrice: price,
          });
          companyPayment = result.companyPayment;
          profit = result.profit;
        }

        // Build the update payload — route the selected id to the correct
        // foreign-key column depending on policy type.
        const updatePayload: Record<string, any> = {
          start_date: state.startDate,
          end_date: state.endDate,
          issue_date: state.issueDate || state.startDate,
          insurance_price: price,
          payed_for_company: companyPayment,
          profit,
          updated_at: new Date().toISOString(),
        };
        if (policy.policy_type_parent === 'ROAD_SERVICE') {
          updatePayload.road_service_id = selectedId || null;
        } else if (policy.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION') {
          updatePayload.accident_fee_service_id = selectedId || null;
        } else {
          updatePayload.company_id = selectedId || null;
        }

        const { error } = await supabase
          .from("policies")
          .update(updatePayload)
          .eq("id", policy.id);

        if (error) throw error;
      }

      toast({ title: "تم الحفظ", description: "تم تحديث جميع وثائق الباقة بنجاح" });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error("Error saving policies:", error);
      toast({
        title: "خطأ",
        description: "فشل في حفظ التغييرات",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!groupId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden !flex !flex-col p-6" dir="rtl">
        <DialogHeader className="text-right shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10">
              <Package className="h-4 w-4 text-primary" />
            </div>
            <div>
              <span>تعديل الباقة</span>
              {clientName && (
                <span className="text-muted-foreground font-normal mr-2">
                  - {clientName}
                </span>
              )}
              {carNumber && (
                <span className="font-mono text-muted-foreground font-normal mr-1 ltr-nums">
                  ({carNumber})
                </span>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : policies.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            لا توجد وثائق في هذه الباقة
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <ScrollArea dir="rtl" className="flex-1 min-h-0 -mx-6 px-6">
              <div className="space-y-2 py-1">
                {policies.map((policy) => {
                  const config = policyTypeConfig[policy.policy_type_parent] || policyTypeConfig.ELZAMI;
                  const Icon = config.icon;
                  const state = editStates[policy.id];

                  const companyOptions = getCompanyOptions(policy.policy_type_parent);
                  const companyLabel = policy.policy_type_parent === 'ROAD_SERVICE'
                    ? 'الخدمة'
                    : policy.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION'
                      ? 'الخدمة'
                      : 'شركة التأمين';

                  return (
                    <div
                      key={policy.id}
                      className={cn(
                        "rounded-xl border p-3 space-y-3",
                        config.border,
                        config.bg,
                      )}
                    >
                      {/* Header */}
                      <div className="flex items-center gap-2">
                        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center bg-white/70 border", config.border)}>
                          <Icon className={cn("h-4 w-4", config.text)} />
                        </div>
                        <Badge className={cn("text-xs font-bold", config.bg, config.text, "border", config.border)}>
                          {getTypeName(policy)}
                        </Badge>
                      </div>

                      {/* Company selector */}
                      <div className="space-y-1">
                        <Label className="text-xs font-semibold text-foreground/80">{companyLabel}</Label>
                        <Select
                          value={state?.companyId || ''}
                          onValueChange={(v) => updateEditState(policy.id, 'companyId', v)}
                        >
                          <SelectTrigger className="h-9 text-sm bg-background">
                            <SelectValue placeholder="اختر..." />
                          </SelectTrigger>
                          <SelectContent>
                            {companyOptions.length === 0 ? (
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">لا توجد خيارات متاحة</div>
                            ) : (
                              companyOptions.map((opt) => (
                                <SelectItem key={opt.id} value={opt.id}>
                                  {opt.label}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Dates + Price */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-foreground/80">تاريخ الإصدار</Label>
                          <ArabicDatePicker
                            value={state?.issueDate || ""}
                            onChange={(v) => updateEditState(policy.id, "issueDate", v)}
                            compact
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-foreground/80">تاريخ البدء</Label>
                          <ArabicDatePicker
                            value={state?.startDate || ""}
                            onChange={(v) => updateEditState(policy.id, "startDate", v)}
                            compact
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-foreground/80">تاريخ الانتهاء</Label>
                          <ArabicDatePicker
                            value={state?.endDate || ""}
                            onChange={(v) => updateEditState(policy.id, "endDate", v)}
                            compact
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-foreground/80">السعر (₪)</Label>
                          <Input
                            type="number"
                            value={state?.insurancePrice || "0"}
                            onChange={(e) => updateEditState(policy.id, "insurancePrice", e.target.value)}
                            className="h-9 text-left ltr-nums text-sm font-semibold bg-background"
                            min="0"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Extra Drivers Section */}
                {clientId && (
                  <div className="space-y-2 p-2 bg-muted/30 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        <User className="h-3.5 w-3.5" />
                        السائقين الإضافيين / التابعين
                      </h4>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAddNewChild}
                        className="gap-1 h-7 text-xs"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        إضافة جديد
                      </Button>
                    </div>

                    {/* Existing Children - Checkboxes */}
                    {existingChildren.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">اختر من التابعين الموجودين:</Label>
                        <div className="grid gap-1">
                          {existingChildren.map((child) => (
                            <label
                              key={child.id}
                              className={cn(
                                "flex items-center gap-2 p-1.5 rounded-md border cursor-pointer transition-colors",
                                selectedChildIds.includes(child.id)
                                  ? "bg-primary/10 border-primary"
                                  : "bg-background hover:bg-muted/50"
                              )}
                            >
                              <Checkbox
                                checked={selectedChildIds.includes(child.id)}
                                onCheckedChange={() => toggleChild(child.id)}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm flex items-center gap-2">
                                  {child.full_name}
                                  {isUnder24(child.birth_date) === true && (
                                    <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 border-amber-500/30">
                                      أقل من 24
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                                  <span className="font-mono ltr-nums">{child.id_number}</span>
                                  {child.relation && <span>• {child.relation}</span>}
                                  {child.birth_date && (
                                    <span className="flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />
                                      <span className="ltr-nums">{formatBirthDate(child.birth_date)}</span>
                                    </span>
                                  )}
                                  {child.phone && (
                                    <span className="flex items-center gap-1">
                                      <Phone className="h-3 w-3" />
                                      <span className="font-mono ltr-nums">{child.phone}</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                              {selectedChildIds.includes(child.id) && (
                                <Check className="h-3.5 w-3.5 text-primary" />
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* New Children Forms */}
                    {newChildren.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">تابعين جدد (سيتم إضافتهم للعميل):</Label>
                        {newChildren.map((child, index) => {
                          const errors = childErrors[child.id] || {};
                          const isLast = index === newChildren.length - 1;
                          
                          return (
                            <div
                              key={child.id}
                              className="p-2 rounded-lg border bg-background space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground">
                                  سائق جديد #{index + 1}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 text-xs text-destructive hover:text-destructive px-2"
                                  onClick={() => handleRemoveNewChild(index)}
                                >
                                  حذف
                                </Button>
                              </div>
                              
                              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
                                {/* Full Name */}
                                <div className="space-y-0.5">
                                  <Label className="text-xs">
                                    الاسم <span className="text-destructive">*</span>
                                  </Label>
                                  <Input
                                    value={child.full_name}
                                    onChange={(e) => handleUpdateNewChild(index, 'full_name', e.target.value)}
                                    placeholder="الاسم الكامل"
                                    className={cn("h-8 text-sm", errors.full_name && "border-destructive")}
                                    autoFocus={isLast}
                                  />
                                  {errors.full_name && (
                                    <p className="text-xs text-destructive">{errors.full_name}</p>
                                  )}
                                </div>
                                
                                {/* ID Number */}
                                <div className="space-y-0.5">
                                  <Label className="text-xs">
                                    رقم الهوية <span className="text-destructive">*</span>
                                  </Label>
                                  <Input
                                    value={child.id_number}
                                    onChange={(e) => handleUpdateNewChild(index, 'id_number', digitsOnly(e.target.value).slice(0, 9))}
                                    placeholder="9 أرقام"
                                    maxLength={9}
                                    className={cn("h-8 text-sm ltr-input", errors.id_number && "border-destructive")}
                                  />
                                  {errors.id_number && (
                                    <p className="text-xs text-destructive">{errors.id_number}</p>
                                  )}
                                </div>
                                
                                {/* Relation */}
                                <div className="space-y-0.5">
                                  <Label className="text-xs">الصلة</Label>
                                  <Select
                                    value={child.relation}
                                    onValueChange={(v) => handleUpdateNewChild(index, 'relation', v)}
                                  >
                                    <SelectTrigger className="h-8 text-sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {RELATION_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* Birth Date */}
                                <div className="space-y-0.5">
                                  <Label className="text-xs">تاريخ الميلاد</Label>
                                  <ArabicDatePicker
                                    value={child.birth_date}
                                    onChange={(v) => handleUpdateNewChild(index, 'birth_date', v)}
                                    isBirthDate
                                    compact
                                  />
                                </div>

                                {/* Phone */}
                                <div className="space-y-0.5">
                                  <Label className="text-xs">الهاتف</Label>
                                  <Input
                                    value={child.phone}
                                    onChange={(e) => handleUpdateNewChild(index, 'phone', digitsOnly(e.target.value).slice(0, 10))}
                                    placeholder="05xxxxxxxx"
                                    maxLength={10}
                                    inputMode="numeric"
                                    className="h-8 text-sm ltr-input"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={newChildBottomRef} />
                      </div>
                    )}

                    {existingChildren.length === 0 && newChildren.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-1">
                        لا يوجد تابعين لهذا العميل. اضغط "إضافة جديد" لإضافة سائق إضافي.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Total Summary */}
            <div className="shrink-0 border-t pt-3 mt-1">
              <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calculator className="h-4 w-4" />
                  <span className="font-medium text-sm">إجمالي الباقة</span>
                </div>
                <div className="text-xl font-bold text-primary ltr-nums">
                  {formatCurrency(calculateTotal())}
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 shrink-0 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            <X className="h-4 w-4 ml-1" />
            إلغاء
          </Button>
          <Button onClick={handleSaveAll} disabled={saving || loading || policies.length === 0}>
            {saving ? (
              <Loader2 className="h-4 w-4 ml-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 ml-1" />
            )}
            حفظ جميع التغييرات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
