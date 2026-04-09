import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Save, X } from "lucide-react";
import { calculatePolicyProfit } from "@/lib/pricingCalculator";
import type { Enums } from "@/integrations/supabase/types";

interface PolicyEditDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy: {
    id: string;
    group_id?: string | null;
    policy_type_parent: string;
    policy_type_child: string | null;
    start_date: string;
    end_date: string;
    insurance_price: number;
    cancelled: boolean | null;
    transferred: boolean | null;
    transferred_car_number: string | null;
    is_under_24: boolean | null;
    notes: string | null;
    broker_id: string | null;
    clients: {
      id: string;
      full_name: string;
      less_than_24: boolean | null;
      under24_type?: 'none' | 'client' | 'additional_driver' | null;
      under24_driver_name?: string | null;
      under24_driver_id?: string | null;
    };
    cars: {
      id: string;
      car_number: string;
      car_type: string | null;
      car_value: number | null;
      year: number | null;
    } | null;
    insurance_companies: {
      id: string;
      name: string;
      name_ar: string | null;
    } | null;
  };
  onSaved?: () => void;
}

interface PackagePolicy {
  id: string;
  policy_type_parent: string;
  start_date: string;
  end_date: string;
}

interface Company {
  id: string;
  name: string;
  name_ar: string | null;
  category_parent: string[] | null;
  elzami_commission: number | null;
}

interface Broker {
  id: string;
  name: string;
}

const NO_BROKER = "__NO_BROKER__";

const POLICY_TYPES = [
  { value: "ELZAMI", label: "إلزامي" },
  { value: "THIRD_FULL", label: "ثالث/شامل", hasChild: true },
  { value: "ROAD_SERVICE", label: "خدمات الطريق" },
  { value: "ACCIDENT_FEE_EXEMPTION", label: "إعفاء رسوم حادث" },
];

export function PolicyEditDrawer({ open, onOpenChange, policy, onSaved }: PolicyEditDrawerProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [packagePolicies, setPackagePolicies] = useState<PackagePolicy[]>([]);
  const [showPackageDateSync, setShowPackageDateSync] = useState(false);
  const [pendingSave, setPendingSave] = useState<{ syncDates: boolean } | null>(null);
  const [originalDates, setOriginalDates] = useState({ start_date: '', end_date: '' });

  // Determine initial under24_type from client data or fallback to policy is_under_24
  const getInitialUnder24Type = (): 'none' | 'client' | 'additional_driver' => {
    if (policy.clients?.under24_type && policy.clients.under24_type !== 'none') {
      return policy.clients.under24_type;
    }
    // Fallback for legacy data: if is_under_24 is true but no under24_type, assume 'client'
    if (policy.is_under_24 || policy.clients?.less_than_24) {
      return 'client';
    }
    return 'none';
  };

  const [formData, setFormData] = useState({
    policy_type_parent: policy.policy_type_parent,
    policy_type_child: policy.policy_type_child || "",
    company_id: policy.insurance_companies?.id || "",
    start_date: policy.start_date,
    end_date: policy.end_date,
    insurance_price: policy.insurance_price?.toString() || "0",
    office_commission: "0", // Will be fetched from DB
    issue_date: "", // Will be fetched from DB
    cancelled: policy.cancelled || false,
    transferred: policy.transferred || false,
    transferred_car_number: policy.transferred_car_number || "",
    is_under_24: policy.is_under_24 || false,
    notes: policy.notes || "",
    broker_id: policy.broker_id ?? NO_BROKER,
    under24_type: getInitialUnder24Type(),
    under24_driver_name: policy.clients?.under24_driver_name || "",
    under24_driver_id: policy.clients?.under24_driver_id || "",
  });

  useEffect(() => {
    if (open) {
      fetchCompanies(policy.policy_type_parent);
      fetchBrokers();
      fetchPackagePolicies();
      const initialUnder24Type = (): 'none' | 'client' | 'additional_driver' => {
        if (policy.clients?.under24_type && policy.clients.under24_type !== 'none') {
          return policy.clients.under24_type;
        }
        if (policy.is_under_24 || policy.clients?.less_than_24) {
          return 'client';
        }
        return 'none';
      };

      const initialFormData = {
        policy_type_parent: policy.policy_type_parent,
        policy_type_child: policy.policy_type_child || "",
        company_id: policy.insurance_companies?.id || "",
        start_date: policy.start_date,
        end_date: policy.end_date,
        insurance_price: policy.insurance_price?.toString() || "0",
        office_commission: "0",
        issue_date: "",
        cancelled: policy.cancelled || false,
        transferred: policy.transferred || false,
        transferred_car_number: policy.transferred_car_number || "",
        is_under_24: policy.is_under_24 || false,
        notes: policy.notes || "",
        broker_id: policy.broker_id ?? NO_BROKER,
        under24_type: initialUnder24Type(),
        under24_driver_name: policy.clients?.under24_driver_name || "",
        under24_driver_id: policy.clients?.under24_driver_id || "",
      };
      
      setFormData(initialFormData);
      setOriginalDates({ start_date: policy.start_date, end_date: policy.end_date });

      // Fetch office_commission and issue_date from DB
      const fetchExtraFields = async () => {
        const { data } = await supabase
          .from('policies')
          .select('office_commission, issue_date')
          .eq('id', policy.id)
          .single();
        if (data) {
          setFormData(f => ({
            ...f,
            office_commission: data.office_commission != null ? data.office_commission.toString() : "0",
            issue_date: data.issue_date || f.start_date || "",
          }));
        }
      };
      fetchExtraFields();
    }
  }, [open, policy]);

  const fetchPackagePolicies = async () => {
    if (!policy.group_id) {
      setPackagePolicies([]);
      return;
    }
    
    const { data } = await supabase
      .from('policies')
      .select('id, policy_type_parent, start_date, end_date')
      .eq('group_id', policy.group_id)
      .neq('id', policy.id)
      .is('deleted_at', null)
      .eq('cancelled', false);
    
    setPackagePolicies(data || []);
  };

  const fetchCompanies = async (policyType?: string) => {
    setLoadingCompanies(true);
    let query = supabase
      .from('insurance_companies')
      .select('id, name, name_ar, category_parent, elzami_commission')
      .eq('active', true)
      .is('broker_id', null)
      .order('name');

    // Filter by category_parent array contains
    if (policyType) {
      query = query.contains('category_parent', [policyType]);
    }

    const { data } = await query;
    setLoadingCompanies(false);
    if (data) setCompanies(data as Company[]);
  };

  const fetchBrokers = async () => {
    const { data } = await supabase
      .from('brokers')
      .select('id, name')
      .order('name');
    if (data) setBrokers(data);
  };

  const handleSave = async (syncPackageDates: boolean = false) => {
    // Validate additional driver fields if selected
    if (formData.under24_type === 'additional_driver') {
      if (!formData.under24_driver_name?.trim() || !formData.under24_driver_id?.trim()) {
        toast({ 
          title: "خطأ", 
          description: "يجب إدخال اسم السائق ورقم هويته", 
          variant: "destructive" 
        });
        return;
      }
    }

    // Check if dates changed and there are package policies
    const datesChanged = formData.start_date !== originalDates.start_date || formData.end_date !== originalDates.end_date;
    if (datesChanged && packagePolicies.length > 0 && !pendingSave) {
      setShowPackageDateSync(true);
      return;
    }

    setSaving(true);
    try {
      const insurancePrice = parseFloat(formData.insurance_price) || 0;
      
      let companyPayment = insurancePrice;
      let profit = 0;

      if (formData.policy_type_parent === 'ELZAMI') {
        // For ELZAMI: profit = commission, companyPayment = insurance_price
        const selectedCompany = companies.find(c => c.id === formData.company_id);
        profit = selectedCompany?.elzami_commission || 0;
        companyPayment = insurancePrice;
      } else {
        const ageBand: Enums<'age_band'> = formData.under24_type !== 'none' ? 'UNDER_24' : 'UP_24';
        const result = await calculatePolicyProfit({
          policyTypeParent: formData.policy_type_parent as Enums<'policy_type_parent'>,
          policyTypeChild: (formData.policy_type_child || null) as Enums<'policy_type_child'> | null,
          companyId: formData.company_id,
          carType: (policy.cars?.car_type || 'car') as Enums<'car_type'>,
          ageBand,
          carValue: policy.cars?.car_value || null,
          carYear: policy.cars?.year || null,
          insurancePrice,
        });
        companyPayment = result.companyPayment;
        profit = result.profit;
      }

      // Update client's under24 fields
      await supabase
        .from('clients')
        .update({
          under24_type: formData.under24_type,
          under24_driver_name: formData.under24_type === 'additional_driver' ? formData.under24_driver_name : null,
          under24_driver_id: formData.under24_type === 'additional_driver' ? formData.under24_driver_id : null,
          less_than_24: formData.under24_type !== 'none',
          updated_at: new Date().toISOString(),
        })
        .eq('id', policy.clients.id);

      const { error } = await supabase
        .from('policies')
        .update({
          policy_type_parent: formData.policy_type_parent as Enums<'policy_type_parent'>,
          policy_type_child: formData.policy_type_child ? formData.policy_type_child as Enums<'policy_type_child'> : null,
          company_id: formData.company_id || null,
          start_date: formData.start_date,
          end_date: formData.end_date,
          insurance_price: insurancePrice,
          payed_for_company: companyPayment,
          profit,
          office_commission: parseFloat(formData.office_commission) || 0,
          cancelled: formData.cancelled,
          transferred: formData.transferred,
          transferred_car_number: formData.transferred ? formData.transferred_car_number : null,
          issue_date: formData.issue_date || formData.start_date,
          is_under_24: formData.under24_type !== 'none',
          notes: formData.notes || null,
          broker_id: formData.broker_id === NO_BROKER ? null : formData.broker_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', policy.id);

      if (error) throw error;

      // Sync package dates if requested
      if (syncPackageDates && packagePolicies.length > 0) {
        const { error: syncError } = await supabase
          .from('policies')
          .update({
            start_date: formData.start_date,
            end_date: formData.end_date,
            updated_at: new Date().toISOString(),
          })
          .in('id', packagePolicies.map(p => p.id));
        
        if (syncError) {
          console.error('Error syncing package dates:', syncError);
          toast({ title: "تنبيه", description: "تم حفظ الوثيقة لكن فشل تحديث باقي الباكيج", variant: "default" });
        }
      }


      toast({ title: "تم الحفظ", description: "تم تحديث الوثيقة بنجاح" });
      setPendingSave(null);
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error('Error saving policy:', error);
      toast({ title: "خطأ", description: "فشل في حفظ التغييرات", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handlePackageSyncConfirm = (sync: boolean) => {
    setShowPackageDateSync(false);
    setPendingSave({ syncDates: sync });
    handleSave(sync);
  };

  const selectedType = POLICY_TYPES.find(t => t.value === formData.policy_type_parent);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-lg p-0 overflow-hidden"
        dir="rtl"
      >
        <DialogHeader className="p-4 border-b bg-muted/30 text-right">
          <DialogTitle className="text-lg font-bold text-right">تعديل الوثيقة</DialogTitle>
          <p className="text-sm text-muted-foreground text-right">
            {policy.clients?.full_name || ''} - {policy.cars?.car_number || ''}
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="p-4 space-y-4">
            {/* Policy Type Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-right block text-sm">نوع الوثيقة</Label>
                <Select
                  value={formData.policy_type_parent}
                  onValueChange={(v) => {
                    setFormData(f => ({ 
                      ...f, 
                      policy_type_parent: v,
                      policy_type_child: POLICY_TYPES.find(t => t.value === v)?.hasChild ? f.policy_type_child : "",
                      company_id: ""
                    }));
                    fetchCompanies(v);
                  }}
                >
                  <SelectTrigger className="h-9 text-right">
                    <SelectValue placeholder="اختر النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    {POLICY_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value} className="text-right">
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedType?.hasChild && (
                <div className="space-y-1.5">
                  <Label className="text-right block text-sm">النوع الفرعي</Label>
                  <Select
                    value={formData.policy_type_child}
                    onValueChange={(v) => setFormData(f => ({ ...f, policy_type_child: v }))}
                  >
                    <SelectTrigger className="h-9 text-right">
                      <SelectValue placeholder="اختر" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="THIRD" className="text-right">طرف ثالث</SelectItem>
                      <SelectItem value="FULL" className="text-right">شامل</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Company & Broker Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-right block text-sm">شركة التأمين</Label>
                <Select
                  value={formData.company_id}
                  onValueChange={(v) => setFormData(f => ({ ...f, company_id: v }))}
                  disabled={!formData.policy_type_parent}
                >
                  <SelectTrigger className={`h-9 text-right ${!formData.policy_type_parent ? "opacity-50" : ""}`}>
                    <SelectValue placeholder={formData.policy_type_parent ? "اختر" : "اختر النوع أولاً"} />
                  </SelectTrigger>
                  <SelectContent>
                    {loadingCompanies ? (
                      <div className="p-2 text-center text-sm text-muted-foreground">جاري التحميل...</div>
                    ) : companies.length === 0 ? (
                      <div className="p-2 text-center text-sm text-muted-foreground">لا توجد شركات</div>
                    ) : (
                      companies.map(company => (
                        <SelectItem key={company.id} value={company.id} className="text-right">
                          {company.name_ar || company.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-right block text-sm">الوسيط</Label>
                <Select
                  value={formData.broker_id}
                  onValueChange={(v) => setFormData(f => ({ ...f, broker_id: v }))}
                >
                  <SelectTrigger className="h-9 text-right">
                    <SelectValue placeholder="اختياري" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_BROKER} className="text-right">بدون وسيط</SelectItem>
                    {brokers.map(broker => (
                      <SelectItem key={broker.id} value={broker.id} className="text-right">
                        {broker.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Dates Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-right block text-sm">تاريخ البدء</Label>
                <ArabicDatePicker
                  value={formData.start_date}
                  onChange={(v) => setFormData(f => ({ ...f, start_date: v }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-right block text-sm">تاريخ الانتهاء</Label>
                <ArabicDatePicker
                  value={formData.end_date}
                  onChange={(v) => setFormData(f => ({ ...f, end_date: v }))}
                />
              </div>
            </div>

            {/* Issue Date - for all types */}
            <div className="space-y-1.5">
              <Label className="text-right block text-sm text-primary">تاريخ الإصدار</Label>
              <ArabicDatePicker
                value={formData.issue_date}
                onChange={(v) => setFormData(f => ({ ...f, issue_date: v }))}
              />
              <p className="text-xs text-muted-foreground">
                التاريخ الذي تحسبه الشركة (افتراضياً = تاريخ البدء)
              </p>
            </div>

            {/* Price */}
            <div className="space-y-1.5">
              <Label className="text-right block text-sm">سعر التأمين (₪)</Label>
              <Input
                type="number"
                value={formData.insurance_price}
                onChange={(e) => setFormData(f => ({ ...f, insurance_price: e.target.value }))}
                className="h-9 text-left ltr-input"
              />
            </div>

            {/* Office Commission - only for ELZAMI */}
            {formData.policy_type_parent === 'ELZAMI' && (
              <div className="space-y-1.5">
                <Label className="text-right block text-sm text-amber-600">عمولة للمكتب (₪)</Label>
                <Input
                  type="number"
                  value={formData.office_commission}
                  onChange={(e) => setFormData(f => ({ ...f, office_commission: e.target.value }))}
                  className="h-9 text-left ltr-input"
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  تدخل في حساب العميل كدين
                </p>
              </div>
            )}

            {/* ELZAMI Commission Display */}
            {formData.policy_type_parent === 'ELZAMI' && formData.company_id && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-blue-700 dark:text-blue-300">العمولة (الربح)</Label>
                  <span className={`text-lg font-bold ${
                    (companies.find(c => c.id === formData.company_id)?.elzami_commission || 0) >= 0 
                      ? 'text-green-600' 
                      : 'text-red-600'
                  }`}>
                    ₪{(companies.find(c => c.id === formData.company_id)?.elzami_commission || 0).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">العمولة محددة من شركة التأمين</p>
              </div>
            )}

            {/* Under-24 Type Selection - Only 2 options: none or client */}
            <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
              <Label className="text-right block text-sm font-medium">أقل من 24 سنة</Label>
              <RadioGroup
                value={formData.under24_type === 'additional_driver' ? 'client' : formData.under24_type}
                onValueChange={(v: 'none' | 'client') => 
                  setFormData(f => ({ ...f, under24_type: v, is_under_24: v !== 'none' }))
                }
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="none" id="under24_none" />
                  <Label htmlFor="under24_none" className="cursor-pointer text-sm">لا</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="client" id="under24_client" />
                  <Label htmlFor="under24_client" className="cursor-pointer text-sm">نعم – العميل أقل من 24</Label>
                </div>
              </RadioGroup>
            </div>


            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-right block text-sm">ملاحظات</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="text-right"
              />
            </div>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="p-3 border-t bg-muted/30 flex gap-2">
          <Button variant="outline" className="flex-1 h-9" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 ml-1" />
            إلغاء
          </Button>
          <Button className="flex-1 h-9" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 ml-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 ml-1" />
            )}
            حفظ
          </Button>
        </div>
      </DialogContent>

      {/* Package Date Sync Dialog */}
      <AlertDialog open={showPackageDateSync} onOpenChange={setShowPackageDateSync}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تحديث تواريخ الباكيج</AlertDialogTitle>
            <AlertDialogDescription>
              هذه الوثيقة جزء من باكيج يحتوي على {packagePolicies.length} وثائق أخرى.
              <br />
              هل تريد تحديث تواريخ جميع وثائق الباكيج؟
              <div className="mt-2 text-xs text-muted-foreground">
                {packagePolicies.map(p => (
                  <div key={p.id}>• {POLICY_TYPES.find(t => t.value === p.policy_type_parent)?.label || p.policy_type_parent}</div>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel onClick={() => handlePackageSyncConfirm(false)}>
              هذه الوثيقة فقط
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => handlePackageSyncConfirm(true)}>
              تحديث الكل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
