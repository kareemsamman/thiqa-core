import { useState, useEffect } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { 
  Loader2, 
  ArrowLeftRight, 
  Plus, 
  Car, 
  Send,
  AlertTriangle,
  Package,
  CheckCircle2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";

interface TransferPolicyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string;
  policyNumber: string | null;
  policyType: string;
  groupId: string | null;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  branchId: string | null;
  currentCar: {
    id: string;
    car_number: string;
    model: string | null;
    year: number | null;
    manufacturer_name: string | null;
  } | null;
  onTransferred: () => void;
}

interface CarOption {
  id: string;
  car_number: string;
  model: string | null;
  year: number | null;
  manufacturer_name: string | null;
}

interface RelatedPolicy {
  id: string;
  policy_type_parent: string;
  policy_number: string | null;
  insurance_price: number;
}

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: "إلزامي",
  THIRD_FULL: "ثالث/شامل",
  ROAD_SERVICE: "خدمات الطريق",
  ACCIDENT_FEE_EXEMPTION: "إعفاء رسوم حادث",
};

type AdjustmentType = "none" | "customer_pays" | "refund";

export function TransferPolicyModal({
  open,
  onOpenChange,
  policyId,
  policyNumber,
  policyType,
  groupId,
  clientId,
  clientName,
  clientPhone,
  branchId,
  currentCar,
  onTransferred,
}: TransferPolicyModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [saving, setSaving] = useState(false);
  const [cars, setCars] = useState<CarOption[]>([]);
  const [loadingCars, setLoadingCars] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState<string>("");
  const [showNewCarForm, setShowNewCarForm] = useState(false);
  
  // Package / related policies
  const [relatedPolicies, setRelatedPolicies] = useState<RelatedPolicy[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [transferPackage, setTransferPackage] = useState(true);
  
  // Transfer details
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split("T")[0]);
  const [note, setNote] = useState("");
  const [officeNote, setOfficeNote] = useState("");
  
  // Money adjustment
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("none");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  
  // SMS
  const [sendSms, setSendSms] = useState(true);
  const [smsMessage, setSmsMessage] = useState("");
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  
  // New car form
  const [newCarNumber, setNewCarNumber] = useState("");
  const [newCarModel, setNewCarModel] = useState("");
  const [newCarYear, setNewCarYear] = useState("");
  const [newCarManufacturer, setNewCarManufacturer] = useState("");
  const [savingNewCar, setSavingNewCar] = useState(false);

  // Fetch client's cars and related policies
  useEffect(() => {
    if (open && clientId) {
      fetchCars();
      loadSmsTemplate();
      if (groupId) {
        fetchRelatedPolicies();
      } else {
        setRelatedPolicies([]);
      }
    }
  }, [open, clientId, groupId]);

  // Fetch related policies in the same group (add-ons)
  const fetchRelatedPolicies = async () => {
    if (!groupId) return;
    
    setLoadingRelated(true);
    try {
      const { data, error } = await supabase
        .from("policies")
        .select("id, policy_type_parent, policy_number, insurance_price")
        .eq("group_id", groupId)
        .neq("id", policyId)
        .is("deleted_at", null)
        .is("cancelled", false)
        .is("transferred", false);

      if (error) throw error;
      setRelatedPolicies(data || []);
    } catch (error) {
      console.error("Error fetching related policies:", error);
      setRelatedPolicies([]);
    } finally {
      setLoadingRelated(false);
    }
  };

  const fetchCars = async () => {
    setLoadingCars(true);
    try {
      const { data, error } = await supabase
        .from("cars")
        .select("id, car_number, model, year, manufacturer_name")
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      // Filter out current car
      const filtered = (data || []).filter(c => c.id !== currentCar?.id);
      setCars(filtered);
    } catch (error) {
      console.error("Error fetching cars:", error);
    } finally {
      setLoadingCars(false);
    }
  };

  const loadSmsTemplate = async () => {
    setLoadingTemplate(true);
    try {
      const { data: settings } = await supabase
        .from("sms_settings")
        .select("*")
        .single();

      // Use a generic transfer template
      let template = `مرحباً ${clientName}، تم تحويل معاملة التأمين رقم ${policyNumber || "غير محدد"} إلى مركبة جديدة. للاستفسار يرجى التواصل معنا.`;
      setSmsMessage(template);
    } catch (error) {
      console.error("Error loading SMS template:", error);
    } finally {
      setLoadingTemplate(false);
    }
  };

  const handleAddNewCar = async () => {
    if (!newCarNumber || !newCarModel || !newCarYear) {
      toast({ title: "خطأ", description: "رقم السيارة والموديل والسنة مطلوبة", variant: "destructive" });
      return;
    }

    if (newCarNumber.length > 8) {
      toast({ title: "خطأ", description: "رقم السيارة يجب أن لا يتجاوز 8 أرقام", variant: "destructive" });
      return;
    }

    setSavingNewCar(true);
    try {
      const { data, error } = await supabase
        .from("cars")
        .insert({
          client_id: clientId,
          car_number: newCarNumber,
          model: newCarModel,
          year: parseInt(newCarYear),
          manufacturer_name: newCarManufacturer || null,
          branch_id: branchId,
          created_by_admin_id: user?.id,
        })
        .select("id, car_number, model, year, manufacturer_name")
        .single();

      if (error) throw error;

      // Add to cars list and select it
      setCars(prev => [data, ...prev]);
      setSelectedCarId(data.id);
      setShowNewCarForm(false);
      
      // Reset form
      setNewCarNumber("");
      setNewCarModel("");
      setNewCarYear("");
      setNewCarManufacturer("");

      toast({ title: "تم", description: "تم إضافة السيارة بنجاح" });
    } catch (error: any) {
      console.error("Error adding car:", error);
      toast({ title: "خطأ", description: error.message || "فشل في إضافة السيارة", variant: "destructive" });
    } finally {
      setSavingNewCar(false);
    }
  };

  const handleTransfer = async () => {
    if (!selectedCarId) {
      toast({ title: "خطأ", description: "يرجى اختيار السيارة المراد التحويل إليها", variant: "destructive" });
      return;
    }

    if (!transferDate) {
      toast({ title: "خطأ", description: "تاريخ التحويل مطلوب", variant: "destructive" });
      return;
    }

    if (adjustmentType !== "none" && (!adjustmentAmount || parseFloat(adjustmentAmount) <= 0)) {
      toast({ title: "خطأ", description: "مبلغ التعديل المالي مطلوب", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const selectedCar = cars.find(c => c.id === selectedCarId);
      
      // Determine which policies to transfer
      const policiesToTransfer = [policyId];
      if (transferPackage && relatedPolicies.length > 0) {
        policiesToTransfer.push(...relatedPolicies.map(p => p.id));
      }
      
      // Fetch original policy details for all policies being transferred
      const { data: originalPolicies, error: fetchError } = await supabase
        .from("policies")
        .select("*")
        .in("id", policiesToTransfer);

      if (fetchError) throw fetchError;
      if (!originalPolicies || originalPolicies.length === 0) {
        throw new Error("لم يتم العثور على المعاملات");
      }

      // Generate new group_id if transferring package
      let newGroupId: string | null = null;
      
      if (transferPackage && policiesToTransfer.length > 1) {
        newGroupId = crypto.randomUUID();
        
        // Create entry in policy_groups table for the new package
        const { error: groupError } = await supabase
          .from("policy_groups")
          .insert({
            id: newGroupId,
            client_id: clientId,
            car_id: selectedCarId,
            name: `باقة محولة - ${selectedCar?.car_number || ""}`,
          });
        
        if (groupError) throw groupError;
      }

      // Build mapping of old policy ID -> new policy ID
      const policyIdMap: Map<string, string> = new Map();
      const newPolicyIds: string[] = [];

      // PHASE 1: Mark all original policies as transferred and create all new policies
      // This ensures the new group has the full price total before we move payments
      for (const originalPolicy of originalPolicies) {
        // 1. Mark original policy as transferred, zero out financials
        const { error: updateOriginalError } = await supabase
          .from("policies")
          .update({
            transferred: true,
            end_date: transferDate,
            transferred_to_car_number: selectedCar?.car_number || null,
            payed_for_company: 0,
            profit: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", originalPolicy.id);

        if (updateOriginalError) throw updateOriginalError;

        // 2. Create new policy - keep ORIGINAL insurance_price 
        // The trigger validates against GROUP total, so all policies must exist first
        let adjustedInsurancePrice = originalPolicy.insurance_price;
        let adjustedProfit = originalPolicy.profit;
        if (originalPolicy.id === policyId && adjustmentType === "customer_pays" && adjustmentAmount) {
          const adjustAmt = parseFloat(adjustmentAmount);
          adjustedInsurancePrice += adjustAmt;
          adjustedProfit = (originalPolicy.profit || 0) + adjustAmt;
        }
        
        const newPolicyData = {
          client_id: originalPolicy.client_id,
          car_id: selectedCarId,
          company_id: originalPolicy.company_id,
          policy_type_parent: originalPolicy.policy_type_parent,
          policy_type_child: originalPolicy.policy_type_child,
          policy_number: originalPolicy.policy_number,
          start_date: transferDate,
          end_date: originalPolicy.end_date,
          insurance_price: adjustedInsurancePrice,
          is_under_24: originalPolicy.is_under_24,
          profit: adjustedProfit,
          payed_for_company: originalPolicy.payed_for_company,
          broker_id: originalPolicy.broker_id,
          broker_direction: originalPolicy.broker_direction,
          broker_buy_price: originalPolicy.broker_buy_price,
          category_id: originalPolicy.category_id,
          branch_id: originalPolicy.branch_id,
          road_service_id: originalPolicy.road_service_id,
          accident_fee_service_id: originalPolicy.accident_fee_service_id,
          company_cost_snapshot: originalPolicy.company_cost_snapshot,
          elzami_cost: originalPolicy.elzami_cost,
          transferred_car_number: currentCar?.car_number || null,
          transferred_from_policy_id: originalPolicy.id,
          group_id: newGroupId,
          notes: `تحويل من سيارة ${currentCar?.car_number || "غير محدد"} - ${originalPolicy.notes || ""}`.trim(),
          created_by_admin_id: user?.id,
        };

        const { data: newPolicy, error: insertError } = await supabase
          .from("policies")
          .insert(newPolicyData)
          .select("id")
          .single();

        if (insertError) throw insertError;
        
        policyIdMap.set(originalPolicy.id, newPolicy.id);
        newPolicyIds.push(newPolicy.id);

        // 3. Create policy transfer audit record
        const { error: transferError } = await supabase
          .from("policy_transfers")
          .insert({
            policy_id: originalPolicy.id,
            new_policy_id: newPolicy.id,
            client_id: clientId,
            from_car_id: currentCar?.id,
            to_car_id: selectedCarId,
            transfer_date: transferDate,
            note: note || null,
            office_note: officeNote.trim() || null,
            adjustment_type: originalPolicy.id === policyId ? adjustmentType : "none",
            adjustment_amount: originalPolicy.id === policyId && adjustmentType !== "none"
              ? parseFloat(adjustmentAmount)
              : null,
            created_by_admin_id: user?.id,
            branch_id: branchId,
          });

        if (transferError) throw transferError;
      }

      // PHASE 2: Now move payments and files (after ALL new policies exist)
      // This ensures the group total is correct when trigger validates
      for (const originalPolicy of originalPolicies) {
        const newPolicyId = policyIdMap.get(originalPolicy.id);
        if (!newPolicyId) continue;

        // 4. MOVE payments from old policy to new policy
        const { error: movePaymentsError } = await supabase
          .from("policy_payments")
          .update({ policy_id: newPolicyId })
          .eq("policy_id", originalPolicy.id);

        if (movePaymentsError) throw movePaymentsError;

        // 5. MOVE policy files (insurance + CRM) from old to new policy
        const { error: moveFilesError } = await supabase
          .from("media_files")
          .update({ entity_id: newPolicyId })
          .eq("entity_id", originalPolicy.id)
          .in("entity_type", ["policy", "policy_insurance", "policy_crm"])
          .is("deleted_at", null);

        if (moveFilesError) throw moveFilesError;
      }

      // 6. Create wallet transaction only for refunds (customer_pays is already added to insurance_price)
      if (adjustmentType === "refund" && adjustmentAmount && newPolicyIds.length > 0) {
        const { error: walletError } = await supabase
          .from("customer_wallet_transactions")
          .insert({
            client_id: clientId,
            policy_id: newPolicyIds[0],
            transaction_type: "transfer_refund_owed",
            amount: parseFloat(adjustmentAmount),
            description: `مرتجع تحويل معاملة ${policyNumber || ""} - مستحق للعميل`,
            notes: adjustmentNote || null,
            created_by_admin_id: user?.id,
            branch_id: branchId,
          });

        if (walletError) throw walletError;
      }

      // 6. Send SMS if enabled
      if (sendSms && clientPhone && smsMessage) {
        try {
          const { error: smsError } = await supabase.functions.invoke("send-sms", {
            body: {
              phone: clientPhone,
              message: smsMessage,
              client_id: clientId,
              policy_id: newPolicyIds[0] || policyId,
              sms_type: "manual",
              branch_id: branchId,
            },
          });

          if (smsError) {
            console.error("SMS send error:", smsError);
            const smsMsg = await extractFunctionErrorMessage(smsError);
            toast({
              title: "تحذير",
              description: smsMsg || "تم تحويل المعاملة لكن فشل إرسال الرسالة"
            });
          } else {
            toast({ title: "تم", description: "تم إرسال رسالة التحويل للعميل" });
          }
        } catch (smsErr) {
          console.error("SMS error:", smsErr);
          const smsMsg = await extractFunctionErrorMessage(smsErr);
          if (smsMsg) {
            toast({ title: "تحذير", description: smsMsg });
          }
        }
      }

      const transferCount = policiesToTransfer.length;
      toast({ 
        title: "تم التحويل بنجاح", 
        description: transferCount > 1 
          ? `تم تحويل ${transferCount} معاملات - المعاملات القديمة انتهت بتاريخ التحويل ومعاملات جديدة تم إنشاؤها للسيارة الجديدة`
          : "تم تحويل المعاملة - المعاملة القديمة انتهت بتاريخ التحويل ومعاملة جديدة تم إنشاؤها للسيارة الجديدة"
      });
      onTransferred();
      onOpenChange(false);
      
      // Reset form
      resetForm();
    } catch (error: any) {
      console.error("Error transferring policy:", error);
      toast({ 
        title: "خطأ", 
        description: error.message || "فشل في تحويل المعاملة",
        variant: "destructive" 
      });
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setSelectedCarId("");
    setTransferDate(new Date().toISOString().split("T")[0]);
    setNote("");
    setOfficeNote("");
    setAdjustmentType("none");
    setAdjustmentAmount("");
    setAdjustmentNote("");
    setSendSms(true);
    setSmsMessage("");
    setShowNewCarForm(false);
    setTransferPackage(true);
    setRelatedPolicies([]);
  };

  const formatCarLabel = (car: CarOption) => {
    const parts = [car.car_number];
    if (car.manufacturer_name) parts.push(car.manufacturer_name);
    if (car.model) parts.push(car.model);
    if (car.year) parts.push(car.year.toString());
    return parts.join(" - ");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary">
            <ArrowLeftRight className="h-5 w-5" />
            تحويل المعاملة
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current Car - Read Only */}
          <Card className="p-3 bg-muted/30">
            <Label className="text-xs text-muted-foreground">السيارة الحالية</Label>
            <p className="font-medium flex items-center gap-2 mt-1">
              <Car className="h-4 w-4 text-muted-foreground" />
              {currentCar ? formatCarLabel(currentCar) : "غير محدد"}
            </p>
          </Card>

          {/* Package Transfer Option - Show if there are related policies */}
          {relatedPolicies.length > 0 && (
            <Card className="p-4 border-primary/30 bg-primary/5 space-y-3">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                <Label className="font-semibold text-primary">
                  هذه المعاملة جزء من حزمة
                </Label>
              </div>
              
              <div className="text-sm text-muted-foreground">
                تم العثور على {relatedPolicies.length} معاملات إضافية مرتبطة:
              </div>
              
              <div className="space-y-2">
                {relatedPolicies.map((policy) => (
                  <div 
                    key={policy.id} 
                    className="flex items-center justify-between bg-background/50 rounded-md px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="font-medium">
                        {POLICY_TYPE_LABELS[policy.policy_type_parent] || policy.policy_type_parent}
                      </span>
                      {policy.policy_number && (
                        <span className="text-muted-foreground">
                          ({policy.policy_number})
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-primary">
                      ₪{policy.insurance_price.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2 border-t">
                <Checkbox
                  id="transfer-package"
                  checked={transferPackage}
                  onCheckedChange={(checked) => setTransferPackage(checked === true)}
                />
                <Label 
                  htmlFor="transfer-package" 
                  className="cursor-pointer text-sm font-medium"
                >
                  تحويل الحزمة كاملة (الخدمات وإعفاء الرسوم)
                </Label>
              </div>
            </Card>
          )}

          {loadingRelated && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري البحث عن معاملات مرتبطة...
            </div>
          )}

          {/* Target Car Selection */}
          <div className="space-y-2">
            <Label>تحويل إلى *</Label>
            {loadingCars ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <Select value={selectedCarId} onValueChange={setSelectedCarId}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر السيارة" />
                  </SelectTrigger>
                  <SelectContent>
                    {cars.map((car) => (
                      <SelectItem key={car.id} value={car.id}>
                        {formatCarLabel(car)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Add New Car Button */}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full mt-2"
                  onClick={() => setShowNewCarForm(!showNewCarForm)}
                >
                  <Plus className="h-4 w-4 ml-1" />
                  {showNewCarForm ? "إلغاء الإضافة" : "إضافة سيارة جديدة"}
                </Button>

                {/* New Car Form */}
                {showNewCarForm && (
                  <Card className="p-3 space-y-3 mt-2 border-primary/30 bg-primary/5">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">رقم السيارة *</Label>
                        <Input
                          value={newCarNumber}
                          onChange={(e) => setNewCarNumber(e.target.value.replace(/\D/g, '').slice(0, 8))}
                          placeholder="12345678"
                          maxLength={8}
                          inputMode="numeric"
                          dir="ltr"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">سنة الصنع *</Label>
                        <Input
                          type="number"
                          value={newCarYear}
                          onChange={(e) => setNewCarYear(e.target.value)}
                          placeholder="2024"
                          dir="ltr"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">الشركة المصنعة</Label>
                        <Input
                          value={newCarManufacturer}
                          onChange={(e) => setNewCarManufacturer(e.target.value)}
                          placeholder="تويوتا"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">الموديل *</Label>
                        <Input
                          value={newCarModel}
                          onChange={(e) => setNewCarModel(e.target.value)}
                          placeholder="كورولا"
                        />
                      </div>
                    </div>
                    <Button 
                      size="sm" 
                      onClick={handleAddNewCar}
                      disabled={savingNewCar}
                      className="w-full"
                    >
                      {savingNewCar ? (
                        <Loader2 className="h-4 w-4 animate-spin ml-1" />
                      ) : (
                        <Plus className="h-4 w-4 ml-1" />
                      )}
                      حفظ وتحديد
                    </Button>
                  </Card>
                )}
              </>
            )}
          </div>

          {/* Transfer Date */}
          <div className="space-y-2">
            <Label>تاريخ التحويل *</Label>
            <ArabicDatePicker
              value={transferDate}
              onChange={(date) => setTransferDate(date)}
            />
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label>ملاحظات / سبب التحويل</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="اكتب ملاحظات التحويل هنا..."
              rows={2}
            />
          </div>

          {/* Internal office note — never appears on the customer invoice
              or SMS, only on the audit trail inside the app. */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <span>ملاحظات للمكتب</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                (لن تظهر على الفاتورة)
              </span>
            </Label>
            <Textarea
              value={officeNote}
              onChange={(e) => setOfficeNote(e.target.value)}
              placeholder="ملاحظات داخلية للمكتب فقط..."
              rows={2}
            />
          </div>

          {/* Money Adjustment */}
          <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
            <Label className="font-medium">تعديل مالي (فرق)</Label>
            <RadioGroup 
              value={adjustmentType} 
              onValueChange={(v) => setAdjustmentType(v as AdjustmentType)}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="none" id="adj-none" />
                <Label htmlFor="adj-none" className="cursor-pointer">لا يوجد تعديل</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="customer_pays" id="adj-customer-pays" />
                <Label htmlFor="adj-customer-pays" className="cursor-pointer">العميل يدفع لنا (مستحق علينا)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="refund" id="adj-refund" />
                <Label htmlFor="adj-refund" className="cursor-pointer">نحن ندفع للعميل (مرتجع)</Label>
              </div>
            </RadioGroup>

            {adjustmentType !== "none" && (
              <div className="space-y-3 pt-2 border-t">
                <div className="space-y-2">
                  <Label>المبلغ (₪) *</Label>
                  <Input
                    type="number"
                    value={adjustmentAmount}
                    onChange={(e) => setAdjustmentAmount(e.target.value)}
                    placeholder="0"
                    min="0"
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label>ملاحظة للتعديل المالي</Label>
                  <Input
                    value={adjustmentNote}
                    onChange={(e) => setAdjustmentNote(e.target.value)}
                    placeholder="سبب الفرق..."
                  />
                </div>
              </div>
            )}
          </div>

          {/* SMS Section */}
          {clientPhone && (
            <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
              <div className="flex items-center justify-between">
                <Label htmlFor="sendSms" className="font-medium flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  إرسال رسالة SMS للعميل
                </Label>
                <Switch
                  id="sendSms"
                  checked={sendSms}
                  onCheckedChange={setSendSms}
                />
              </div>

              {sendSms && (
                <div className="space-y-2">
                  <Label>نص الرسالة</Label>
                  {loadingTemplate ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <Textarea
                      value={smsMessage}
                      onChange={(e) => setSmsMessage(e.target.value)}
                      rows={3}
                      dir="rtl"
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    سيتم الإرسال إلى: {clientPhone}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Warning */}
          <div className="flex items-center gap-2 p-3 bg-amber-500/10 text-amber-700 rounded-lg text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>سيتم تحديث السيارة في المعاملة وتسجيل التحويل</span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button 
            onClick={handleTransfer} 
            disabled={saving || !selectedCarId}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
                جاري التحويل...
              </>
            ) : (
              <>
                <ArrowLeftRight className="h-4 w-4 ml-2" />
                تأكيد التحويل
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
