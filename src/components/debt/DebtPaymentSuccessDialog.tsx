import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSmsLock } from "@/hooks/useSmsLock";
import { supabase } from "@/integrations/supabase/client";
import { toastFunctionError } from "@/lib/functionError";
import { toast } from "sonner";
import {
  Printer,
  MessageSquare,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Receipt,
  Info,
} from "lucide-react";
import { WhatsappLogo } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// Sibling of PolicySuccessDialog tailored to the debt-payment flow.
// Shows a single سند قبض row (print / SMS / WhatsApp) — there's no
// "transaction" counterpart for a standalone debt collection, so we
// drop that block entirely. SMS goes through useSmsLock so the icon
// surfaces the lock badge and routes to the upgrade dialog when the
// monthly quota is gone, mirroring the new-policy success dialog.

type ChannelKey = "print" | "sms" | "whatsapp";
type ChannelState = "idle" | "loading" | "sent";

interface DebtPaymentSuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentIds: string[];
  clientPhone: string | null;
  onClose: () => void;
}

export function DebtPaymentSuccessDialog({
  open,
  onOpenChange,
  paymentIds,
  clientPhone,
  onClose,
}: DebtPaymentSuccessDialogProps) {
  const [cellState, setCellState] = useState<Record<ChannelKey, ChannelState>>({
    print: "idle",
    sms: "idle",
    whatsapp: "idle",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    locked: smsLocked,
    loading: smsLoading,
    openUpgradeDialog: openSmsUpgrade,
  } = useSmsLock();

  const setCell = (channel: ChannelKey, state: ChannelState) =>
    setCellState((prev) => ({ ...prev, [channel]: state }));

  const handlePrint = async () => {
    setCell("print", "loading");
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-payment-receipt-sms",
        { body: { payment_ids: paymentIds, skip_sms: true } },
      );
      if (error) {
        await toastFunctionError(error, "فشل في تحميل سند القبض");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const url = data?.receipt_url;
      if (!url) {
        toast.error("لم يتم العثور على رابط السند");
        return;
      }
      // Stamp printed_at so سجل الدفعات locks "تعديل" on these rows —
      // mirrors PolicySuccessDialog's print path.
      await supabase
        .from("policy_payments")
        .update({ printed_at: new Date().toISOString() })
        .in("id", paymentIds)
        .is("printed_at", null);
      window.open(url, "_blank");
      toast.success("تم فتح سند القبض");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في تحميل سند القبض";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setCell("print", "idle");
    }
  };

  const handleSms = async () => {
    if (!clientPhone) {
      toast.error("لا يوجد رقم هاتف للعميل");
      return;
    }
    if (smsLoading) return;
    if (smsLocked) {
      openSmsUpgrade();
      return;
    }
    setCell("sms", "loading");
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-payment-receipt-sms",
        { body: { payment_ids: paymentIds } },
      );
      if (error) {
        await toastFunctionError(error, "فشل في إرسال SMS");
        setCell("sms", "idle");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        setCell("sms", "idle");
        return;
      }
      setCell("sms", "sent");
      toast.success("تم إرسال سند القبض عبر SMS");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في إرسال SMS";
      setErrorMessage(msg);
      toast.error(msg);
      setCell("sms", "idle");
    }
  };

  const handleWhatsapp = async () => {
    if (!clientPhone) {
      toast.error("لا يوجد رقم هاتف للعميل");
      return;
    }
    setCell("whatsapp", "loading");
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-payment-receipt-sms",
        { body: { payment_ids: paymentIds, whatsapp_mode: true } },
      );
      if (error) {
        await toastFunctionError(error, "فشل في تجهيز رسالة واتساب");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const phone = data?.whatsapp_phone;
      const text = data?.message_text;
      if (!phone || !text) {
        toast.error("لم يتم تجهيز رسالة واتساب");
        return;
      }
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
        "_blank",
      );
      toast.success("تم فتح واتساب");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في تجهيز رسالة واتساب";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setCell("whatsapp", "idle");
    }
  };

  const handleClose = () => {
    setErrorMessage(null);
    setCellState({ print: "idle", sms: "idle", whatsapp: "idle" });
    onOpenChange(false);
    onClose();
  };

  const anyLoading = Object.values(cellState).some((s) => s === "loading");

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md w-[95vw] p-0 overflow-hidden" dir="rtl">
        <div className="text-white p-5 hero-gradient">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-bold text-white text-right">
                  تم تسديد الدفعات بنجاح
                </DialogTitle>
                <p className="text-xs text-white/70 mt-0.5">
                  يمكنك طباعة أو إرسال سند القبض للعميل
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="p-4 space-y-3">
          {errorMessage && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <TooltipProvider delayDuration={200}>
            <div className="space-y-2">
              {/* Inline action panel — always expanded here since the
                  dialog only has the one row. */}
              <div className="flex items-center justify-center gap-2 p-2 bg-muted/40 border border-border/60 rounded-xl">
                <ChannelButton
                  label="طباعة"
                  state={cellState.print}
                  onClick={handlePrint}
                  icon={<Printer className="h-5 w-5" />}
                  colorIdle="text-emerald-600"
                />
                <ChannelButton
                  label={clientPhone ? "إرسال SMS" : "لا يوجد رقم هاتف"}
                  state={cellState.sms}
                  disabled={!clientPhone}
                  locked={smsLocked}
                  onClick={handleSms}
                  icon={<MessageSquare className="h-5 w-5" />}
                  colorIdle="text-blue-600"
                />
                <ChannelButton
                  label={clientPhone ? "إرسال واتساب" : "لا يوجد رقم هاتف"}
                  state={cellState.whatsapp}
                  disabled={!clientPhone}
                  onClick={handleWhatsapp}
                  icon={<WhatsappLogo className="h-5 w-5" weight="fill" />}
                  colorIdle="text-green-600"
                />
              </div>

              <div className="w-full p-4 rounded-xl border-2 border-border bg-background text-right flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-blue-500/10">
                  <Receipt className="h-6 w-6 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-base">
                      طباعة أو إرسال سند القبض
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center justify-center w-4 h-4 text-muted-foreground/70 hover:text-foreground cursor-help">
                          <Info className="h-3.5 w-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px] text-right">
                        سند القبض إثبات استلام المبلغ من العميل بنفس شكل السندات في صفحة الإيصالات.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    إثبات استلام المبلغ من العميل
                  </div>
                </div>
              </div>
            </div>
          </TooltipProvider>

          <Button
            variant="outline"
            className="w-full gap-2 mt-1"
            onClick={handleClose}
            disabled={anyLoading}
          >
            <X className="h-4 w-4" />
            إغلاق
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ChannelButtonProps {
  label: string;
  state: ChannelState;
  onClick: () => void;
  icon: React.ReactNode;
  colorIdle: string;
  disabled?: boolean;
  locked?: boolean;
}

function ChannelButton({
  label,
  state,
  onClick,
  icon,
  colorIdle,
  disabled,
  locked,
}: ChannelButtonProps) {
  const isLoading = state === "loading";
  const isSent = state === "sent";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled || isLoading || isSent}
          className={cn(
            "relative flex-1 h-12 rounded-lg border border-border/60 bg-background",
            "transition-all duration-150 hover:scale-105 hover:shadow-sm",
            "flex items-center justify-center",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none",
            !disabled && !isLoading && !isSent && colorIdle,
            isSent && "text-emerald-600 bg-emerald-50 border-emerald-200",
          )}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : isSent ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            icon
          )}
          {locked && !isLoading && !isSent && (
            <span className="absolute top-0.5 left-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
