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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useSmsLock } from "@/hooks/useSmsLock";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { Loader2, XCircle, Send, AlertTriangle, Wallet, Banknote } from "lucide-react";
import { Lock as LockIcon } from "@phosphor-icons/react";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";

// Two ways to record a refund when cancelling a policy:
//   credit_note  — the agency owes the client. Adds to the wallet
//     balance (the customer can apply it against future payments).
//     No money actually leaves the agency.
//   disbursement — actual money out. Doesn't touch the wallet. Picked
//     when the agent literally hands over cash / writes a cheque /
//     transfers to the client right now.
// Both produce a numbered voucher on the receipts table that shows up
// in /receipts under its own tab.
type RefundKind = "credit_note" | "disbursement";

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
  // Internal document_number is always present (DB trigger assigns it) —
  // prefer it over the external insurance-company policy_number, which
  // is frequently empty (especially on packages) and otherwise renders
  // as "رقم غير محدد" in the cancellation SMS. Same rule as
  // TransferPolicyModal.
  documentNumber?: string | null;
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
  documentNumber,
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
  const { agentId } = useAgentContext();
  const { locked: smsLocked, loading: smsLoading, openUpgradeDialog: openSmsUpgrade, guardSend: guardSmsSend } = useSmsLock();

  const [saving, setSaving] = useState(false);
  const [cancellationNote, setCancellationNote] = useState("");
  const [cancellationDate, setCancellationDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [hasRefund, setHasRefund] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  // Default to credit_note — that mirrors today's "مرتجع" behavior
  // (wallet credit, no cash out) so unchanged user flows stay
  // unchanged. Disbursement is wired into the UI but disabled until
  // phase 2b ships its full payment-line picker.
  const [refundKind, setRefundKind] = useState<RefundKind>("credit_note");
  const [sendSms, setSendSms] = useState(false);
  const [smsMessage, setSmsMessage] = useState("");
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  // Load SMS template when sendSms is toggled on
  const handleSendSmsChange = async (checked: boolean) => {
    setSendSms(checked);
    if (checked && !smsMessage) {
      setLoadingTemplate(true);
      try {
        const { data: tmpl } = await supabase.rpc('get_sms_cancellation_template');

        let template = (tmpl as string | null) ||
          "مرحباً {{client_name}}، تم إلغاء معاملة التأمين رقم {{policy_number}}. {{refund_message}}للاستفسار يرجى التواصل معنا.";
        
        // Replace placeholders
        const refundMsg = hasRefund && refundAmount 
          ? `يوجد لك مرتجع بقيمة ₪${parseFloat(refundAmount).toLocaleString("en-US")}. ` 
          : "";
        
        const displayNumber = (documentNumber || policyNumber || "").trim();
        template = template
          .replace(/\{\{client_name\}\}/g, clientName)
          .replace(/\{\{policy_number\}\}/g, displayNumber || "غير محدد")
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

      // 2. Refund handling. Two flavors depending on refundKind:
      //
      //   credit_note  → wallet credit (existing behavior) AND a
      //                  formal voucher row in receipts so it shows
      //                  up in /receipts under "اشعار دائن" with a
      //                  printable C{nn}/YYYY number.
      //   disbursement → cash actually leaves the agency. Skipped
      //                  here; goes through the AddSettlementDialog
      //                  flow that lands in phase 2b.
      //
      // Both branches always operate on the primary policy id — for
      // a package cancel the client sees one cancellation, not many.
      if (hasRefund && refundAmount && primaryPolicyId) {
        const refundDescription = isPackage
          ? `مرتجع إلغاء باقة ${policyNumber || ""}`
          : `مرتجع إلغاء معاملة ${policyNumber || ""}`;

        if (refundKind === "credit_note") {
          // 2a. Wallet transaction — the source of truth for the
          // client's available balance.
          const { data: walletRow, error: walletError } = await supabase
            .from("customer_wallet_transactions")
            .insert({
              client_id: clientId,
              policy_id: primaryPolicyId,
              transaction_type: "refund",
              amount: parseFloat(refundAmount),
              description: refundDescription,
              notes: cancellationNote || null,
              created_by_admin_id: user?.id || null,
              branch_id: branchId,
              agent_id: agentId,
            })
            .select("id")
            .single();

          if (walletError) throw walletError;

          // 2b. Formal numbered voucher. Skip silently if we can't
          // resolve an agent — the wallet entry is already on the
          // record and the cancellation succeeded; refusing to ship
          // the cancel because of a missing voucher would be worse
          // than missing the voucher. The bookkeeper can re-issue
          // from /receipts later.
          if (agentId) {
            const year = new Date(cancellationDate).getFullYear();
            const { data: voucherNumber, error: voucherError } = await supabase.rpc(
              "allocate_credit_note_number",
              { p_agent_id: agentId, p_year: year },
            );
            if (voucherError) {
              console.warn("[CancelPolicyModal] allocate_credit_note_number failed:", voucherError);
            } else if (voucherNumber) {
              const { error: receiptError } = await supabase.from("receipts").insert({
                receipt_type: "credit_note",
                source: "auto",
                voucher_number: voucherNumber as unknown as string,
                client_id: clientId,
                client_name: clientName,
                policy_id: primaryPolicyId,
                wallet_transaction_id: walletRow?.id ?? null,
                amount: parseFloat(refundAmount),
                receipt_date: cancellationDate,
                // payment_method stays at the table default ('cash').
                // No real method applies here — the /receipts tab for
                // credit notes filters by receipt_type and never
                // surfaces this column.
                notes: refundDescription,
                agent_id: agentId,
                branch_id: branchId,
                created_by: user?.id || null,
              });
              if (receiptError) {
                console.warn("[CancelPolicyModal] credit_note receipt insert failed:", receiptError);
              }
            }
          }
        }
        // refundKind === "disbursement" intentionally falls through
        // until phase 2b lands the cash-out picker.
      }

      // 3. Send SMS if enabled (and plan allows it — skip quietly
      // otherwise so the policy-cancel flow still completes).
      if (sendSms && clientPhone && smsMessage && guardSmsSend('auto')) {
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
              <div className="space-y-3">
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

                {/* Two refund flavors with short explanations under
                    each radio. Disbursement is shown so the user
                    knows the option exists, but disabled until the
                    cash-out picker lands in phase 2b. */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">طريقة إصدار المرتجع</Label>
                  <RadioGroup
                    value={refundKind}
                    onValueChange={(v) => setRefundKind(v as RefundKind)}
                    className="gap-2"
                  >
                    <label
                      htmlFor="refund-kind-credit"
                      className="flex items-start gap-2 p-2.5 border rounded-md cursor-pointer hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                    >
                      <RadioGroupItem value="credit_note" id="refund-kind-credit" className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-sm">
                          <Wallet className="h-3.5 w-3.5" />
                          اشعار دائن
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          يبقى المبلغ رصيداً للعميل عندنا — لا يخرج كاش الآن، ويُحسم تلقائياً من أي دفعة قادمة.
                        </p>
                      </div>
                    </label>

                    <label
                      htmlFor="refund-kind-disb"
                      aria-disabled
                      className="flex items-start gap-2 p-2.5 border rounded-md cursor-not-allowed opacity-60"
                    >
                      <RadioGroupItem value="disbursement" id="refund-kind-disb" disabled className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 font-medium text-sm">
                          <Banknote className="h-3.5 w-3.5" />
                          سند صرف
                          <span className="text-[9px] px-1.5 py-0 rounded-full bg-muted text-muted-foreground">قريباً</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          المبلغ يخرج فعلياً من صندوق الشركة الآن (نقدي / شيك / تحويل / فيزا). لا يضيف للعميل أي رصيد.
                        </p>
                      </div>
                    </label>
                  </RadioGroup>
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
                  {smsLocked && (
                    <button
                      type="button"
                      onClick={openSmsUpgrade}
                      className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-0.5 hover:bg-amber-500/15 transition-colors"
                    >
                      <LockIcon className="h-2.5 w-2.5" weight="fill" />
                      مقفول — اضغط للترقية
                    </button>
                  )}
                </Label>
                <Switch
                  id="sendSms"
                  checked={sendSms && !smsLocked}
                  disabled={smsLocked || smsLoading}
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