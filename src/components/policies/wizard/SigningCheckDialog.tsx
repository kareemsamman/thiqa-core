import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSmsLock } from "@/hooks/useSmsLock";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { AlertTriangle, CheckCircle2, Clock, Send, Loader2, ArrowLeft, X } from "lucide-react";
import { Lock } from "@phosphor-icons/react";

type DialogState = "check" | "waiting" | "signed";

interface SigningCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing client id, or null when the client hasn't been saved yet */
  clientId: string | null;
  clientPhone: string | null;
  /**
   * Called when Send is clicked and clientId is null.
   * Should create the client record and return the new id, or throw on failure.
   * The dialog catches the error and shows it in a toast.
   */
  onCreateClient?: () => Promise<string>;
  /** Called when the realtime subscription detects that the client has signed */
  onSigned?: (signatureUrl: string) => void;
  onSkip: () => void;
  onProceed: () => void;
  /** Starting state when the dialog opens — defaults to "check" */
  initialState?: DialogState;
  /** Notifies parent whenever the internal dialog state changes */
  onStateChange?: (state: DialogState) => void;
}

export function SigningCheckDialog({
  open,
  onOpenChange,
  clientId,
  clientPhone,
  onCreateClient,
  onSigned,
  onSkip,
  onProceed,
  initialState,
  onStateChange,
}: SigningCheckDialogProps) {
  const { toast } = useToast();
  const { locked: smsLocked, loading: smsLoading, guardSend } = useSmsLock();
  const [state, setState] = useState<DialogState>("check");
  const [sending, setSending] = useState(false);
  // Tracks the resolved client id — may differ from the prop when a new client
  // is created on-the-fly before the SMS is sent.
  const [resolvedClientId, setResolvedClientId] = useState<string | null>(clientId);

  // Keep initialState in a ref so the open-reset effect always reads the latest value
  const initialStateRef = useRef<DialogState>(initialState ?? "check");
  useEffect(() => { initialStateRef.current = initialState ?? "check"; }, [initialState]);

  // Notify parent whenever state changes
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; });
  useEffect(() => { onStateChangeRef.current?.(state); }, [state]);

  // Sync resolved id with prop changes (e.g. dialog reopened for a different client)
  useEffect(() => {
    setResolvedClientId(clientId);
  }, [clientId]);

  // Reset to initialState each time the dialog opens (handles restoring a minimized wizard)
  useEffect(() => {
    if (open) setState(initialStateRef.current);
  }, [open]);

  // Live subscription: detect when the client signs while we're waiting
  useEffect(() => {
    if (!open || state !== "waiting" || !resolvedClientId) return;

    const channel = supabase
      .channel(`signing-check-${resolvedClientId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "clients",
          filter: `id=eq.${resolvedClientId}`,
        },
        (payload) => {
          const updated = payload.new as { signature_url?: string | null };
          if (updated.signature_url) {
            setState("signed");
            onSigned?.(updated.signature_url);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, state, resolvedClientId]);

  const handleSend = async () => {
    if (!guardSend("click")) return;

    setSending(true);
    try {
      let targetId = resolvedClientId;

      // For new clients create the record first so we have a real id
      if (!targetId && onCreateClient) {
        targetId = await onCreateClient(); // throws on failure
        setResolvedClientId(targetId);
      }

      if (!targetId) return;

      const { data, error } = await supabase.functions.invoke("send-signature-sms", {
        body: { client_id: targetId },
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

  // Send is available when there's a phone number and either an existing client
  // or a creation callback for a new client.
  const canSend = !!clientPhone && (!!clientId || !!onCreateClient);

  if (!open) return null;

  return (
    <>
      {/* Overlay — fills the wizard's DialogContent (which is the positioned
          ancestor). Stops at the wizard's bounds, leaving the page outside
          the wizard untouched. */}
      <div
        aria-hidden
        className="absolute inset-0 z-[5] bg-black/40 animate-in fade-in-0"
        onClick={(e) => e.stopPropagation()}
      />
      {/* Centered card */}
      <div
        dir="rtl"
        className="absolute left-1/2 top-1/2 z-[6] grid w-[calc(100%-2rem)] sm:max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg animate-in fade-in-0 zoom-in-95"
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute left-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          title="إغلاق"
          aria-label="إغلاق"
        >
          <X className="h-4 w-4" />
        </button>
        {state === "check" && (
          <>
            <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              العميل لم يوقّع
            </h2>

            <p className="text-sm text-muted-foreground py-2">
              هذا العميل لم يوقّع على نموذج التفويض بعد. هل تريد إرسال رابط التوقيع إليه عبر SMS؟
            </p>

            {!clientPhone && (
              <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                لا يوجد رقم هاتف — لا يمكن إرسال رسالة
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
            <h2 className="text-lg font-semibold leading-none tracking-tight">في انتظار التوقيع</h2>

            <div className="flex flex-col items-center gap-4 py-6">
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
            <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              وقّع العميل
            </h2>

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
      </div>
    </>
  );
}
