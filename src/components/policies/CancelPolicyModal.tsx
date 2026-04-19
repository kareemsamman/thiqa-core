import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { Loader2, XCircle, Send, AlertTriangle } from "lucide-react";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { useAuth } from "@/hooks/useAuth";

interface CancelPolicyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Single policyId for a standalone cancel, OR an array for canceling
  // every policy in a package in one go. Package callers should also
  // pass the SUM of insurance_price across the included policies so
  // the refund validation is against the total the client actually paid.
  policyId?: string;
  policyIds?: string[];
  policyNumber: string | null;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  branchId: string | null;
  insurancePrice: number;
  onCancelled: () => void;
}

export function CancelPolicyModal({
  open,
  onOpenChange,
  policyId,
  policyIds,
  policyNumber,
  clientId,
  clientName,
  clientPhone,
  branchId,
  insurancePrice,
  onCancelled,
}: CancelPolicyModalProps) {
  // Normalize: always operate on an array so handleCancel can loop
  // through every affected policy without branching on shape.
  const effectivePolicyIds: string[] = policyIds && policyIds.length > 0
    ? policyIds
    : policyId
      ? [policyId]
      : [];
  const primaryPolicyId: string | null = effectivePolicyIds[0] ?? null;
  const isPackage = effectivePolicyIds.length > 1;
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [saving, setSaving] = useState(false);
  const [cancellationNote, setCancellationNote] = useState("");
  const [cancellationDate, setCancellationDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [hasRefund, setHasRefund] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [sendSms, setSendSms] = useState(false);
  const [smsMessage, setSmsMessage] = useState("");
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  // Load SMS template when sendSms is toggled on
  const handleSendSmsChange = async (checked: boolean) => {
    setSendSms(checked);
    if (checked && !smsMessage) {
      setLoadingTemplate(true);
      try {
        const { data: settings } = await supabase
          .from("sms_settings")
          .select("cancellation_sms_template")
          .single();

        let template = settings?.cancellation_sms_template || 
          "مرحباً {{client_name}}، تم إلغاء معاملة التأمين رقم {{policy_number}}. {{refund_message}}للاستفسار يرجى التواصل معنا.";
        
        // Replace placeholders
        const refundMsg = hasRefund && refundAmount 
          ? `يوجد لك مرتجع بقيمة ₪${parseFloat(refundAmount).toLocaleString("en-US")}. ` 
          : "";
        
        template = template
          .replace(/\{\{client_name\}\}/g, clientName)
          .replace(/\{\{policy_number\}\}/g, policyNumber || "غير محدد")
          .replace(/\{\{refund_message\}\}/g, refundMsg);
        
        setSmsMessage(template);
      } catch (error) {
        console.error("Error loading SMS template:", error);
      } finally {
        setLoadingTemplate(false);
      }
    }
  };

  // Update SMS message when refund changes
  const handleRefundChange = (checked: boolean) => {
    setHasRefund(checked);
    if (!checked) {
      setRefundAmount("");
    }
    // Update SMS message if already set
    if (sendSms && smsMessage) {
      const refundMsg = checked && refundAmount 
        ? `يوجد لك مرتجع بقيمة ₪${parseFloat(refundAmount).toLocaleString("en-US")}. ` 
        : "";
      setSmsMessage(prev => {
        // Try to update the refund message part
        return prev.replace(/يوجد لك مرتجع بقيمة ₪[\d,٫٬]+ \. |$/, refundMsg);
      });
    }
  };

  const handleCancel = async () => {
    if (effectivePolicyIds.length === 0) {
      toast({ title: "خطأ", description: "لا توجد معاملات للإلغاء", variant: "destructive" });
      return;
    }

    if (!cancellationDate) {
      toast({ title: "خطأ", description: "تاريخ الإلغاء مطلوب", variant: "destructive" });
      return;
    }

    if (hasRefund && (!refundAmount || parseFloat(refundAmount) <= 0)) {
      toast({ title: "خطأ", description: "مبلغ المرتجع مطلوب", variant: "destructive" });
      return;
    }

    if (hasRefund && parseFloat(refundAmount) > insurancePrice) {
      toast({ title: "خطأ", description: "مبلغ المرتجع لا يمكن أن يتجاوز سعر التأمين", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      // 1. Update every affected policy with cancellation info. Using
      // .in() covers both the single-policy and package-cancel paths
      // in one round-trip.
      const { error: policyError } = await supabase
        .from("policies")
        .update({
          cancelled: true,
          cancellation_note: cancellationNote || null,
          cancellation_date: cancellationDate,
          cancelled_by_admin_id: user?.id || null,
        })
        .in("id", effectivePolicyIds);

      if (policyError) throw policyError;

      // 2. Create ONE wallet transaction for the refund, attached to
      // the primary policyId (first in the list). For packages this
      // is the single refund line — we don't split it across sibling
      // policies because the client sees one cancellation, not many.
      if (hasRefund && refundAmount && primaryPolicyId) {
        const { error: walletError } = await supabase
          .from("customer_wallet_transactions")
          .insert({
            client_id: clientId,
            policy_id: primaryPolicyId,
            transaction_type: "refund",
            amount: parseFloat(refundAmount),
            description: isPackage
              ? `مرتجع إلغاء باقة ${policyNumber || ""}`
              : `مرتجع إلغاء معاملة ${policyNumber || ""}`,
            notes: cancellationNote || null,
            created_by_admin_id: user?.id || null,
            branch_id: branchId,
          });

        if (walletError) throw walletError;
      }

      // 3. Send SMS if enabled
      if (sendSms && clientPhone && smsMessage) {
        try {
          const { data: smsData, error: smsError } = await supabase.functions.invoke("send-sms", {
            body: {
              phone: clientPhone,
              message: smsMessage,
              client_id: clientId,
              policy_id: primaryPolicyId,
              sms_type: "manual",
              branch_id: branchId,
            },
          });

          if (smsError) {
            console.error("SMS send error:", smsError);
            const smsMsg = await extractFunctionErrorMessage(smsError);
            toast({
              title: "تحذير",
              description: smsMsg || "تم إلغاء المعاملة لكن فشل إرسال الرسالة"
            });
          } else if (smsData?.success) {
            toast({ title: "تم", description: "تم إرسال رسالة الإلغاء للعميل" });
          }
        } catch (smsErr) {
          console.error("SMS error:", smsErr);
          const smsMsg = await extractFunctionErrorMessage(smsErr);
          if (smsMsg) {
            toast({ title: "تحذير", description: smsMsg });
          }
        }
      }


      toast({ title: "تم", description: "تم إلغاء المعاملة بنجاح" });
      onCancelled();
      onOpenChange(false);
      
      // Reset form
      setCancellationNote("");
      setCancellationDate(new Date().toISOString().split("T")[0]);
      setHasRefund(false);
      setRefundAmount("");
      setSendSms(false);
      setSmsMessage("");
    } catch (error: any) {
      console.error("Error cancelling policy:", error);
      toast({ 
        title: "خطأ", 
        description: error.message || "فشل في إلغاء المعاملة",
        variant: "destructive" 
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <XCircle className="h-5 w-5" />
            {isPackage ? "إلغاء الباقة" : "إلغاء المعاملة"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning */}
          <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {isPackage
                ? `سيتم تسجيل ${effectivePolicyIds.length} معاملات الباقة كملغاة دفعة واحدة`
                : "سيتم تسجيل المعاملة كملغاة ولن تظهر في التقارير النشطة"}
            </span>
          </div>

          {/* Cancellation Date */}
          <div className="space-y-2">
            <Label>تاريخ الإلغاء *</Label>
            <ArabicDatePicker
              value={cancellationDate}
              onChange={(date) => setCancellationDate(date)}
            />
          </div>

          {/* Cancellation Note */}
          <div className="space-y-2">
            <Label>سبب / ملاحظات الإلغاء</Label>
            <Textarea
              value={cancellationNote}
              onChange={(e) => setCancellationNote(e.target.value)}
              placeholder="اكتب سبب الإلغاء هنا..."
              rows={3}
            />
          </div>

          {/* Refund Section */}
          <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
            <div className="flex items-center justify-between">
              <Label htmlFor="hasRefund" className="font-medium">
                يوجد مرتجع للعميل (مرتجع)
              </Label>
              <Switch
                id="hasRefund"
                checked={hasRefund}
                onCheckedChange={handleRefundChange}
              />
            </div>

            {hasRefund && (
              <div className="space-y-2">
                <Label>مبلغ المرتجع (₪) *</Label>
                <Input
                  type="number"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder="0"
                  min="0"
                  max={insurancePrice}
                  dir="ltr"
                />
                <p className="text-xs text-muted-foreground">
                  الحد الأقصى: ₪{insurancePrice.toLocaleString("en-US")}
                </p>
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
                  onCheckedChange={handleSendSmsChange}
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
                      rows={4}
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
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleCancel} 
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
                جاري الإلغاء...
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 ml-2" />
                تأكيد الإلغاء
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}