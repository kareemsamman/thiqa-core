import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSmsLock } from "@/hooks/useSmsLock";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { AlertTriangle, CheckCircle2, Clock, Send, Loader2, ArrowLeft } from "lucide-react";
import { Lock } from "@phosphor-icons/react";

type DialogState = "check" | "waiting" | "signed";

interface SigningCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null for new (unsaved) clients — SMS sending is disabled in that case */
  clientId: string | null;
  clientPhone: string | null;
  onSkip: () => void;
  onProceed: () => void;
}

export function SigningCheckDialog({
  open,
  onOpenChange,
  clientId,
  clientPhone,
  onSkip,
  onProceed,
}: SigningCheckDialogProps) {
  const { toast } = useToast();
  const { locked: smsLocked, loading: smsLoading, guardSend } = useSmsLock();
  const [state, setState] = useState<DialogState>("check");
  const [sending, setSending] = useState(false);

  // Reset to initial state each time the dialog opens
  useEffect(() => {
    if (open) setState("check");
  }, [open]);

  // Live subscription: detect when the client signs while we're waiting
  useEffect(() => {
    if (!open || state !== "waiting" || !clientId) return;

    const channel = supabase
      .channel(`signing-check-${clientId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "clients",
          filter: `id=eq.${clientId}`,
        },
        (payload) => {
          const updated = payload.new as { signature_url?: string | null };
          if (updated.signature_url) {
            setState("signed");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, state, clientId]);

  const handleSend = async () => {
    if (!guardSend("click")) return;
    if (!clientId) return;

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-signature-sms", {
        body: { client_id: clientId },
      });

      if (error) {
        const msg = await extractFunctionErrorMessage(error);
        throw new Error(msg || "فشل في إرسال طلب التوقيع");
      }

      if (data?.success === false) {
        toast({ title: "تنبيه", description: data.message || "العميل لديه توقيع مسبق" });
      } else {
        toast({
          title: "تم الإرسال",
          description: clientPhone
            ? `تم إرسال رابط التوقيع إلى ${clientPhone}`
            : "تم إرسال رابط التوقيع",
        });
        setState("waiting");
      }
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleSkip = () => {
    onOpenChange(false);
    onSkip();
  };

  const handleProceed = () => {
    onOpenChange(false);
    onProceed();
  };

  const canSend = !!clientId && !!clientPhone;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" dir="rtl">
        {state === "check" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                العميل لم يوقّع
              </DialogTitle>
            </DialogHeader>

            <p className="text-sm text-muted-foreground py-2">
              هذا العميل لم يوقّع على نموذج التفويض بعد. هل تريد إرسال رابط التوقيع إليه عبر SMS؟
            </p>

            {!clientId && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                إرسال رسالة متاح فقط للعملاء المحفوظين مسبقًا
              </p>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={handleSkip}>
                تخطي
              </Button>
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!canSend || sending || smsLoading}
                className="relative gap-2"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : smsLocked ? (
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-amber-600 ring-2 ring-amber-500">
                    <Lock className="h-2.5 w-2.5" weight="fill" />
                  </span>
                ) : (
                  <Send className="h-4 w-4" />
                )}
                إرسال رسالة
              </Button>
            </div>
          </>
        )}

        {state === "waiting" && (
          <>
            <DialogHeader>
              <DialogTitle>في انتظار التوقيع</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 py-6">
              {/* Animated waiting indicator */}
              <div className="relative w-20 h-20 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                <Clock className="h-8 w-8 text-primary" />
              </div>
              <p className="font-medium text-center">في انتظار توقيع العميل...</p>
              {clientPhone && (
                <p className="text-sm text-muted-foreground text-center">
                  تم إرسال الرابط إلى {clientPhone}
                </p>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={handleSkip}>
                تخطي
              </Button>
              <Button size="sm" disabled>
                التالي
                <ArrowLeft className="h-4 w-4 mr-1" />
              </Button>
            </div>
          </>
        )}

        {state === "signed" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                وقّع العميل
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <p className="font-medium text-green-700 dark:text-green-400 text-center">
                تم توقيع العميل بنجاح
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={handleSkip}>
                تخطي
              </Button>
              <Button size="sm" onClick={handleProceed} className="gap-2">
                التالي
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
