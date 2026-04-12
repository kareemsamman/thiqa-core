import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Send, Printer, X, FileText } from "lucide-react";
import { toast } from "sonner";
import { extractFunctionErrorMessage, toastFunctionError } from "@/lib/functionError";

interface InvoiceSendPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyIds: string[];
  isPackage: boolean;
  clientPhone: string | null;
}

export function InvoiceSendPrintDialog({
  open,
  onOpenChange,
  policyIds,
  isPackage,
  clientPhone,
}: InvoiceSendPrintDialogProps) {
  const [sendingType, setSendingType] = useState<"sms" | "print" | null>(null);

  const handleSendSms = async () => {
    setSendingType("sms");
    try {
      const functionName = isPackage ? "send-package-invoice-sms" : "send-invoice-sms";
      const body = isPackage
        ? { policy_ids: policyIds }
        : { policy_id: policyIds[0], force_resend: true };

      const { data, error } = await supabase.functions.invoke(functionName, { body });

      if (error) {
        // Pass the raw invoke error straight to the helper so it can
        // parse context.json() and detect the sms_limit_reached code.
        await toastFunctionError(error, "فشل في الإرسال");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }

      toast.success(isPackage ? "تم إرسال الفواتير للعميل" : "تم إرسال الفاتورة للعميل");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "فشل في الإرسال");
    } finally {
      setSendingType(null);
    }
  };

  const handlePrint = async () => {
    setSendingType("print");
    try {
      // Generate invoice without sending SMS
      const functionName = isPackage ? "send-package-invoice-sms" : "send-invoice-sms";
      const body = isPackage
        ? { policy_ids: policyIds, skip_sms: true }
        : { policy_id: policyIds[0], skip_sms: true };

      const { data, error } = await supabase.functions.invoke(functionName, { body });

      if (error) {
        await toastFunctionError(error, "فشل في تحميل الفاتورة");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }

      // Open the invoice URL in a new tab for printing
      const invoiceUrl = data?.ab_invoice_url || data?.package_invoice_url || data?.invoice_url;
      if (invoiceUrl) {
        window.open(invoiceUrl, "_blank");
        toast.success("تم فتح الفاتورة في نافذة جديدة");
      } else {
        toast.error("لم يتم إنشاء رابط الفاتورة");
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "فشل في تحميل الفاتورة");
    } finally {
      setSendingType(null);
    }
  };

  const isSending = sendingType !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <span>إرسال / طباعة الفاتورة</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {/* Send SMS Option */}
          <button
            className="w-full p-4 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 text-right flex items-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSendSms}
            disabled={isSending}
          >
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
              {sendingType === "sms" ? (
                <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
              ) : (
                <Send className="h-6 w-6 text-blue-600" />
              )}
            </div>
            <div className="flex-1">
              <div className="font-semibold text-base">إرسال SMS للعميل</div>
              <div className="text-sm text-muted-foreground">
                سيتم إرسال رابط الفاتورة للرقم {clientPhone || "المسجل"}
              </div>
            </div>
          </button>

          {/* Print Option */}
          <button
            className="w-full p-4 rounded-xl border-2 border-border hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 text-right flex items-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handlePrint}
            disabled={isSending}
          >
            <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
              {sendingType === "print" ? (
                <Loader2 className="h-6 w-6 text-green-600 animate-spin" />
              ) : (
                <Printer className="h-6 w-6 text-green-600" />
              )}
            </div>
            <div className="flex-1">
              <div className="font-semibold text-base">طباعة الفاتورة</div>
              <div className="text-sm text-muted-foreground">
                فتح الفاتورة في نافذة جديدة للطباعة
              </div>
            </div>
          </button>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
            className="w-full"
          >
            <X className="h-4 w-4 ml-1" />
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
