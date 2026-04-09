import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Printer, MessageSquare, X, Loader2, Check, AlertCircle, Receipt } from "lucide-react";

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
  clientId,
  clientPhone,
  isPackage,
  onClose,
}: PolicySuccessDialogProps) {
  const [printingInvoice, setPrintingInvoice] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Receipt states
  const [paymentIds, setPaymentIds] = useState<string[]>([]);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [sendingReceiptSms, setSendingReceiptSms] = useState(false);
  const [receiptSmsSent, setReceiptSmsSent] = useState(false);

  // Fetch payment IDs when dialog opens
  useEffect(() => {
    if (!open || !policyId) return;

    const fetchPayments = async () => {
      try {
        let policyIds = [policyId];

        if (isPackage) {
          const { data: mainPolicy } = await supabase
            .from('policies')
            .select('group_id')
            .eq('id', policyId)
            .single();

          if (mainPolicy?.group_id) {
            const { data: groupPolicies } = await supabase
              .from('policies')
              .select('id')
              .eq('group_id', mainPolicy.group_id);
            if (groupPolicies) {
              policyIds = groupPolicies.map(p => p.id);
            }
          }
        }

        const { data: payments } = await supabase
          .from('policy_payments')
          .select('id')
          .in('policy_id', policyIds);

        if (payments && payments.length > 0) {
          setPaymentIds(payments.map(p => p.id));
        }
      } catch (err) {
        console.error('Error fetching payment IDs:', err);
      }
    };

    fetchPayments();
  }, [open, policyId, isPackage]);

  const extractErrorMessage = async (result: { data: any; error: any }): Promise<string> => {
    if (result.error) {
      if (typeof result.error === 'string') return result.error;
      if (result.error.message) return result.error.message;
      return 'حدث خطأ غير متوقع';
    }
    if (result.data?.error) return result.data.error;
    return 'حدث خطأ غير متوقع';
  };

  const handlePrintInvoice = async () => {
    setPrintingInvoice(true);
    setErrorMessage(null);
    
    try {
      let result;
      
      if (isPackage) {
        const { data: mainPolicy, error: mainPolicyError } = await supabase
          .from('policies')
          .select('group_id')
          .eq('id', policyId)
          .single();
        
        if (mainPolicyError) throw mainPolicyError;
        const groupId = mainPolicy?.group_id;
        
        if (!groupId) {
          result = await supabase.functions.invoke('send-invoice-sms', {
            body: { policy_id: policyId, skip_sms: true }
          });
        } else {
          const { data: groupPolicies, error: fetchError } = await supabase
            .from('policies')
            .select('id')
            .eq('group_id', groupId);
          if (fetchError) throw fetchError;
          const policyIds = groupPolicies?.map(p => p.id) || [policyId];
          result = await supabase.functions.invoke('send-package-invoice-sms', {
            body: { policy_ids: policyIds, skip_sms: true }
          });
        }
      } else {
        result = await supabase.functions.invoke('send-invoice-sms', {
          body: { policy_id: policyId, skip_sms: true }
        });
      }

      if (result.error || result.data?.error) {
        const errorMsg = await extractErrorMessage(result);
        setErrorMessage(errorMsg);
        toast.error(errorMsg);
        return;
      }

      const invoiceUrl = result.data?.package_invoice_url || result.data?.ab_invoice_url || result.data?.invoice_url;
      if (invoiceUrl) {
        window.open(invoiceUrl, '_blank');
        toast.success("تم فتح الفاتورة");
      } else {
        setErrorMessage("لم يتم العثور على رابط الفاتورة");
        toast.error("لم يتم العثور على رابط الفاتورة");
      }
    } catch (error) {
      console.error('Print invoice error:', error);
      const errorMsg = error instanceof Error ? error.message : "فشل في تحميل الفاتورة";
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
      let result;
      
      if (isPackage) {
        const { data: mainPolicy, error: mainPolicyError } = await supabase
          .from('policies')
          .select('group_id')
          .eq('id', policyId)
          .single();
        if (mainPolicyError) throw mainPolicyError;
        const groupId = mainPolicy?.group_id;
        
        if (!groupId) {
          result = await supabase.functions.invoke('send-invoice-sms', {
            body: { policy_id: policyId, force_resend: true }
          });
        } else {
          const { data: groupPolicies, error: fetchError } = await supabase
            .from('policies')
            .select('id')
            .eq('group_id', groupId);
          if (fetchError) throw fetchError;
          const policyIds = groupPolicies?.map(p => p.id) || [policyId];
          result = await supabase.functions.invoke('send-package-invoice-sms', {
            body: { policy_ids: policyIds }
          });
        }
      } else {
        result = await supabase.functions.invoke('send-invoice-sms', {
          body: { policy_id: policyId, force_resend: true }
        });
      }

      if (result.error || result.data?.error) {
        const errorMsg = await extractErrorMessage(result);
        setErrorMessage(errorMsg);
        toast.error(errorMsg);
        return;
      }

      setSmsSent(true);
      toast.success("تم إرسال SMS بنجاح");
    } catch (error) {
      console.error('Send SMS error:', error);
      const errorMsg = error instanceof Error ? error.message : "فشل في إرسال SMS";
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSendingSms(false);
    }
  };

  const handlePrintReceipt = async () => {
    if (paymentIds.length === 0) return;
    setPrintingReceipt(true);
    setErrorMessage(null);

    try {
      const result = await supabase.functions.invoke('generate-payment-receipt', {
        body: { payment_id: paymentIds[0] }
      });

      if (result.error || result.data?.error) {
        const errorMsg = await extractErrorMessage(result);
        setErrorMessage(errorMsg);
        toast.error(errorMsg);
        return;
      }

      const receiptUrl = result.data?.receipt_url;
      if (receiptUrl) {
        window.open(receiptUrl, '_blank');
        toast.success("تم فتح إيصال الدفع");
      } else {
        setErrorMessage("لم يتم العثور على رابط الإيصال");
        toast.error("لم يتم العثور على رابط الإيصال");
      }
    } catch (error) {
      console.error('Print receipt error:', error);
      const errorMsg = error instanceof Error ? error.message : "فشل في تحميل الإيصال";
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
    } finally {
      setPrintingReceipt(false);
    }
  };

  const handleSendReceiptSms = async () => {
    if (!clientPhone || paymentIds.length === 0) {
      toast.error("لا يوجد رقم هاتف أو دفعات");
      return;
    }

    setSendingReceiptSms(true);
    setErrorMessage(null);

    try {
      // First generate the receipt to get URL
      const receiptResult = await supabase.functions.invoke('generate-payment-receipt', {
        body: { payment_id: paymentIds[0] }
      });

      if (receiptResult.error || receiptResult.data?.error) {
        const errorMsg = await extractErrorMessage(receiptResult);
        setErrorMessage(errorMsg);
        toast.error(errorMsg);
        return;
      }

      const receiptUrl = receiptResult.data?.receipt_url;
      if (!receiptUrl) {
        setErrorMessage("لم يتم العثور على رابط الإيصال");
        toast.error("لم يتم العثور على رابط الإيصال");
        return;
      }

      // Send via SMS
      const smsResult = await supabase.functions.invoke('send-sms', {
        body: {
          phone: clientPhone,
          message: `إيصال الدفع الخاص بك:\n${receiptUrl}`
        }
      });

      if (smsResult.error || smsResult.data?.error) {
        const errorMsg = await extractErrorMessage(smsResult);
        setErrorMessage(errorMsg);
        toast.error(errorMsg);
        return;
      }

      setReceiptSmsSent(true);
      toast.success("تم إرسال إيصال الدفع عبر SMS");
    } catch (error) {
      console.error('Send receipt SMS error:', error);
      const errorMsg = error instanceof Error ? error.message : "فشل في إرسال الإيصال";
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSendingReceiptSms(false);
    }
  };

  const handleClose = () => {
    setErrorMessage(null);
    onOpenChange(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-success">
            <Check className="h-6 w-6" />
            تم إنشاء الوثيقة بنجاح
          </DialogTitle>
          <DialogDescription>
            يمكنك طباعة بوليصة التأمين أو فاتورة الدفع أو إرسالها للعميل عبر SMS
          </DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex flex-col gap-3 mt-4">
          {/* Invoice Section */}
          <p className="text-xs font-semibold text-muted-foreground">بوليصة التأمين</p>
          <Button
            variant="outline"
            className="w-full gap-2 h-12"
            onClick={handlePrintInvoice}
            disabled={printingInvoice}
          >
            {printingInvoice ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Printer className="h-5 w-5" />
            )}
            طباعة بوليصة التأمين
          </Button>

          <Button
            variant="outline"
            className="w-full gap-2 h-12"
            onClick={handleSendSms}
            disabled={sendingSms || smsSent || !clientPhone}
          >
            {sendingSms ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : smsSent ? (
              <Check className="h-5 w-5 text-success" />
            ) : (
              <MessageSquare className="h-5 w-5" />
            )}
            {smsSent ? "تم إرسال بوليصة التأمين SMS" : "إرسال بوليصة التأمين SMS"}
          </Button>

          {/* Receipt Section - only show if payments exist */}
          {paymentIds.length > 0 && (
            <>
              <Separator className="my-1" />
              <p className="text-xs font-semibold text-muted-foreground">فاتورة الدفع</p>

              <Button
                variant="outline"
                className="w-full gap-2 h-12"
                onClick={handlePrintReceipt}
                disabled={printingReceipt}
              >
                {printingReceipt ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Receipt className="h-5 w-5" />
                )}
                طباعة فاتورة الدفع
              </Button>

              <Button
                variant="outline"
                className="w-full gap-2 h-12"
                onClick={handleSendReceiptSms}
                disabled={sendingReceiptSms || receiptSmsSent || !clientPhone}
              >
                {sendingReceiptSms ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : receiptSmsSent ? (
                  <Check className="h-5 w-5 text-success" />
                ) : (
                  <MessageSquare className="h-5 w-5" />
                )}
                {receiptSmsSent ? "تم إرسال فاتورة الدفع SMS" : "إرسال فاتورة الدفع SMS"}
              </Button>
            </>
          )}

          {!clientPhone && (
            <p className="text-xs text-muted-foreground text-center">
              لا يوجد رقم هاتف للعميل لإرسال SMS
            </p>
          )}

          <Separator className="my-1" />

          <Button
            variant="ghost"
            className="w-full gap-2"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
            إغلاق
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
