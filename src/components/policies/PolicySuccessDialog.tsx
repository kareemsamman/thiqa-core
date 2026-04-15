import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { toast } from "sonner";
import {
  Printer,
  MessageSquare,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PolicySuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string;
  clientId: string;
  clientPhone: string | null;
  isPackage: boolean;
  onClose: () => void;
}

export function PolicySuccessDialog({
  open,
  onOpenChange,
  policyId,
  clientPhone,
  isPackage,
  onClose,
}: PolicySuccessDialogProps) {
  const [printingInvoice, setPrintingInvoice] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const extractErrorMessage = async (result: { data: any; error: any }): Promise<string> => {
    if (result.error) {
      const parsed = await extractFunctionErrorMessage(result.error);
      return parsed || "حدث خطأ غير متوقع";
    }
    if (result.data?.error) return result.data.error;
    return "حدث خطأ غير متوقع";
  };

  // Resolve every policy id in the package (falls back to just [policyId]
  // for standalone policies). Used for both print and SMS.
  const resolvePolicyIds = async (): Promise<string[]> => {
    if (!isPackage) return [policyId];
    const { data: mainPolicy } = await supabase
      .from("policies")
      .select("group_id")
      .eq("id", policyId)
      .single();
    const groupId = mainPolicy?.group_id;
    if (!groupId) return [policyId];
    const { data: groupPolicies } = await supabase
      .from("policies")
      .select("id")
      .eq("group_id", groupId);
    return groupPolicies?.map((p) => p.id) || [policyId];
  };

  const invokeInvoiceFunction = async (skipSms: boolean) => {
    const ids = await resolvePolicyIds();
    // Always route through send-package-invoice-sms so single and
    // package invoices share one printed template.
    return supabase.functions.invoke("send-package-invoice-sms", {
      body: skipSms ? { policy_ids: ids, skip_sms: true } : { policy_ids: ids },
    });
  };

  const handlePrintInvoice = async () => {
    setPrintingInvoice(true);
    setErrorMessage(null);

    try {
      const result = await invokeInvoiceFunction(true);
      if (result.error || result.data?.error) {
        const errorMsg = await extractErrorMessage(result);
        setErrorMessage(errorMsg);
        toast.error(errorMsg);
        return;
      }
      const invoiceUrl =
        result.data?.package_invoice_url ||
        result.data?.ab_invoice_url ||
        result.data?.invoice_url;
      if (invoiceUrl) {
        window.open(invoiceUrl, "_blank");
        toast.success("تم فتح الوثيقة");
      } else {
        setErrorMessage("لم يتم العثور على رابط الوثيقة");
        toast.error("لم يتم العثور على رابط الوثيقة");
      }
    } catch (error) {
      console.error("Print invoice error:", error);
      const errorMsg = error instanceof Error ? error.message : "فشل في تحميل الوثيقة";
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
    } finally {
      setPrintingInvoice(false);
    }
  };

  const handleSendSms = async () => {
    if (!clientPhone) {
      toast.error("لا يوجد رقم هاتف للعميل");
      return;
    }

    setSendingSms(true);
    setErrorMessage(null);

    try {
      const result = await invokeInvoiceFunction(false);
      if (result.error || result.data?.error) {
        const errorMsg = await extractErrorMessage(result);
        setErrorMessage(errorMsg);
        toast.error(errorMsg);
        return;
      }
      setSmsSent(true);
      toast.success("تم إرسال الوثيقة عبر SMS");
    } catch (error) {
      console.error("Send SMS error:", error);
      const errorMsg = error instanceof Error ? error.message : "فشل في إرسال SMS";
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSendingSms(false);
    }
  };

  const handleClose = () => {
    setErrorMessage(null);
    setSmsSent(false);
    onOpenChange(false);
    onClose();
  };

  const isBusy = printingInvoice || sendingSms;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md w-[95vw] p-0 overflow-hidden" dir="rtl">
        {/* Dark navy header — matches the package drawer / client report shell */}
        <div
          className="text-white p-5"
          style={{ background: "linear-gradient(135deg, #122143 0%, #1a3260 100%)" }}
        >
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-bold text-white text-right">
                  تم إنشاء الوثيقة بنجاح
                </DialogTitle>
                <p className="text-xs text-white/70 mt-0.5">
                  يمكنك طباعتها أو إرسالها للعميل عبر SMS
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {errorMessage && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Print */}
          <button
            type="button"
            onClick={handlePrintInvoice}
            disabled={isBusy}
            className={cn(
              "w-full p-4 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 text-right flex items-center gap-4",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              {printingInvoice ? (
                <Loader2 className="h-6 w-6 text-emerald-600 animate-spin" />
              ) : (
                <Printer className="h-6 w-6 text-emerald-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base">طباعة الوثيقة</div>
              <div className="text-sm text-muted-foreground">
                فتح الوثيقة في نافذة جديدة للطباعة
              </div>
            </div>
          </button>

          {/* Send SMS */}
          <button
            type="button"
            onClick={handleSendSms}
            disabled={isBusy || smsSent || !clientPhone}
            className={cn(
              "w-full p-4 rounded-xl border-2 transition-all duration-200 text-right flex items-center gap-4",
              smsSent
                ? "border-success/40 bg-success/5"
                : "border-border hover:border-primary/50 hover:bg-primary/5",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                smsSent ? "bg-success/15" : "bg-blue-500/10",
              )}
            >
              {sendingSms ? (
                <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
              ) : smsSent ? (
                <CheckCircle2 className="h-6 w-6 text-success" />
              ) : (
                <MessageSquare className="h-6 w-6 text-blue-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-base">
                {smsSent ? "تم إرسال الوثيقة" : "إرسال الوثيقة عبر SMS"}
              </div>
              <div className="text-sm text-muted-foreground">
                {clientPhone
                  ? `سيتم إرسال رابط الوثيقة للرقم ${clientPhone}`
                  : "لا يوجد رقم هاتف للعميل"}
              </div>
            </div>
          </button>

          {/* Close */}
          <Button
            variant="outline"
            className="w-full gap-2 mt-1"
            onClick={handleClose}
            disabled={isBusy}
          >
            <X className="h-4 w-4" />
            إغلاق
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
